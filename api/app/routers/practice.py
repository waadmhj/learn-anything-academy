"""Knowledge retention: flashcards (spaced repetition), revision mode and exam answers."""
from __future__ import annotations

import random
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import models as m
from ..access import course_for, question_for
from ..auth import current_user
from ..db import get_db
from ..services import grading, srs
from ..services import progress as prog

router = APIRouter(tags=["practice"])

def _now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(dt: datetime) -> datetime:
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


@router.get("/flashcards/due")
def due_cards(limit: int = Query(20, ge=1, le=100), lesson_id: str | None = None, course_id: int | None = None, db: Session = Depends(get_db), user: m.User = Depends(current_user)):
    stmt = select(m.CardState, m.Flashcard, m.Lesson.title).join(m.Flashcard, m.Flashcard.id == m.CardState.flashcard_id).join(m.Lesson, m.Lesson.id == m.CardState.lesson_id).where(m.CardState.user_id == user.id)
    if course_id is not None:
        stmt = stmt.where(m.Lesson.course_id == course_id)
    if lesson_id:
        stmt = stmt.where(m.CardState.lesson_id == lesson_id)
    else:
        stmt = stmt.where(m.CardState.due_at <= _now())
    rows = db.execute(stmt.order_by(m.CardState.due_at).limit(limit)).all()
    return [{"id": c.flashcard_id, "front": f.front, "back": f.back, "lesson_id": c.lesson_id, "lesson_title": t, "reviews": c.reviews, "lapses": c.lapses, "interval_days": c.interval_days} for c, f, t in rows]


@router.get("/flashcards/stats")
def card_stats(db: Session = Depends(get_db), user: m.User = Depends(current_user)):
    cards = list(db.scalars(select(m.CardState).where(m.CardState.user_id == user.id)))
    now = _now()
    horizon = [0] * 7
    for c in cards:
        d = (_aware(c.due_at) - now).days
        if 0 <= d < 7:
            horizon[d] += 1
    return {
        "total": len(cards), "due": sum(1 for c in cards if _aware(c.due_at) <= now), "new": sum(1 for c in cards if c.reviews == 0),
        "mature": sum(1 for c in cards if c.interval_days >= 21), "retention": srs.retention(cards), "next_7_days": horizon,
        "lapsed": sum(1 for c in cards if c.lapses >= 2),
    }


class ReviewIn(BaseModel):
    grade: Literal[0, 1, 2, 3]


@router.post("/flashcards/{card_id}/review")
def review_card(card_id: str, body: ReviewIn, db: Session = Depends(get_db), user: m.User = Depends(current_user)):
    card = db.scalar(select(m.CardState).where(m.CardState.user_id == user.id, m.CardState.flashcard_id == card_id))
    if card is None:
        raise HTTPException(404, "Card not in your deck — attempt the lesson's knowledge check first")
    srs.schedule(card, body.grade)
    lesson = db.get(m.Lesson, card.lesson_id)
    p = prog.get_progress(db, user.id, lesson.id)
    db.flush()
    prog.refresh(db, user.id, lesson, p)
    db.commit()
    return {"id": card_id, "due_at": _aware(card.due_at).isoformat(), "interval_days": card.interval_days, "ease": round(card.ease, 2)}


def _question_out(q: m.Question, lesson_title: str | None = None) -> dict:
    return {"id": q.id, "kind": q.kind, "prompt": q.prompt, "options": q.options, "lesson_id": q.lesson_id, "lesson_title": lesson_title, "track": q.track}


@router.get("/courses/{course_id}/revision")
def revision_session(course_id: int, n: int = Query(10, ge=3, le=40), db: Session = Depends(get_db), user: m.User = Depends(current_user)):
    """Mixed questions from this course's lessons you've studied, weakest first (cumulative assessment)."""
    course_for(db, user, course_id)
    in_course = select(m.Lesson.id).where(m.Lesson.course_id == course_id)
    studied = {p.lesson_id: p for p in db.scalars(select(m.LessonProgress).where(
        m.LessonProgress.user_id == user.id, m.LessonProgress.quiz_best.is_not(None), m.LessonProgress.lesson_id.in_(in_course)))}
    if not studied:
        return {"questions": [], "reason": "Complete at least one knowledge check to unlock revision mode."}
    acc = defaultdict(list)
    for qid, score in db.execute(select(m.QuestionAttempt.question_id, m.QuestionAttempt.score).where(m.QuestionAttempt.user_id == user.id)).all():
        acc[qid].append(score)
    questions = list(db.scalars(select(m.Question).where(m.Question.lesson_id.in_(studied.keys()))))
    titles = {l.id: l.title for l in db.scalars(select(m.Lesson).where(m.Lesson.id.in_(studied.keys())))}

    def weakness(q: m.Question) -> float:
        hist = acc.get(q.id, [])
        q_acc = sum(hist[-3:]) / len(hist[-3:]) if hist else 0.5
        return q_acc * 0.6 + studied[q.lesson_id].mastery * 0.4 + random.random() * 0.15  # jitter keeps sessions varied

    questions.sort(key=weakness)
    return {"questions": [_question_out(q, titles.get(q.lesson_id)) for q in questions[:n]], "reason": None}


class AttemptIn(BaseModel):
    response: int | list[int] | str | None = None
    self_grade: Literal["correct", "partial", "incorrect"] | None = None
    mode: Literal["revision", "exam"]


@router.post("/questions/{question_id}/attempt")
def record_attempt(question_id: str, body: AttemptIn, db: Session = Depends(get_db), user: m.User = Depends(current_user)):
    q = question_for(db, user, question_id)
    if q.kind in grading.OPEN_KINDS and body.self_grade is None:
        raise HTTPException(422, "Self-grade open answers after comparing with the model answer")
    r = grading.grade(q, body.response, body.self_grade)
    db.add(m.QuestionAttempt(user_id=user.id, question_id=q.id, lesson_id=q.lesson_id, mode=body.mode, response=body.response, score=r.score))
    db.flush()
    if q.lesson_id and body.mode == "revision":
        _revision_signal(db, user.id, q.lesson_id)
    db.commit()
    return r.as_dict()


def _revision_signal(db: Session, user_id: int, lesson_id: str) -> None:
    """If recent revision answers for a completed lesson average < 60%, flag it for revision automatically."""
    since = _now() - timedelta(days=30)
    scores = list(db.scalars(
        select(m.QuestionAttempt.score).where(m.QuestionAttempt.user_id == user_id, m.QuestionAttempt.lesson_id == lesson_id, m.QuestionAttempt.mode == "revision", m.QuestionAttempt.created_at >= since)
        .order_by(m.QuestionAttempt.created_at.desc()).limit(5)
    ))
    p = prog.get_progress(db, user_id, lesson_id, create=False)
    if p and len(scores) >= 3 and sum(scores) / len(scores) < prog.REVISION_THRESHOLD and p.status in ("completed", "mastered"):
        p.status = "needs_revision"
        lesson = db.get(m.Lesson, lesson_id)
        prog.log(db, user_id, "status", lesson_id, f"{lesson.title}: flagged for revision after low revision scores")
