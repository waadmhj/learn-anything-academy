"""Lesson progress, mastery scoring and status rules (server-enforced).

Statuses: not_started → in_progress → completed → mastered, plus needs_revision.
Opening a lesson never completes it. Completion and mastery require evidence.
"""
from __future__ import annotations

from datetime import date, datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import models as m
from .srs import retention

STATUSES = ("not_started", "in_progress", "completed", "needs_revision", "mastered")
COMPLETE_QUIZ = 0.70
MASTER_QUIZ = 0.85
MASTER_SCORE = 0.85
REVISION_THRESHOLD = 0.60
DONE_STATUSES = ("completed", "mastered", "needs_revision")


class StatusError(ValueError):
    pass


def now() -> datetime:
    return datetime.now(timezone.utc)


def get_progress(db: Session, user_id: int, lesson_id: str, create: bool = True) -> m.LessonProgress | None:
    p = db.scalar(select(m.LessonProgress).where(m.LessonProgress.user_id == user_id, m.LessonProgress.lesson_id == lesson_id))
    if p is None and create:
        p = m.LessonProgress(user_id=user_id, lesson_id=lesson_id, status="not_started", mastery=0.0, objectives_checked=[], seconds_spent=0, exercise_done=False)
        db.add(p)
        db.flush()
    return p


def progress_map(db: Session, user_id: int) -> dict[str, m.LessonProgress]:
    return {p.lesson_id: p for p in db.scalars(select(m.LessonProgress).where(m.LessonProgress.user_id == user_id))}


def log(db: Session, user_id: int, kind: str, ref_id: str | None, detail: str) -> None:
    db.add(m.Activity(user_id=user_id, kind=kind, ref_id=ref_id, detail=detail[:500]))


def _cards(db: Session, user_id: int, lesson_id: str) -> list[m.CardState]:
    return list(db.scalars(select(m.CardState).where(m.CardState.user_id == user_id, m.CardState.lesson_id == lesson_id)))


def compute_mastery(lesson: m.Lesson, p: m.LessonProgress, cards: list[m.CardState]) -> float:
    if lesson.status != "authored":
        n = len(lesson.objectives) or 1
        return round(0.7 * min(len(set(p.objectives_checked or [])), n) / n, 3)  # self-reported: capped at 70%
    parts: list[tuple[float, float]] = [(0.60, p.quiz_best or 0.0), (0.25, 1.0 if p.exercise_done else 0.0)]
    r = retention(cards)
    if r is not None:
        parts.append((0.15, r))
    total = sum(w for w, _ in parts)
    return round(sum(w * v for w, v in parts) / total, 3)


def evidence(lesson: m.Lesson, p: m.LessonProgress, cards: list[m.CardState]) -> dict[str, bool]:
    if lesson.status != "authored":
        all_objectives = len(set(p.objectives_checked or [])) >= len(lesson.objectives)
        return {"can_complete": all_objectives, "can_master": False}
    lapsed = any(c.lapses >= 2 and c.last_grade == 0 for c in cards)
    can_complete = (p.quiz_best or 0) >= COMPLETE_QUIZ
    can_master = can_complete and (p.quiz_best or 0) >= MASTER_QUIZ and p.exercise_done and not lapsed and p.mastery >= MASTER_SCORE
    return {"can_complete": can_complete, "can_master": can_master}


def refresh(db: Session, user_id: int, lesson: m.Lesson, p: m.LessonProgress) -> m.LessonProgress:
    """Recompute mastery and derive status from evidence (never demotes a manual needs_revision)."""
    cards = _cards(db, user_id, lesson.id)
    p.mastery = compute_mastery(lesson, p, cards)
    ev = evidence(lesson, p, cards)
    before = p.status
    r = retention(cards)
    struggling = (p.quiz_last is not None and p.quiz_last < REVISION_THRESHOLD and before in DONE_STATUSES) or (
        r is not None and sum(c.reviews for c in cards) >= 3 and r < REVISION_THRESHOLD
    )
    if struggling:
        p.status = "needs_revision"
    elif ev["can_master"]:
        p.status = "mastered"
    elif ev["can_complete"] and before != "needs_revision":
        p.status = "completed"
    elif ev["can_complete"] and before == "needs_revision" and p.quiz_last is not None and p.quiz_last >= COMPLETE_QUIZ:
        p.status = "completed"  # revision done: passed the quiz again
    elif before == "not_started":
        p.status = "in_progress"
    if p.status in ("completed", "mastered") and p.completed_at is None:
        p.completed_at = now()
    if p.status != before:
        log(db, user_id, "status", lesson.id, f"{lesson.title}: {before.replace('_', ' ')} → {p.status.replace('_', ' ')}")
    return p


def open_lesson(db: Session, user_id: int, lesson: m.Lesson) -> m.LessonProgress:
    p = get_progress(db, user_id, lesson.id)
    if p.status == "not_started":
        p.status = "in_progress"
        p.started_at = now()
        log(db, user_id, "started", lesson.id, f"Started {lesson.title}")
    return p


def set_status(db: Session, user_id: int, lesson: m.Lesson, status: str) -> m.LessonProgress:
    if status not in STATUSES:
        raise StatusError(f"unknown status {status}")
    p = get_progress(db, user_id, lesson.id)
    cards = _cards(db, user_id, lesson.id)
    p.mastery = compute_mastery(lesson, p, cards)
    ev = evidence(lesson, p, cards)
    if status == "completed" and not ev["can_complete"]:
        raise StatusError(
            "Complete the knowledge check with at least 70% first." if lesson.status == "authored" else "Check off every learning objective first."
        )
    if status == "mastered" and not ev["can_master"]:
        raise StatusError(
            "Mastery requires ≥85% on the knowledge check, a submitted exercise and no repeatedly-failed flashcards."
            if lesson.status == "authored" else "Write the full lesson first: mastery needs its knowledge check and exercise."
        )
    before = p.status
    p.status = status
    if status == "not_started":
        p.started_at = None
    if status in ("completed", "mastered") and p.completed_at is None:
        p.completed_at = now()
    if before != status:
        log(db, user_id, "status", lesson.id, f"{lesson.title}: marked {status.replace('_', ' ')}")
    return p


def add_study_time(db: Session, user_id: int, seconds: int, lesson_id: str | None = None) -> None:
    seconds = max(0, min(int(seconds), 120))  # heartbeat cap prevents inflated hours
    if not seconds:
        return
    today = date.today()
    s = db.scalar(select(m.StudySession).where(m.StudySession.user_id == user_id, m.StudySession.day == today))
    if s is None:
        s = m.StudySession(user_id=user_id, day=today, seconds=0)
        db.add(s)
    s.seconds += seconds
    if lesson_id:
        p = get_progress(db, user_id, lesson_id)
        p.seconds_spent += seconds


def streak(db: Session, user_id: int) -> tuple[int, int]:
    """(current streak, longest streak) in days with ≥ 60 s of study."""
    days = sorted({s.day for s in db.scalars(select(m.StudySession).where(m.StudySession.user_id == user_id, m.StudySession.seconds >= 60))})
    if not days:
        return 0, 0
    longest = run = 1
    for a, b in zip(days, days[1:]):
        run = run + 1 if (b - a).days == 1 else 1
        longest = max(longest, run)
    today = date.today()
    current = 0
    if (today - days[-1]).days <= 1:
        current = 1
        for a, b in zip(reversed(days[:-1]), reversed(days[1:])):
            if (b - a).days == 1:
                current += 1
            else:
                break
    return current, longest
