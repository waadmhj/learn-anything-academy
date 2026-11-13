"""Authentication.

AUTH_MODE=local — a single local learner; no login (the default for personal use).
AUTH_MODE=jwt   — accounts with bcrypt-hashed passwords and signed JWT bearer tokens.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import bcrypt
import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.orm import Session

from .config import get_settings
from .db import get_db
from .models import User

LOCAL_EMAIL = "learner@localhost"
bearer = HTTPBearer(auto_error=False)


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(password: str, hashed: str | None) -> bool:
    return bool(hashed) and bcrypt.checkpw(password.encode(), hashed.encode())


def create_token(user: User) -> str:
    s = get_settings()
    now = datetime.now(timezone.utc)
    return jwt.encode({"sub": str(user.id), "iat": now, "exp": now + timedelta(minutes=s.jwt_ttl_minutes)}, s.jwt_secret, algorithm="HS256")


def local_user(db: Session) -> User:
    user = db.scalar(select(User).where(User.email == LOCAL_EMAIL))
    if user is None:
        user = User(email=LOCAL_EMAIL, display_name="Learner", daily_goal_minutes=45)
        db.add(user)
        db.commit()
    return user


def current_user(creds: HTTPAuthorizationCredentials | None = Depends(bearer), db: Session = Depends(get_db)) -> User:
    s = get_settings()
    if s.auth_mode == "local":
        return local_user(db)
    if creds is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authenticated", headers={"WWW-Authenticate": "Bearer"})
    try:
        payload = jwt.decode(creds.credentials, s.jwt_secret, algorithms=["HS256"])
        user = db.get(User, int(payload["sub"]))
    except (jwt.PyJWTError, KeyError, ValueError):
        user = None
    if user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or expired token", headers={"WWW-Authenticate": "Bearer"})
    return user
