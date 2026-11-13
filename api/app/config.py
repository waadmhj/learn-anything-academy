"""Application settings, read from environment variables (and an optional .env file)."""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    database_url: str = f"sqlite:///{(REPO_ROOT / 'api' / 'learn.db').as_posix()}"

    auth_mode: Literal["local", "jwt"] = "local"
    jwt_secret: str = "dev-only-insecure-secret-change-me"
    jwt_ttl_minutes: int = 60 * 24 * 7
    cors_origins: str = "http://localhost:3000"
    public_url: str = "http://localhost:3000"  # this site's address; sent as the contact in API User-Agents (Wikipedia requires one)

    # AI (optional). Without a key, courses are built from the syllabus structure and lessons stay as guided outlines.
    ai_enabled: bool = True
    anthropic_api_key: str = ""
    ai_model: str = "claude-opus-5-5"
    ai_effort: Literal["low", "medium", "high", "xhigh", "max"] = "medium"
    lesson_workers: int = 2  # lessons written in parallel by "Write all lessons"

    # Resource discovery
    youtube_api_key: str = ""  # optional: adds ranked YouTube videos
    fetch_titles: bool = True  # look up page titles for links recommended in Hacker News threads
    http_timeout_seconds: float = 12.0

    max_source_chars: int = 300_000  # ~75k tokens of syllabus/material per course
    max_courses_per_user: int = 50
    sync_jobs: bool = False  # run course building / lesson writing inline (tests)

    @property
    def cors_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
