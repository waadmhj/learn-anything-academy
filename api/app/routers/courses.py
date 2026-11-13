"""Courses: create from a subject + material, build status, lesson writing, dashboard, exam mode and tutor."""
from __future__ import annotations

import random
from typing import Literal

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from .. import models as m
from ..access import course_for, lesson_for
from ..auth import current_user
from ..config import get_settings
from ..db import get_db
from ..services import builder, insights, llm, material, tutor
from ..services.progress import DONE_STATUSES, progress_map, streak

router = APIRouter(tags=["courses"])


@router.get("/ai/status")
def ai_status(user: m.User = Depends(current_user)):
    s = get_settings()
    return {"available": llm.available(), "model": s.ai_model if llm.available() else None, "youtube": bool(s.youtube_api_key)}


@router.get("/courses")
def list_courses(db: Session = Depends(get_db), user: m.User = Depends(current_user)):
    prog = progress_map(db, user.id)
    out = []
    for c in db.scalars(select(m.Course).where(m.Course.owner_id == user.id).order_by(m.Course.updated_at.desc())):
        ids = list(db.scalars(select(m.Lesson.id).where(m.Lesson.course_id == c.id)))
        done = sum(1 for i in ids if i in prog and prog[i].status in DONE_STATUSES)
        out.append(insights.course_out(db, c) | {"completed": done, "percent": round(100 * done / len(ids)) if ids else 0})
    return out


@router.post("/courses", status_code=201)
def create_course(
    subject: str = Form(..., min_length=2, max_length=200),
    title: str = Form("", max_length=200),
    goal: str = Form("", max_length=2000),
    level: Literal["beginner", "intermediate", "advanced"] = Form("beginner"),
    hours_per_week: int = Form(5, ge=1, le=80),
    text: str = Form("", max_length=2_000_000),
    file: UploadFile | None = File(None),
    db: Session = Depends(get_db),
    user: m.User = Depends(current_user),
):
    s = get_settings()
    if (db.scalar(select(func.count()).select_from(m.Course).where(m.Course.owner_id == user.id)) or 0) >= s.max_courses_per_user:
        raise HTTPException(409, f"You can have up to {s.max_courses_per_user} courses. Delete one to make room.")
    source_name, parts = "", []
    if text.strip():
        parts.append(text.strip())
        source_name = "Pasted text"
    if file is not None and file.filename:
        data = file.file.read(material.MAX_UPLOAD_BYTES + 1)
        try:
            parts.append(material.extract(file.filename, data).strip())
        except material.MaterialError as e:
            raise HTTPException(422, str(e)) from e
        source_name = file.filename[:300] if not source_name else f"{source_name} + {file.filename[:250]}"
    source = "\n\n".join(p for p in parts if p)
    if len(source) > s.max_source_chars:
        raise HTTPException(
            422,
            f"That material is {len(source):,} characters; the limit is {s.max_source_chars:,}. "
            "Upload the syllabus or table of contents rather than the whole book.",
        )
    course = m.Course(
        owner_id=user.id, subject=subject.strip(), title=(title.strip() or subject.strip())[:200], goal=goal.strip(), level=level,
        hours_per_week=hours_per_week, source_name=source_name, source_text=source, status="building", step="Queued", progress=0.0,
    )
    db.add(course)
    db.commit()
    builder.start_build(course.id)
    db.refresh(course)
    return insights.course_out(db, course)


@router.get("/courses/{course_id}")
def get_course(course_id: int, db: Session = Depends(get_db), user: m.User = Depends(current_user)):
    return insights.course_out(db, course_for(db, user, course_id))


class CourseUpdate(BaseModel):
    title: str | None = Field(None, min_length=1, max_length=200)
    goal: str | None = Field(None, max_length=2000)
    hours_per_week: int | None = Field(None, ge=1, le=80)


