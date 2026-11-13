"""Dashboard and analytics aggregations: recommendations, revision queue, weak areas, skills."""
from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from .. import models as m
from .progress import DONE_STATUSES, progress_map, streak


def curriculum(db: Session, course_id: int) -> list[m.Stage]:
    return list(db.scalars(
        select(m.Stage).where(m.Stage.course_id == course_id).order_by(m.Stage.order)
        .options(selectinload(m.Stage.modules).selectinload(m.Module.lessons))
    ))


def all_lessons(db: Session, course_id: int) -> list[m.Lesson]:
    return list(db.scalars(select(m.Lesson).where(m.Lesson.course_id == course_id).order_by(m.Lesson.global_order)))


def module_state(module: m.Module, prog: dict[str, m.LessonProgress]) -> dict:
    total = len(module.lessons)
    done = sum(1 for l in module.lessons if prog.get(l.id) and prog[l.id].status in DONE_STATUSES)
    mastered = sum(1 for l in module.lessons if prog.get(l.id) and prog[l.id].status == "mastered")
    started = any(prog.get(l.id) and prog[l.id].status != "not_started" for l in module.lessons)
    avg_mastery = sum((prog[l.id].mastery if l.id in prog else 0.0) for l in module.lessons) / (total or 1)
    return {"total": total, "completed": done, "mastered": mastered, "started": started, "mastery": round(avg_mastery, 3), "complete": total > 0 and done == total}


def prerequisites_met(module: m.Module, modules_by_id: dict[str, m.Module], prog: dict[str, m.LessonProgress]) -> tuple[bool, list[str]]:
    missing = [pid for pid in module.prerequisites if pid in modules_by_id and not module_state(modules_by_id[pid], prog)["complete"]]
    return not missing, missing


def recommend_next(db: Session, user_id: int, course_id: int, prog: dict[str, m.LessonProgress] | None = None) -> m.Lesson | None:
    """First lesson (curriculum order) that is not done, preferring ones whose module prerequisites are met."""
    prog = prog if prog is not None else progress_map(db, user_id)
    stages = curriculum(db, course_id)
    modules_by_id = {mod.id: mod for s in stages for mod in s.modules}
    fallback = None
    for s in stages:
        for mod in s.modules:
            ok, _ = prerequisites_met(mod, modules_by_id, prog)
            for lesson in mod.lessons:
                p = prog.get(lesson.id)
                if p and p.status in DONE_STATUSES:
                    continue
                if ok:
                    return lesson
                fallback = fallback or lesson
    return fallback


def continue_learning(db: Session, user_id: int, course_id: int) -> m.Lesson | None:
    return db.scalar(
        select(m.Lesson).join(m.LessonProgress, m.LessonProgress.lesson_id == m.Lesson.id)
        .where(m.LessonProgress.user_id == user_id, m.LessonProgress.status == "in_progress", m.Lesson.course_id == course_id)
        .order_by(m.LessonProgress.updated_at.desc()).limit(1)
    )


def due_cards_count(db: Session, user_id: int, course_id: int | None = None) -> int:
    stmt = select(func.count()).select_from(m.CardState).where(m.CardState.user_id == user_id, m.CardState.due_at <= datetime.now(timezone.utc))
    if course_id is not None:
        stmt = stmt.join(m.Lesson, m.Lesson.id == m.CardState.lesson_id).where(m.Lesson.course_id == course_id)
    return db.scalar(stmt) or 0


def revision_queue(db: Session, user_id: int, course_id: int, limit: int = 6) -> list[dict]:
    prog = progress_map(db, user_id)
    lessons = {l.id: l for l in all_lessons(db, course_id)}
    items = []
    for p in prog.values():
        lesson = lessons.get(p.lesson_id)
        if not lesson:
            continue
        if p.status == "needs_revision":
            items.append((0, -1.0, lesson, p, "Marked for revision"))
        elif p.status in ("completed",) and lesson.status == "authored" and p.mastery < 0.85:
            items.append((1, p.mastery, lesson, p, f"Mastery {round(p.mastery * 100)}% — close the gap"))
    items.sort(key=lambda t: (t[0], t[1]))
    return [lesson_brief(l, p) | {"reason": reason} for _, _, l, p, reason in items[:limit]]


