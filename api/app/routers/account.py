"""Dashboard, analytics, settings and authentication."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from .. import models as m
from ..auth import create_token, current_user, hash_password, verify_password
from ..config import get_settings
from ..db import get_db
from ..services import insights

router = APIRouter(tags=["account"])


@router.get("/activity")
def activity(limit: int = 30, db: Session = Depends(get_db), user: m.User = Depends(current_user)):
    return insights.recent_activity(db, user.id, min(max(limit, 1), 100))


class SettingsIn(BaseModel):
    display_name: str | None = Field(None, min_length=1, max_length=120)
    daily_goal_minutes: int | None = Field(None, ge=5, le=600)


@router.get("/settings")
def get_settings_(user: m.User = Depends(current_user)):
    s = get_settings()
    return {"display_name": user.display_name, "email": user.email, "daily_goal_minutes": user.daily_goal_minutes, "auth_mode": s.auth_mode}


@router.put("/settings")
def put_settings(body: SettingsIn, db: Session = Depends(get_db), user: m.User = Depends(current_user)):
    if body.display_name is not None:
        user.display_name = body.display_name.strip()
    if body.daily_goal_minutes is not None:
        user.daily_goal_minutes = body.daily_goal_minutes
    db.merge(user)
    db.commit()
    return get_settings_(user)


class ResetIn(BaseModel):
    confirm: str


@router.post("/settings/reset-progress", status_code=204)
def reset_progress(body: ResetIn, db: Session = Depends(get_db), user: m.User = Depends(current_user)):
    """Irreversibly delete this learner's progress (content is untouched)."""
    if body.confirm != "RESET":
        raise HTTPException(422, 'Type "RESET" to confirm')
    for model in (m.LessonProgress, m.QuestionAttempt, m.ExerciseSubmission, m.CardState, m.ProjectProgress, m.MilestoneProgress, m.StudySession, m.Activity):
        db.execute(delete(model).where(model.user_id == user.id))
    db.commit()


class RegisterIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=10, max_length=200)
    display_name: str = Field(min_length=1, max_length=120)


class LoginIn(BaseModel):
    email: EmailStr
    password: str


def _require_jwt():
    if get_settings().auth_mode != "jwt":
        raise HTTPException(400, "Accounts are disabled in local mode (AUTH_MODE=local)")


@router.post("/auth/register", status_code=201)
def register(body: RegisterIn, db: Session = Depends(get_db)):
    _require_jwt()
    if db.scalar(select(m.User).where(m.User.email == body.email.lower())):
        raise HTTPException(409, "An account with this email already exists")
    user = m.User(email=body.email.lower(), display_name=body.display_name, password_hash=hash_password(body.password))
    db.add(user)
    db.commit()
    return {"token": create_token(user)}


@router.post("/auth/login")
def login(body: LoginIn, db: Session = Depends(get_db)):
    _require_jwt()
    user = db.scalar(select(m.User).where(m.User.email == body.email.lower()))
    if user is None or not verify_password(body.password, user.password_hash):
        raise HTTPException(401, "Incorrect email or password")
    return {"token": create_token(user)}


@router.get("/auth/me")
def me(user: m.User = Depends(current_user)):
    return {"id": user.id, "email": user.email, "display_name": user.display_name, "auth_mode": get_settings().auth_mode}