@router.patch("/courses/{course_id}")
def update_course(course_id: int, body: CourseUpdate, db: Session = Depends(get_db), user: m.User = Depends(current_user)):
    c = course_for(db, user, course_id)
    for k, v in body.model_dump(exclude_none=True).items():
        setattr(c, k, v.strip() if isinstance(v, str) else v)
    db.commit()
    return insights.course_out(db, c)


@router.post("/courses/{course_id}/rebuild")
def rebuild(course_id: int, db: Session = Depends(get_db), user: m.User = Depends(current_user)):
    """Re-run a failed build. (A ready course keeps its lessons; rebuilding it would discard them.)"""
    c = course_for(db, user, course_id)
    if c.status != "failed":
        raise HTTPException(409, "Only a failed build can be retried.")
    c.status, c.error, c.step, c.progress = "building", None, "Queued", 0.0
    db.commit()
    builder.start_build(c.id)
    return insights.course_out(db, c)


@router.delete("/courses/{course_id}", status_code=204)
def delete_course(course_id: int, db: Session = Depends(get_db), user: m.User = Depends(current_user)):
    c = course_for(db, user, course_id)
    if c.status == "building":
        raise HTTPException(409, "Wait for the build to finish (or fail) before deleting this course.")
    lesson_ids = list(db.scalars(select(m.Lesson.id).where(m.Lesson.course_id == c.id)))
    project_ids = list(db.scalars(select(m.Project.id).where(m.Project.course_id == c.id)))
    for model in (m.LessonProgress, m.QuestionAttempt, m.ExerciseSubmission, m.CardState, m.Annotation):
        db.execute(delete(model).where(model.user_id == user.id, model.lesson_id.in_(lesson_ids)))
    for model in (m.ProjectProgress, m.MilestoneProgress):
        db.execute(delete(model).where(model.user_id == user.id, model.project_id.in_(project_ids)))
    db.execute(delete(m.Activity).where(m.Activity.user_id == user.id, m.Activity.ref_id.like(f"c{c.id}-%")))
    db.delete(c)
    db.commit()


# ── Lesson writing ──
@router.post("/lessons/{lesson_id}/write")
def write_lesson(lesson_id: str, db: Session = Depends(get_db), user: m.User = Depends(current_user)):
    lesson = lesson_for(db, user, lesson_id)
    if not llm.available():
        raise HTTPException(409, "AI isn't set up on this server, so lessons stay as guided outlines.")
    if lesson.status == "authored":
        raise HTTPException(409, "This lesson is already written.")
    if builder.claim_for_writing(db, lesson):
        builder.queue_lesson(lesson.id)
    db.refresh(lesson)
    return {"status": lesson.status, "error": lesson.gen_error}


@router.get("/lessons/{lesson_id}/write")
def write_status(lesson_id: str, db: Session = Depends(get_db), user: m.User = Depends(current_user)):
    lesson = lesson_for(db, user, lesson_id)
    return {"status": lesson.status, "error": lesson.gen_error}


@router.post("/courses/{course_id}/write-all")
def write_all(course_id: int, db: Session = Depends(get_db), user: m.User = Depends(current_user)):
    c = course_for(db, user, course_id)
    if not llm.available():
        raise HTTPException(409, "AI isn't set up on this server, so lessons stay as guided outlines.")
    if c.status != "ready":
        raise HTTPException(409, "Wait for the course to finish building.")
    queued = 0
    for lesson in db.scalars(select(m.Lesson).where(m.Lesson.course_id == c.id, m.Lesson.status.in_(("outline", "failed"))).order_by(m.Lesson.global_order)):
        if builder.claim_for_writing(db, lesson):
            builder.queue_lesson(lesson.id)
            queued += 1
    return {"queued": queued} | {"course": insights.course_out(db, c)}


# ── Dashboard & analytics ──
@router.get("/courses/{course_id}/dashboard")
def dashboard(course_id: int, db: Session = Depends(get_db), user: m.User = Depends(current_user)):
    return insights.overview(db, user, course_for(db, user, course_id))