def weak_areas(db: Session, user_id: int, course_id: int, limit: int = 6) -> list[dict]:
    """Modules where recent answers average below 70% (min 3 attempts)."""
    rows = db.execute(
        select(m.Lesson.module_id, func.avg(m.QuestionAttempt.score), func.count())
        .join(m.Lesson, m.Lesson.id == m.QuestionAttempt.lesson_id)
        .where(m.QuestionAttempt.user_id == user_id, m.Lesson.course_id == course_id)
        .group_by(m.Lesson.module_id)
    ).all()
    mods = {mod.id: mod for mod in db.scalars(select(m.Module).where(m.Module.course_id == course_id))}
    weak = [{"module_id": mid, "title": mods[mid].title, "accuracy": round(avg, 3), "attempts": n} for mid, avg, n in rows if n >= 3 and avg < 0.7 and mid in mods]
    weak.sort(key=lambda w: w["accuracy"])
    return weak[:limit]


def skills(db: Session, user_id: int, course_id: int) -> list[dict]:
    """Syllabus topics covered by completed lessons, grouped by module."""
    prog = progress_map(db, user_id)
    by_module: dict[str, list[str]] = defaultdict(list)
    titles = {mod.id: mod.title for mod in db.scalars(select(m.Module).where(m.Module.course_id == course_id))}
    for lesson in all_lessons(db, course_id):
        p = prog.get(lesson.id)
        if p and p.status in ("completed", "mastered", "needs_revision"):
            by_module[lesson.module_id].extend(lesson.covers or [lesson.title])
    return [{"module_id": mid, "module": titles.get(mid, mid), "topics": sorted(set(t))} for mid, t in sorted(by_module.items())]


def study_hours(db: Session, user_id: int, days: int = 30) -> list[dict]:
    start = date.today() - timedelta(days=days - 1)
    rows = {s.day: s.seconds for s in db.scalars(select(m.StudySession).where(m.StudySession.user_id == user_id, m.StudySession.day >= start))}
    return [{"day": (start + timedelta(days=i)).isoformat(), "minutes": round(rows.get(start + timedelta(days=i), 0) / 60, 1)} for i in range(days)]


def lesson_brief(lesson: m.Lesson, p: m.LessonProgress | None) -> dict:
    return {
        "id": lesson.id, "title": lesson.title, "module_id": lesson.module_id, "minutes": lesson.minutes, "level": lesson.level,
        "content_status": lesson.status, "status": p.status if p else "not_started", "mastery": p.mastery if p else 0.0,
    }


def recent_activity(db: Session, user_id: int, limit: int = 10, course_id: int | None = None) -> list[dict]:
    stmt = select(m.Activity).where(m.Activity.user_id == user_id)
    if course_id is not None:  # activity ref ids are lesson/project ids, which are prefixed with the course id
        stmt = stmt.where(m.Activity.ref_id.like(f"c{course_id}-%"))
    acts = db.scalars(stmt.order_by(m.Activity.created_at.desc(), m.Activity.id.desc()).limit(limit))
    return [{"kind": a.kind, "ref_id": a.ref_id, "detail": a.detail, "at": a.created_at.isoformat()} for a in acts]


