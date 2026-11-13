"""Grading of quiz/revision/interview answers.

* mcq      — exact index match.
* multi    — partial credit: (correct picks − wrong picks) / number of correct options, floored at 0.
* open     — (short/technical/practical/scenario) active recall: the learner writes an answer, sees the model
             answer and a keyword-coverage signal, then self-grades. The recorded score is the self-grade,
             capped by evidence: "correct" requires covering at least half of the key ideas.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

from ..models import Question

OPEN_KINDS = {"short", "technical", "practical", "scenario"}
SELF_GRADES = {"correct": 1.0, "partial": 0.5, "incorrect": 0.0}


@dataclass
class GradeResult:
    question_id: str
    kind: str
    score: float | None  # None = open question awaiting self-grade
    correct: bool | None
    explanation: str | None
    correct_answer: object = None
    model_answer: str | None = None
    keyword_coverage: float | None = None
    matched_ideas: list[str] = field(default_factory=list)
    missed_ideas: list[str] = field(default_factory=list)

    def as_dict(self) -> dict:
        return self.__dict__.copy()


def _norm(text: str) -> str:
    return re.sub(r"\s+", " ", text.lower())


def keyword_coverage(text: str, groups: list[list[str]]) -> tuple[float, list[str], list[str]]:
    """Each group is a set of synonyms for one key idea; an idea counts if any synonym appears."""
    if not groups:
        return 1.0, [], []
    t = _norm(text or "")
    matched, missed = [], []
    for g in groups:
        (matched if any(_norm(k) in t for k in g) else missed).append(g[0])
    return len(matched) / len(groups), matched, missed


def grade(q: Question, response: object, self_grade: str | None = None) -> GradeResult:
    if q.kind == "mcq":
        ok = isinstance(response, int) and response == q.answer
        return GradeResult(q.id, q.kind, 1.0 if ok else 0.0, ok, q.explanation, correct_answer=q.answer)

    if q.kind == "multi":
        picked = set(response) if isinstance(response, list) else set()
        answer = set(q.answer or [])
        right, wrong = len(picked & answer), len(picked - answer)
        score = max(0.0, (right - wrong) / len(answer)) if answer else 0.0
        return GradeResult(q.id, q.kind, round(score, 3), picked == answer, q.explanation, correct_answer=sorted(answer))

    if q.kind in OPEN_KINDS:
        text = response if isinstance(response, str) else ""
        cov, matched, missed = keyword_coverage(text, q.keywords or [])
        score: float | None = None
        if self_grade is not None:
            if self_grade not in SELF_GRADES:
                raise ValueError("self_grade must be correct, partial or incorrect")
            score = SELF_GRADES[self_grade]
            if not text.strip():
                score = 0.0  # a blank answer can't be self-graded as correct
            elif score == 1.0 and cov < 0.5:
                score = 0.5  # evidence cap: claimed correct but covered < half of the key ideas
        return GradeResult(
            q.id, q.kind, score, None if score is None else score >= 1.0, q.explanation,
            model_answer=q.model_answer, keyword_coverage=round(cov, 3), matched_ideas=matched, missed_ideas=missed,
        )

    raise ValueError(f"unknown question kind {q.kind}")
