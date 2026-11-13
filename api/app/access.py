"""Ownership checks: a learner can only see and change their own courses and everything inside them.

Every lookup returns 404 (not 403) for someone else's content, so ids can't be probed.
"""
from __future__ import annotations

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from . import models as m


def course_for(db: Session, user: m.User, course_id: int) -> m.Course:
    c = db.get(m.Course, course_id)
    if c is None or c.owner_id != user.id:
        raise HTTPException(404, "Course not found")
    return c


def _owned(db: Session, user: m.User, course_id: int | None) -> bool:
    return course_id is not None and db.scalar(select(m.Course.owner_id).where(m.Course.id == course_id)) == user.id


def lesson_for(db: Session, user: m.User, lesson_id: str) -> m.Lesson:
    lesson = db.get(m.Lesson, lesson_id)
    if lesson is None or not _owned(db, user, lesson.course_id):
        raise HTTPException(404, "Lesson not found")
    return lesson


def module_for(db: Session, user: m.User, module_id: str) -> m.Module:
    mod = db.get(m.Module, module_id)
    if mod is None or not _owned(db, user, mod.course_id):
        raise HTTPException(404, "Module not found")
    return mod


def project_for(db: Session, user: m.User, project_id: str) -> m.Project:
    p = db.get(m.Project, project_id)
    if p is None or not _owned(db, user, p.course_id):
        raise HTTPException(404, "Project not found")
    return p


def resource_for(db: Session, user: m.User, resource_id: str) -> m.Resource:
    r = db.get(m.Resource, resource_id)
    if r is None or not _owned(db, user, r.course_id):
        raise HTTPException(404, "Resource not found")
    return r


def question_for(db: Session, user: m.User, question_id: str) -> m.Question:
    q = db.get(m.Question, question_id)
    if q is None or q.lesson_id is None:
        raise HTTPException(404, "Question not found")
    lesson_for(db, user, q.lesson_id)
    return q


def owned_course_ids(db: Session, user: m.User) -> list[int]:
    return list(db.scalars(select(m.Course.id).where(m.Course.owner_id == user.id)))