def overview(db: Session, user: m.User, course: m.Course) -> dict:
    prog = progress_map(db, user.id)
    stages = curriculum(db, course.id)
    total = sum(len(mod.lessons) for s in stages for mod in s.modules)
    in_course = {l.id for s in stages for mod in s.modules for l in mod.lessons}
    prog = {k: v for k, v in prog.items() if k in in_course}
    done = sum(1 for p in prog.values() if p.status in DONE_STATUSES)
    mastered = sum(1 for p in prog.values() if p.status == "mastered")
    stage_rows, modules_done = [], 0
    for s in stages:
        lessons = [l for mod in s.modules for l in mod.lessons]
        sd = sum(1 for l in lessons if prog.get(l.id) and prog[l.id].status in DONE_STATUSES)
        mod_complete = sum(1 for mod in s.modules if module_state(mod, prog)["complete"])
        modules_done += mod_complete
        stage_rows.append({"id": s.id, "order": s.order, "title": s.title, "lessons": len(lessons), "completed": sd, "modules": len(s.modules), "modules_completed": mod_complete})
    lesson_ids = [l.id for s in stages for mod in s.modules for l in mod.lessons]
    seconds = sum(prog[i].seconds_spent for i in lesson_ids if i in prog)
    today_seconds = db.scalar(select(func.coalesce(func.sum(m.StudySession.seconds), 0)).where(m.StudySession.user_id == user.id, m.StudySession.day == date.today())) or 0
    cur, longest = streak(db, user.id)
    quiz_scores = [p.quiz_best for p in prog.values() if p.quiz_best is not None]
    nxt = recommend_next(db, user.id, course.id, prog)
    cont = continue_learning(db, user.id, course.id)
    current_stage = next((s for s in stage_rows if s["completed"] < s["lessons"]), stage_rows[-1] if stage_rows else None)
    course_projects = {p.id: p for p in db.scalars(select(m.Project).where(m.Project.course_id == course.id))}
    projects = [pp for pp in db.scalars(select(m.ProjectProgress).where(m.ProjectProgress.user_id == user.id)) if pp.project_id in course_projects]
    capstones = {k: p for k, p in course_projects.items() if p.level in ("capstone", "portfolio")}
    pending = [pp for pp in projects if pp.status in ("in_progress", "submitted")]
    return {
        "course": course_out(db, course),
        "user": {"name": user.display_name, "daily_goal_minutes": user.daily_goal_minutes},
        "totals": {
            "lessons": total, "completed": done, "mastered": mastered, "modules": sum(len(s.modules) for s in stages), "modules_completed": modules_done,
            "percent": round(100 * done / total, 1) if total else 0, "study_hours": round(seconds / 3600, 1), "today_minutes": round(today_seconds / 60),
            "streak": cur, "longest_streak": longest, "avg_quiz": round(sum(quiz_scores) / len(quiz_scores), 3) if quiz_scores else None,
            "due_cards": due_cards_count(db, user.id, course.id),
        },
        "stages": stage_rows,
        "current_stage": current_stage,
        "continue": lesson_brief(cont, prog.get(cont.id)) if cont else None,
        "next": lesson_brief(nxt, prog.get(nxt.id)) if nxt else None,
        "revision_queue": revision_queue(db, user.id, course.id),
        "weak_areas": weak_areas(db, user.id, course.id),
        "pending_projects": [{"id": pp.project_id, "status": pp.status} for pp in pending],
        "capstones": {"total": len(capstones), "started": sum(1 for pp in projects if pp.project_id in capstones and pp.status != "not_started"), "completed": sum(1 for pp in projects if pp.project_id in capstones and pp.status == "completed")},
        "upcoming_assessments": upcoming_assessments(db, user.id, prog),
        "activity": recent_activity(db, user.id, course_id=course.id),
    }


def upcoming_assessments(db: Session, user_id: int, prog: dict[str, m.LessonProgress]) -> list[dict]:
    """In-progress authored lessons whose knowledge check hasn't been passed yet."""
    out = []
    for p in prog.values():
        if p.status == "in_progress" and (p.quiz_best or 0) < 0.7:
            lesson = db.get(m.Lesson, p.lesson_id)
            if lesson and lesson.status == "authored":
                out.append({"lesson_id": lesson.id, "title": lesson.title, "best": p.quiz_best})
    return out[:5]


def course_out(db: Session, c: m.Course) -> dict:
    """Summary of a course for lists and headers (no learner progress)."""
    counts = dict(db.execute(select(m.Lesson.status, func.count()).where(m.Lesson.course_id == c.id).group_by(m.Lesson.status)).all())
    return {
        "id": c.id, "title": c.title, "subject": c.subject, "summary": c.summary, "goal": c.goal, "level": c.level,
        "hours_per_week": c.hours_per_week, "source_name": c.source_name, "has_material": bool(c.source_text.strip()),
        "status": c.status, "step": c.step, "progress": c.progress, "error": c.error, "used_ai": c.used_ai,
        "created_at": c.created_at.isoformat() if c.created_at else None,
        "lessons": sum(counts.values()), "lessons_written": counts.get("authored", 0), "lessons_writing": counts.get("generating", 0),
        "lessons_failed": counts.get("failed", 0),
        "resources": db.scalar(select(func.count()).select_from(m.Resource).where(m.Resource.course_id == c.id)) or 0,
    }
