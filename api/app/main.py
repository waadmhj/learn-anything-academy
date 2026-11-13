"""FastAPI application entry point.

Run:  uvicorn app.main:app --reload --port 8000     (from the api/ directory)
"""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from . import models  # noqa: F401  (registers the tables with SQLAlchemy)
from .config import get_settings
from .db import Base, SessionLocal, engine
from .routers import account, annotations, courses, curriculum, learning, practice, projects
from .services.builder import recover_interrupted

log = logging.getLogger("academy")


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(engine)
    with SessionLocal() as db:
        recover_interrupted(db)
    yield


app = FastAPI(title="Learn Anything Academy API", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware, allow_origins=get_settings().cors_list, allow_credentials=True, allow_methods=["*"], allow_headers=["*"],
)


@app.exception_handler(Exception)
async def unhandled(request: Request, exc: Exception):
    log.exception("Unhandled error on %s %s", request.method, request.url.path)
    return JSONResponse(status_code=500, content={"detail": "Internal server error"})


@app.get("/api/health")
def health():
    return {"status": "ok"}


for r in (courses.router, curriculum.router, learning.router, practice.router, projects.router, account.router, annotations.router):
    app.include_router(r, prefix="/api")
