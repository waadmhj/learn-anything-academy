"""Lesson annotations (Notability-style): text highlights, sticky notes and pen/marker ink, plus a cross-lesson notebook."""
from __future__ import annotations

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from sqlalchemy import String, cast, func, or_, select
from sqlalchemy.orm import Session

from .. import models as m
from ..access import lesson_for
from ..auth import current_user
from ..db import get_db

router = APIRouter(tags=["annotations"])

Kind = Literal["highlight", "note", "ink"]
Color = Literal["yellow", "green", "blue", "pink", "purple", "orange", "red", "ink"]
MAX_PER_LESSON = 3000
Scope = Annotated[str, Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")]


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class HighlightData(_Strict):
    scope: Scope
    quote: str = Field(min_length=1, max_length=4000)
    prefix: str = Field(default="", max_length=64)
    suffix: str = Field(default="", max_length=64)
    start: int = Field(ge=0, le=1_000_000)


class NoteData(_Strict):
    scope: Scope
    x: float = Field(ge=0, le=1)
    dy: float = Field(ge=-100_000, le=1_000_000)
    collapsed: bool = False


class InkData(_Strict):
    scope: Scope
    tool: Literal["pen", "marker"]
    size: float = Field(ge=0.5, le=48)
    points: list[tuple[float, float, float]] = Field(min_length=1, max_length=5000)


DATA_MODELS: dict[str, type[_Strict]] = {"highlight": HighlightData, "note": NoteData, "ink": InkData}


def _validate_data(kind: str, data: dict) -> dict:
    try:
        return DATA_MODELS[kind].model_validate(data).model_dump()
    except ValidationError as e:
        raise HTTPException(422, f"Invalid {kind} data: {e.errors()[0]['msg']}") from e


class AnnotationIn(_Strict):
    kind: Kind
    color: Color
    text: str = Field(default="", max_length=20_000)
    pinned: bool = False
    data: dict


class AnnotationPatch(_Strict):
    color: Color | None = None
    text: str | None = Field(default=None, max_length=20_000)
    pinned: bool | None = None
    data: dict | None = None


def _out(a: m.Annotation) -> dict:
    return {
        "id": a.id, "lesson_id": a.lesson_id, "kind": a.kind, "color": a.color, "text": a.text, "pinned": a.pinned,
        "data": a.data, "created_at": a.created_at, "updated_at": a.updated_at,
    }


def _own(db: Session, user: m.User, annotation_id: int) -> m.Annotation:
    a = db.get(m.Annotation, annotation_id)
    if a is None or a.user_id != user.id:
        raise HTTPException(404, "Annotation not found")
    return a


def _lesson(db: Session, user: m.User, lesson_id: str) -> m.Lesson:
    return lesson_for(db, user, lesson_id)


@router.get("/lessons/{lesson_id}/annotations")
def list_annotations(lesson_id: str, db: Session = Depends(get_db), user: m.User = Depends(current_user)):
    _lesson(db, user, lesson_id)
    rows = db.scalars(
        select(m.Annotation).where(m.Annotation.user_id == user.id, m.Annotation.lesson_id == lesson_id).order_by(m.Annotation.id)
    )
    return [_out(a) for a in rows]


@router.post("/lessons/{lesson_id}/annotations", status_code=201)
def create_annotation(lesson_id: str, body: AnnotationIn, db: Session = Depends(get_db), user: m.User = Depends(current_user)):
    _lesson(db, user, lesson_id)
    count = db.scalar(
        select(func.count()).select_from(m.Annotation).where(m.Annotation.user_id == user.id, m.Annotation.lesson_id == lesson_id)
    )
    if count >= MAX_PER_LESSON:
        raise HTTPException(409, f"This lesson already has {MAX_PER_LESSON} annotations. Erase some before adding more.")
    a = m.Annotation(
        user_id=user.id, lesson_id=lesson_id, kind=body.kind, color=body.color, text=body.text, pinned=body.pinned,
        data=_validate_data(body.kind, body.data),
    )
    db.add(a)
    db.commit()
    return _out(a)


@router.patch("/annotations/{annotation_id}")
def update_annotation(annotation_id: int, body: AnnotationPatch, db: Session = Depends(get_db), user: m.User = Depends(current_user)):
    a = _own(db, user, annotation_id)
    if body.color is not None:
        a.color = body.color
    if body.text is not None:
        a.text = body.text
    if body.pinned is not None:
        a.pinned = body.pinned
    if body.data is not None:
        a.data = _validate_data(a.kind, body.data)
    db.commit()
    return _out(a)


@router.delete("/annotations/{annotation_id}", status_code=204)
def delete_annotation(annotation_id: int, db: Session = Depends(get_db), user: m.User = Depends(current_user)):
    db.delete(_own(db, user, annotation_id))
    db.commit()


class BulkDelete(_Strict):
    ids: list[int] = Field(min_length=1, max_length=500)


@router.post("/annotations/delete", status_code=204)
def delete_many(body: BulkDelete, db: Session = Depends(get_db), user: m.User = Depends(current_user)):
    """Used by the eraser, which can remove many strokes in one gesture."""
    rows = db.scalars(select(m.Annotation).where(m.Annotation.user_id == user.id, m.Annotation.id.in_(body.ids)))
    for a in rows:
        db.delete(a)
    db.commit()


@router.get("/notebook")
def notebook(
    kind: Literal["all", "highlight", "note"] = "all",
    pinned: bool = False,
    q: str = Query(default="", max_length=200),
    db: Session = Depends(get_db),
    user: m.User = Depends(current_user),
):
    """Every highlight and sticky note across lessons (ink is page-specific and not listed), pinned first."""
    stmt = select(m.Annotation, m.Lesson.title, m.Course.title).join(m.Lesson, m.Lesson.id == m.Annotation.lesson_id).join(
        m.Course, m.Course.id == m.Lesson.course_id
    ).where(m.Course.owner_id == user.id, m.Annotation.user_id == user.id, m.Annotation.kind.in_(["highlight", "note"] if kind == "all" else [kind]))
    if pinned:
        stmt = stmt.where(m.Annotation.pinned.is_(True))
    if q.strip():
        like = f"%{q.strip()}%"
        stmt = stmt.where(or_(m.Annotation.text.ilike(like), m.Lesson.title.ilike(like), _quote_like(like)))
    stmt = stmt.order_by(m.Annotation.pinned.desc(), m.Annotation.updated_at.desc()).limit(500)
    return [
        _out(a) | {"lesson_title": lesson_title, "module_title": course_title, "course_title": course_title}
        for a, lesson_title, course_title in db.execute(stmt)
    ]


def _quote_like(like: str):
    # The quote lives inside the JSON column; a text cast works on both SQLite and PostgreSQL.
    return cast(m.Annotation.data, String).ilike(like)
