"""Projects: catalog, workspaces, milestones, decisions (ADRs), rubric self-assessment and submission."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, HttpUrl
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from .. import models as m
from ..access import course_for, project_for
from ..auth import current_user
from ..db import get_db
from ..services.insights import module_state
from ..services.progress import log, progress_map

router = APIRouter(tags=["projects"])
LEVEL_POINTS = {"exemplary": 1.0, "proficient": 0.7, "developing": 0.3}


def _pp(db: Session, user_id: int, project_id: str, create: bool = False) -> m.ProjectProgress | None:
    pp = db.scalar(select(m.ProjectProgress).where(m.ProjectProgress.user_id == user_id, m.ProjectProgress.project_id == project_id))
    if pp is None and create:
        pp = m.ProjectProgress(user_id=user_id, project_id=project_id, status="not_started", notes="", decisions=[], rubric_scores={})
        db.add(pp)
        db.flush()
    return pp


def _rubric_score(project: m.Project, scores: dict) -> float | None:
    if not project.rubric:
        return None
    total = sum(c.weight for c in project.rubric)
    got = sum(c.weight * LEVEL_POINTS.get(scores.get(c.id, ""), 0.0) for c in project.rubric)
    return round(got / total, 3) if total else None


@router.get("/courses/{course_id}/projects")
def list_projects(course_id: int, db: Session = Depends(get_db), user: m.User = Depends(current_user)):
    course_for(db, user, course_id)
    projects = list(db.scalars(select(m.Project).where(m.Project.course_id == course_id).order_by(m.Project.order).options(selectinload(m.Project.milestones))))
    mine = {pp.project_id: pp for pp in db.scalars(select(m.ProjectProgress).where(m.ProjectProgress.user_id == user.id))}
    done_ms = {mp.milestone_id for mp in db.scalars(select(m.MilestoneProgress).where(m.MilestoneProgress.user_id == user.id, m.MilestoneProgress.done.is_(True)))}
    prog = progress_map(db, user.id)
    modules = {mod.id: mod for mod in db.scalars(select(m.Module).where(m.Module.course_id == course_id).options(selectinload(m.Module.lessons)))}
    out = []
    for p in projects:
        pre = p.prerequisites or ([p.module_id] if p.module_id else [])
        ready = all(module_state(modules[mid], prog)["complete"] for mid in pre if mid in modules)
        pp = mine.get(p.id)
        out.append({
            "id": p.id, "level": p.level, "title": p.title, "summary": p.summary, "hours": p.hours, "module_id": p.module_id,
            "module_title": modules[p.module_id].title if p.module_id in modules else None, "prerequisites": pre, "ready": ready,
            "status": pp.status if pp else "not_started", "milestones": len(p.milestones), "milestones_done": sum(1 for ms in p.milestones if ms.id in done_ms),
        })
    return out


@router.get("/projects/{project_id}")
def get_project(project_id: str, db: Session = Depends(get_db), user: m.User = Depends(current_user)):
    p = project_for(db, user, project_id)
    pp = _pp(db, user.id, p.id)
    ms_state = {mp.milestone_id: mp for mp in db.scalars(select(m.MilestoneProgress).where(m.MilestoneProgress.user_id == user.id, m.MilestoneProgress.project_id == p.id))}
    modules = {mod.id: mod.title for mod in db.scalars(select(m.Module).where(m.Module.course_id == p.course_id))}
    return {
        "id": p.id, "course_id": p.course_id, "level": p.level, "title": p.title, "summary": p.summary, "hours": p.hours, "covers": p.covers, "spec": p.spec,
        "module": {"id": p.module_id, "title": modules.get(p.module_id)} if p.module_id else None,
        "prerequisites": [{"id": mid, "title": modules.get(mid, mid)} for mid in (p.prerequisites or [])],
        "milestones": [{"id": ms.id, "title": ms.title, "deliverables": ms.deliverables, "done": bool(ms_state.get(ms.id) and ms_state[ms.id].done), "evidence_url": ms_state[ms.id].evidence_url if ms.id in ms_state else None} for ms in p.milestones],
        "rubric": [{"id": c.id, "criterion": c.criterion, "weight": c.weight, "levels": c.levels} for c in p.rubric],
        "progress": None if pp is None else {
            "status": pp.status, "repo_url": pp.repo_url, "demo_url": pp.demo_url, "notes": pp.notes, "decisions": pp.decisions,
            "rubric_scores": pp.rubric_scores, "rubric_score": _rubric_score(p, pp.rubric_scores or {}),
            "started_at": pp.started_at.isoformat() if pp.started_at else None, "submitted_at": pp.submitted_at.isoformat() if pp.submitted_at else None,
        },
    }


class Decision(BaseModel):
    title: str = Field(min_length=3, max_length=200)
    decision: str = Field(min_length=3, max_length=2000)
    rationale: str = Field(min_length=3, max_length=4000)


class ProjectUpdate(BaseModel):
    status: Literal["not_started", "in_progress", "submitted", "completed"] | None = None
    repo_url: HttpUrl | None = None
    demo_url: HttpUrl | None = None
    notes: str | None = Field(None, max_length=20_000)
    decisions: list[Decision] | None = None
    rubric_scores: dict[str, Literal["exemplary", "proficient", "developing"]] | None = None


@router.put("/projects/{project_id}/progress")
def update_project(project_id: str, body: ProjectUpdate, db: Session = Depends(get_db), user: m.User = Depends(current_user)):
    p = project_for(db, user, project_id)
    pp = _pp(db, user.id, p.id, create=True)
    now = datetime.now(timezone.utc)
    if body.repo_url is not None:
        pp.repo_url = str(body.repo_url)
    if body.demo_url is not None:
        pp.demo_url = str(body.demo_url)
    if body.notes is not None:
        pp.notes = body.notes
    if body.decisions is not None:
        pp.decisions = [d.model_dump() for d in body.decisions]
    if body.rubric_scores is not None:
        valid = {c.id for c in p.rubric}
        pp.rubric_scores = {k: v for k, v in body.rubric_scores.items() if k in valid}
    if body.status and body.status != pp.status:
        if body.status in ("submitted", "completed"):
            done = {mp.milestone_id for mp in db.scalars(select(m.MilestoneProgress).where(m.MilestoneProgress.user_id == user.id, m.MilestoneProgress.project_id == p.id, m.MilestoneProgress.done.is_(True)))}
            if len(done) < len(p.milestones):
                raise HTTPException(409, "Complete every milestone before submitting")
            if not pp.repo_url:
                raise HTTPException(409, "Add a link to your work (repository, document, video…) before submitting")
            if p.level in ("capstone", "portfolio"):
                if len(pp.decisions or []) < 2:
                    raise HTTPException(409, "Record at least two key decisions or reflections before submitting a capstone")
                if body.status == "completed" and len(pp.rubric_scores or {}) < len(p.rubric):
                    raise HTTPException(409, "Self-assess every rubric criterion before marking the capstone complete")
            pp.submitted_at = pp.submitted_at or now
        if body.status == "in_progress" and pp.started_at is None:
            pp.started_at = now
        log(db, user.id, "project", p.id, f"{p.title}: {body.status.replace('_', ' ')}")
        pp.status = body.status
    db.commit()
    return get_project(project_id, db, user)


class MilestoneUpdate(BaseModel):
    done: bool
    evidence_url: HttpUrl | None = None


@router.put("/projects/{project_id}/milestones/{milestone_id}")
def update_milestone(project_id: str, milestone_id: str, body: MilestoneUpdate, db: Session = Depends(get_db), user: m.User = Depends(current_user)):
    project_for(db, user, project_id)
    ms = db.get(m.ProjectMilestone, milestone_id)
    if ms is None or ms.project_id != project_id:
        raise HTTPException(404, "Milestone not found")
    project = db.get(m.Project, project_id)
    if body.done and project.level in ("capstone", "portfolio") and body.evidence_url is None:
        raise HTTPException(422, "Link evidence (a document, photo, recording, repository…) to complete a capstone milestone")
    mp = db.scalar(select(m.MilestoneProgress).where(m.MilestoneProgress.user_id == user.id, m.MilestoneProgress.milestone_id == milestone_id))
    if mp is None:
        mp = m.MilestoneProgress(user_id=user.id, milestone_id=milestone_id, project_id=project_id, done=False)
        db.add(mp)
    mp.done = body.done
    mp.evidence_url = str(body.evidence_url) if body.evidence_url else mp.evidence_url
    pp = _pp(db, user.id, project_id, create=True)
    if pp.status == "not_started":
        pp.status, pp.started_at = "in_progress", datetime.now(timezone.utc)
    if body.done:
        log(db, user.id, "milestone", project_id, f"{project.title}: {ms.title}")
    db.commit()
    return get_project(project_id, db, user)
