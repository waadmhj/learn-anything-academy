"""Learning actions: open lessons, track time, exercises, quizzes, objectives and status changes."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import models as m
from ..access import lesson_for, question_for
from ..auth import current_user
from ..db import get_db
from ..services import grading
from ..services import progress as prog

router = APIRouter(tags=["learning"])


def _lesson(db: Session, user: m.User, lesson_id: str) -> m.Lesson:
    return lesson_for(db, user, lesson_id)


def _progress_out(lesson: m.Lesson, p: m.LessonProgress, db: Session, user_id: int) -> dict:
    cards = list(db.scalars(select(m.CardState).where(m.CardState.user_id == user_id, m.CardState.lesson_id == lesson.id)))
    return {
        "status": p.status, "mastery": p.mastery, "quiz_best": p.quiz_best, "quiz_last": p.quiz_last, "exercise_done": p.exercise_done,
        "objectives_checked": p.objectives_checked, "seconds_spent": p.seconds_spent,
    } | prog.evidence(lesson, p, cards)


@router.post("/lessons/{lesson_id}/open")
def open_lesson(lesson_id: str, db: Session = Depends(get_db), user: m.User = Depends(current_user)):
    lesson = _lesson(db, user, lesson_id)
    p = prog.open_lesson(db, user.id, lesson)
    db.commit()
    return _progress_out(lesson, p, db, user.id)


class Heartbeat(BaseModel):
    seconds: int = Field(ge=0, le=600)
    lesson_id: str | None = None


@router.post("/progress/heartbeat", status_code=204)
def heartbeat(body: Heartbeat, db: Session = Depends(get_db), user: m.User = Depends(current_user)):
    if body.lesson_id:
        _lesson(db, user, body.lesson_id)
    prog.add_study_time(db, user.id, body.seconds, body.lesson_id)
    db.commit()


class ExerciseIn(BaseModel):
    code: str = Field(max_length=50_000)
    self_check: Literal["solved", "partial", "stuck"]


@router.post("/lessons/{lesson_id}/exercise")
def submit_exercise(lesson_id: str, body: ExerciseIn, db: Session = Depends(get_db), user: m.User = Depends(current_user)):
    lesson = _lesson(db, user, lesson_id)
    ex = db.scalar(select(m.Exercise).where(m.Exercise.lesson_id == lesson.id))
    if ex is None:
        raise HTTPException(400, "This lesson has no exercise yet")
    if body.self_check != "stuck" and len(body.code.strip()) < 10:
        raise HTTPException(422, "Paste your attempt (at least a few lines) before submitting")
    db.add(m.ExerciseSubmission(user_id=user.id, lesson_id=lesson.id, code=body.code, self_check=body.self_check))
    p = prog.open_lesson(db, user.id, lesson)
    if body.self_check == "solved":
        p.exercise_done = True
    prog.log(db, user.id, "exercise", lesson.id, f"Exercise submitted ({body.self_check}): {lesson.title}")
    prog.refresh(db, user.id, lesson, p)
    db.commit()
    return {"solution": ex.data["solution"], "explanation": ex.data["explanation"], "advanced": ex.data.get("advanced"), "progress": _progress_out(lesson, p, db, user.id)}


class CheckIn(BaseModel):
    response: int | list[int] | str | None = None


@router.post("/questions/{question_id}/check")
def check_question(question_id: str, body: CheckIn, db: Session = Depends(get_db), user: m.User = Depends(current_user)):
    """Stateless feedback used by active recall: answer first, then see why."""
    q = question_for(db, user, question_id)
    return grading.grade(q, body.response).as_dict()


class AnswerIn(BaseModel):
    question_id: str
    response: int | list[int] | str | None = None
    self_grade: Literal["correct", "partial", "incorrect"] | None = None


class QuizIn(BaseModel):
    answers: list[AnswerIn] = Field(min_length=1)


@router.post("/lessons/{lesson_id}/quiz")
def submit_quiz(lesson_id: str, body: QuizIn, db: Session = Depends(get_db), user: m.User = Depends(current_user)):
    lesson = _lesson(db, user, lesson_id)
    questions = {q.id: q for q in db.scalars(select(m.Question).where(m.Question.lesson_id == lesson.id))}
    if not questions:
        raise HTTPException(400, "This lesson has no knowledge check yet")
    given = {a.question_id: a for a in body.answers}
    if set(given) != set(questions):
        raise HTTPException(422, "Answer every question in the knowledge check before submitting")
    results = []
    for qid, q in questions.items():
        a = given[qid]
        if q.kind in grading.OPEN_KINDS and a.self_grade is None:
            raise HTTPException(422, f"Self-grade your answer to question {q.order + 1} after comparing it with the model answer")
        r = grading.grade(q, a.response, a.self_grade)
        db.add(m.QuestionAttempt(user_id=user.id, question_id=qid, lesson_id=lesson.id, mode="lesson", response=a.response, score=r.score))
        results.append(r.as_dict())
    score = round(sum(r["score"] for r in results) / len(results), 3)
    p = prog.open_lesson(db, user.id, lesson)
    p.quiz_last = score
    p.quiz_best = max(p.quiz_best or 0.0, score)
    _activate_cards(db, user.id, lesson)
    prog.log(db, user.id, "quiz", lesson.id, f"Knowledge check {round(score * 100)}%: {lesson.title}")
    db.flush()
    prog.refresh(db, user.id, lesson, p)
    db.commit()
    return {"score": score, "results": results, "progress": _progress_out(lesson, p, db, user.id)}


def _activate_cards(db: Session, user_id: int, lesson: m.Lesson) -> int:
    """Flashcards enter the learner's review deck once they've attempted the lesson's knowledge check."""
    existing = set(db.scalars(select(m.CardState.flashcard_id).where(m.CardState.user_id == user_id, m.CardState.lesson_id == lesson.id)))
    added = 0
    for card in db.scalars(select(m.Flashcard).where(m.Flashcard.lesson_id == lesson.id)):
        if card.id not in existing:
            db.add(m.CardState(user_id=user_id, flashcard_id=card.id, lesson_id=lesson.id, ease=2.5, interval_days=0.0, repetitions=0, lapses=0, reviews=0, correct=0, due_at=datetime.now(timezone.utc)))
            added += 1
    return added


class ObjectivesIn(BaseModel):
    checked: list[int]


@router.put("/lessons/{lesson_id}/objectives")
def set_objectives(lesson_id: str, body: ObjectivesIn, db: Session = Depends(get_db), user: m.User = Depends(current_user)):
    lesson = _lesson(db, user, lesson_id)
    valid = sorted({i for i in body.checked if 0 <= i < len(lesson.objectives)})
    p = prog.open_lesson(db, user.id, lesson)
    p.objectives_checked = valid
    prog.refresh(db, user.id, lesson, p)
    db.commit()
    return _progress_out(lesson, p, db, user.id)


class StatusIn(BaseModel):
    status: Literal["not_started", "in_progress", "completed", "needs_revision", "mastered"]


@router.put("/lessons/{lesson_id}/status")
def set_status(lesson_id: str, body: StatusIn, db: Session = Depends(get_db), user: m.User = Depends(current_user)):
    lesson = _lesson(db, user, lesson_id)
    try:
        p = prog.set_status(db, user.id, lesson, body.status)
    except prog.StatusError as e:
        raise HTTPException(409, str(e)) from e
    db.commit()
    return _progress_out(lesson, p, db, user.id)
