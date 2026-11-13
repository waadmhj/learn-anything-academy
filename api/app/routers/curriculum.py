"""Curriculum browsing (per course): stages, modules, lessons, resources, search and syllabus coverage."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import or_, select
from sqlalchemy.orm import Session, selectinload

from .. import models as m
from ..access import course_for, lesson_for, module_for, owned_course_ids, resource_for
from ..auth import current_user
from ..db import get_db
from ..services import llm, viewer
from ..services.insights import curriculum, lesson_brief, module_state, prerequisites_met
from ..services.progress import evidence, get_progress, progress_map

router = APIRouter(tags=["curriculum"])


def resource_dict(r: m.Resource) -> dict:
    return {
        "id": r.id, "title": r.title, "provider": r.provider, "type": r.type, "level": r.level, "duration": r.duration,
        "language": r.language, "cost": r.cost, "url": r.url, "why": r.why, "authors": r.authors, "year": r.year,
        "isbn": r.isbn, "embed": r.embed or {}, "chapters": r.chapters or [], "summary": r.summary, "impact": r.impact,
        "source": r.source, "score": r.score, "comments": r.comments, "discussion_url": r.discussion_url, "rating": r.rating,
        "recommended_by": r.recommended_by,
    }


@router.get("/courses/{course_id}/curriculum")
def get_curriculum(course_id: int, db: Session = Depends(get_db), user: m.User = Depends(current_user)):
    course_for(db, user, course_id)
    prog = progress_map(db, user.id)
    stages = curriculum(db, course_id)
    modules_by_id = {mod.id: mod for s in stages for mod in s.modules}
    out = []
    for s in stages:
        mods = []
        for mod in s.modules:
            ok, missing = prerequisites_met(mod, modules_by_id, prog)
            mods.append({
                "id": mod.id, "title": mod.title, "summary": mod.summary, "prerequisites": mod.prerequisites, "project_id": mod.project_id,
                "prerequisites_met": ok, "missing_prerequisites": missing, "state": module_state(mod, prog),
                "hours": round(sum(l.minutes for l in mod.lessons) / 60, 1),
                "lessons": [lesson_brief(l, prog.get(l.id)) for l in mod.lessons],
            })
        out.append({"id": s.id, "order": s.order, "title": s.title, "summary": s.summary, "modules": mods})
    return out


@router.get("/modules/{module_id}")
def get_module(module_id: str, db: Session = Depends(get_db), user: m.User = Depends(current_user)):
    mod = module_for(db, user, module_id)
    prog = progress_map(db, user.id)
    modules_by_id = {x.id: x for x in db.scalars(select(m.Module).where(m.Module.course_id == mod.course_id).options(selectinload(m.Module.lessons)))}
    ok, missing = prerequisites_met(mod, modules_by_id, prog)
    project = db.get(m.Project, mod.project_id) if mod.project_id else None
    return {
        "id": mod.id, "course_id": mod.course_id, "title": mod.title, "summary": mod.summary,
        "stage": {"id": mod.stage.id, "title": mod.stage.title, "order": mod.stage.order},
        "prerequisites": [{"id": pid, "title": modules_by_id[pid].title, "complete": pid not in missing} for pid in mod.prerequisites if pid in modules_by_id],
        "prerequisites_met": ok, "state": module_state(mod, prog),
        "project": {"id": project.id, "title": project.title, "level": project.level, "summary": project.summary} if project else None,
        "lessons": [lesson_brief(l, prog.get(l.id)) | {"objectives": l.objectives, "covers": l.covers} for l in mod.lessons],
    }


@router.get("/lessons/{lesson_id}")
def get_lesson(lesson_id: str, db: Session = Depends(get_db), user: m.User = Depends(current_user)):
    lesson = lesson_for(db, user, lesson_id)
    course = db.get(m.Course, lesson.course_id)
    p = get_progress(db, user.id, lesson.id, create=False)
    prev_l = db.scalar(select(m.Lesson).where(m.Lesson.course_id == lesson.course_id, m.Lesson.global_order == lesson.global_order - 1))
    next_l = db.scalar(select(m.Lesson).where(m.Lesson.course_id == lesson.course_id, m.Lesson.global_order == lesson.global_order + 1))
    ex = lesson.exercise.data if lesson.exercise else None
    submitted = bool(p and db.scalar(select(m.ExerciseSubmission.id).where(m.ExerciseSubmission.user_id == user.id, m.ExerciseSubmission.lesson_id == lesson.id).limit(1)))
    ev = evidence(lesson, p, []) if p else {"can_complete": False, "can_master": False}
    return {
        "id": lesson.id, "title": lesson.title, "level": lesson.level, "minutes": lesson.minutes, "content_status": lesson.status,
        "gen_error": lesson.gen_error, "can_write": llm.available(),
        "course": {"id": course.id, "title": course.title, "subject": course.subject},
        "covers": lesson.covers, "objectives": lesson.objectives, "overview": lesson.overview, "sections": lesson.sections,
        "module": {"id": lesson.module.id, "title": lesson.module.title}, "stage": {"id": lesson.module.stage.id, "title": lesson.module.stage.title, "order": lesson.module.stage.order},
        "exercise": None if ex is None else {k: v for k, v in ex.items() if k not in ("solution", "explanation")} | {"submitted": submitted},
        "quiz": [{"id": q.id, "kind": q.kind, "prompt": q.prompt, "options": q.options} for q in lesson.questions],
        "flashcards": len(lesson.flashcards),
        "resources": [resource_dict(link.resource) | {"role": link.role} for link in lesson.resource_links],
        "progress": {
            "status": p.status if p else "not_started", "mastery": p.mastery if p else 0.0, "quiz_best": p.quiz_best if p else None,
            "quiz_last": p.quiz_last if p else None, "exercise_done": p.exercise_done if p else False,
            "objectives_checked": p.objectives_checked if p else [], "seconds_spent": p.seconds_spent if p else 0,
        } | ev,
        "prev": {"id": prev_l.id, "title": prev_l.title} if prev_l else None,
        "next": {"id": next_l.id, "title": next_l.title} if next_l else None,
    }


@router.get("/courses/{course_id}/resources")
def list_resources(
    course_id: int, type: str | None = None, source: str | None = None, q: str | None = Query(None, max_length=100),
    db: Session = Depends(get_db), user: m.User = Depends(current_user),
):
    course_for(db, user, course_id)
    stmt = select(m.Resource).where(m.Resource.course_id == course_id)
    if type:
        stmt = stmt.where(m.Resource.type == type)
    if source:
        stmt = stmt.where(m.Resource.source == source)
    if q:
        like = f"%{q}%"
        stmt = stmt.where(or_(m.Resource.title.ilike(like), m.Resource.provider.ilike(like), m.Resource.why.ilike(like), m.Resource.authors.ilike(like)))
    resources = list(db.scalars(stmt.order_by(m.Resource.type, m.Resource.title)))
    links = db.execute(
        select(m.LessonResource.resource_id, m.Lesson.id, m.Lesson.title, m.LessonResource.role)
        .join(m.Lesson, m.Lesson.id == m.LessonResource.lesson_id).where(m.Lesson.course_id == course_id)
    ).all()
    by_res: dict[str, list[dict]] = {}
    for rid, lid, title, role in links:
        by_res.setdefault(rid, []).append({"id": lid, "title": title, "role": role})
    return [resource_dict(r) | {"lessons": by_res.get(r.id, [])} for r in resources]


@router.get("/resources/{resource_id}")
def get_resource(resource_id: str, db: Session = Depends(get_db), user: m.User = Depends(current_user)):
    r = resource_for(db, user, resource_id)
    links = db.execute(select(m.Lesson.id, m.Lesson.title, m.LessonResource.role).join(m.LessonResource, m.Lesson.id == m.LessonResource.lesson_id).where(m.LessonResource.resource_id == r.id)).all()
    return resource_dict(r) | {"lessons": [{"id": i, "title": t, "role": role} for i, t, role in links]}


@router.get("/resources/{resource_id}/view")
def view_resource(resource_id: str, reader: bool = False, discussion: bool = False, db: Session = Depends(get_db), user: m.User = Depends(current_user)):
    """How to show this resource (or its Hacker News discussion) inside the platform: a player, the page, or a reading view."""
    r = resource_for(db, user, resource_id)
    if discussion:
        if not r.discussion_url:
            raise HTTPException(404, "This resource has no discussion")
        return viewer.view(m.Resource(id=r.id, url=r.discussion_url, type="discussion", embed={}), prefer_reader=reader)
    return viewer.view(r, prefer_reader=reader)


@router.get("/search")
def search(q: str = Query(..., min_length=2, max_length=100), course_id: int | None = None, db: Session = Depends(get_db), user: m.User = Depends(current_user)):
    ids = owned_course_ids(db, user)
    if course_id is not None:
        ids = [i for i in ids if i == course_id]
    like = f"%{q}%"
    lessons = list(db.scalars(select(m.Lesson).where(m.Lesson.course_id.in_(ids), or_(m.Lesson.title.ilike(like))).order_by(m.Lesson.course_id, m.Lesson.global_order).limit(12)))
    modules = db.scalars(select(m.Module).where(m.Module.course_id.in_(ids), m.Module.title.ilike(like)).limit(5))
    resources = db.scalars(select(m.Resource).where(m.Resource.course_id.in_(ids), or_(m.Resource.title.ilike(like), m.Resource.provider.ilike(like))).limit(8))
    projects = db.scalars(select(m.Project).where(m.Project.course_id.in_(ids), m.Project.title.ilike(like)).limit(5))
    courses = db.scalars(select(m.Course).where(m.Course.id.in_(ids), or_(m.Course.title.ilike(like), m.Course.subject.ilike(like))).limit(5))
    return {
        "courses": [{"id": c.id, "title": c.title} for c in courses],
        "lessons": [{"id": l.id, "title": l.title, "module_id": l.module_id} for l in lessons],
        "modules": [{"id": x.id, "title": x.title} for x in modules],
        "resources": [{"id": x.id, "title": x.title, "type": x.type, "provider": x.provider, "course_id": x.course_id} for x in resources],
        "projects": [{"id": x.id, "title": x.title, "level": x.level} for x in projects],
    }


@router.get("/courses/{course_id}/coverage")
def coverage(course_id: int, db: Session = Depends(get_db), user: m.User = Depends(current_user)):
    """Every syllabus topic and where it is taught."""
    course = course_for(db, user, course_id)
    where: dict[str, list[dict]] = {t: [] for t in course.syllabus or []}
    for l in db.scalars(select(m.Lesson).where(m.Lesson.course_id == course_id).order_by(m.Lesson.global_order)):
        for c in l.covers:
            where.setdefault(c, []).append({"id": l.id, "title": l.title})
    items = [{"topic": t, "lessons": ls} for t, ls in where.items()]
    return {"topics": len(items), "covered": sum(1 for i in items if i["lessons"]), "items": items}