@router.get("/courses/{course_id}/analytics")
def analytics(course_id: int, db: Session = Depends(get_db), user: m.User = Depends(current_user)):
    course = course_for(db, user, course_id)
    prog = progress_map(db, user.id)
    stages = insights.curriculum(db, course.id)
    modules = []
    for s in stages:
        for mod in s.modules:
            modules.append({"id": mod.id, "title": mod.title, "stage": s.order, **insights.module_state(mod, prog)})
    lessons_all = insights.all_lessons(db, course.id)
    lessons = [
        insights.lesson_brief(l, prog[l.id]) | {"quiz_best": prog[l.id].quiz_best, "minutes_spent": round(prog[l.id].seconds_spent / 60)}
        for l in lessons_all if l.id in prog and prog[l.id].status != "not_started"
    ]
    status_counts = {k: 0 for k in ("not_started", "in_progress", "completed", "needs_revision", "mastered")}
    for l in lessons_all:
        status_counts[prog[l.id].status if l.id in prog else "not_started"] += 1
    cur, longest = streak(db, user.id)
    return {
        "modules": modules, "lessons": lessons, "status_counts": status_counts, "study": insights.study_hours(db, user.id, 30),
        "weak_areas": insights.weak_areas(db, user.id, course.id, 10), "skills": insights.skills(db, user.id, course.id),
        "streak": cur, "longest_streak": longest, "completed": sum(1 for l in lessons_all if l.id in prog and prog[l.id].status in DONE_STATUSES),
        "total": len(lessons_all),
    }


# ── Exam mode ──
@router.get("/courses/{course_id}/exam")
def exam(course_id: int, n: int = Query(10, ge=3, le=40), scope: Literal["studied", "all"] = "all", db: Session = Depends(get_db), user: m.User = Depends(current_user)):
    """A mixed exam across the course's written lessons (or only the ones you've studied)."""
    course = course_for(db, user, course_id)
    stmt = select(m.Question, m.Lesson.title).join(m.Lesson, m.Lesson.id == m.Question.lesson_id).where(m.Lesson.course_id == course.id)
    if scope == "studied":
        studied = select(m.LessonProgress.lesson_id).where(m.LessonProgress.user_id == user.id, m.LessonProgress.status != "not_started")
        stmt = stmt.where(m.Question.lesson_id.in_(studied))
    rows = list(db.execute(stmt).all())
    random.shuffle(rows)
    return [{"id": q.id, "kind": q.kind, "prompt": q.prompt, "options": q.options, "lesson_id": q.lesson_id, "lesson_title": t, "track": None} for q, t in rows[:n]]


# ── Tutor ──
class TutorIn(BaseModel):
    question: str = Field(min_length=3, max_length=4000)
    lesson_id: str | None = None
    scope: Literal["lesson", "course"] = "course"
    mode: str = Field("ask", max_length=20)


@router.post("/courses/{course_id}/tutor/ask")
def tutor_ask(course_id: int, body: TutorIn, db: Session = Depends(get_db), user: m.User = Depends(current_user)):
    course = course_for(db, user, course_id)
    lesson = None
    if body.lesson_id and body.scope == "lesson":
        lesson = lesson_for(db, user, body.lesson_id)
        if lesson.course_id != course.id:
            raise HTTPException(404, "Lesson not found")
    return tutor.ask(db, course, body.question.strip(), body.mode, lesson)


# ── Home (all courses) ──
@router.get("/home")
def home(db: Session = Depends(get_db), user: m.User = Depends(current_user)):
    cur, longest = streak(db, user.id)
    return {
        "user": {"name": user.display_name, "daily_goal_minutes": user.daily_goal_minutes},
        "due_cards": insights.due_cards_count(db, user.id),
        "streak": cur, "longest_streak": longest,
        "ai": llm.available(),
    }
