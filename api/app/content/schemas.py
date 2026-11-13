"""Schemas for generated content.

`Gen*` models are what Claude is asked to return (structured outputs: plain types, no numeric/length constraints).
They are converted to the strict models below, which enforce the lesson standard before anything is saved.
"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

Level = Literal["beginner", "intermediate", "advanced"]
QuestionKind = Literal["mcq", "multi", "short", "technical", "practical", "scenario"]
SectionKind = Literal["simple", "technical", "example", "diagram", "math", "code", "real_world", "mistakes", "when"]
REQUIRED_SECTIONS = {"simple", "technical", "real_world", "mistakes", "when"}


# ───────────────────────────── Strict lesson standard ─────────────────────────────
class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Section(Strict):
    kind: SectionKind
    title: str = Field(min_length=1, max_length=200)
    body: str | None = None
    svg: str | None = None
    caption: str | None = None

    @model_validator(mode="after")
    def _has_content(self):
        if not (self.body or self.svg):
            raise ValueError(f"section '{self.title}' needs body or svg")
        return self


class ExerciseIn(Strict):
    title: str
    prompt: str
    starter: str | None = None
    expected: str
    hints: list[str] = Field(min_length=1)
    solution: str
    explanation: str
    advanced: str | None = None


class QuestionIn(Strict):
    id: str
    kind: QuestionKind
    prompt: str
    options: list[str] = Field(default_factory=list)
    answer: int | list[int] | None = None
    keywords: list[list[str]] = Field(default_factory=list)
    model_answer: str | None = None
    explanation: str | None = None

    @model_validator(mode="after")
    def _check(self):
        if self.kind == "mcq":
            if len(self.options) < 2 or not isinstance(self.answer, int) or not (0 <= self.answer < len(self.options)):
                raise ValueError(f"{self.id}: mcq needs options and a valid answer index")
        elif self.kind == "multi":
            if len(self.options) < 2 or not isinstance(self.answer, list) or not self.answer or any(not 0 <= a < len(self.options) for a in self.answer):
                raise ValueError(f"{self.id}: multi needs options and a non-empty list of valid indices")
        elif not self.model_answer:
            raise ValueError(f"{self.id}: open questions need a model_answer")
        return self


class Flashcard(Strict):
    front: str = Field(min_length=1)
    back: str = Field(min_length=1)


class Overview(Strict):
    what: str
    why: str
    where: str
    prerequisites: str


class LessonBody(Strict):
    overview: Overview
    sections: list[Section] = Field(min_length=5)
    exercise: ExerciseIn
    quiz: list[QuestionIn] = Field(min_length=5)
    flashcards: list[Flashcard] = Field(min_length=3)

    @model_validator(mode="after")
    def _ladder_complete(self):
        missing = REQUIRED_SECTIONS - {s.kind for s in self.sections}
        if missing:
            raise ValueError(f"lesson is missing concept-ladder sections: {sorted(missing)}")
        kinds = {q.kind for q in self.quiz}
        if not {"mcq", "scenario"} <= kinds:
            raise ValueError("quiz needs at least one mcq and one scenario question")
        return self


# ───────────────────────────── What Claude returns ─────────────────────────────
class GenOverview(BaseModel):
    what: str
    why: str
    where: str
    prerequisites: str


class GenSection(BaseModel):
    kind: SectionKind
    title: str
    body: str = Field(description="Markdown. Use $...$ / $$...$$ for maths and fenced code blocks for code. No raw HTML.")
    svg: str = Field(description="Only for kind=diagram: a self-contained <svg> using basic shapes and text, else empty.")
    caption: str


class GenExercise(BaseModel):
    title: str
    prompt: str
    starter: str = Field(description="Optional starting point (template, code, outline); empty if none.")
    expected: str = Field(description="What a good answer contains or produces.")
    hints: list[str]
    solution: str
    explanation: str
    advanced: str = Field(description="A harder follow-up challenge.")


class GenQuestion(BaseModel):
    kind: QuestionKind
    prompt: str
    options: list[str] = Field(description="Answer choices for mcq/multi; empty for open questions.")
    answer_indices: list[int] = Field(description="Correct option indices (exactly one for mcq); empty for open questions.")
    key_ideas: list[list[str]] = Field(
        description="Open questions only: 2-4 groups of synonyms, each group one key idea a good answer mentions (lowercase)."
    )
    model_answer: str = Field(description="Open questions only: a concise model answer; empty for mcq/multi.")
    explanation: str


class GenFlashcard(BaseModel):
    front: str
    back: str


class GenLesson(BaseModel):
    overview: GenOverview
    sections: list[GenSection]
    exercise: GenExercise
    quiz: list[GenQuestion]
    flashcards: list[GenFlashcard]


class GenLessonRef(BaseModel):
    title: str
    minutes: int
    level: Level
    objectives: list[str]
    covers: list[str] = Field(description="Which syllabus items (verbatim from the syllabus list) this lesson teaches.")
    search_queries: list[str] = Field(description="2-3 short web search queries that would find great material for this lesson.")


class GenModule(BaseModel):
    title: str
    summary: str
    prerequisites: list[int] = Field(description="0-based indices (across the whole course) of EARLIER modules this one needs.")
    search_queries: list[str]
    lessons: list[GenLessonRef]


class GenStage(BaseModel):
    title: str
    summary: str
    modules: list[GenModule]


class GenMilestone(BaseModel):
    title: str
    deliverables: list[str]


class GenProject(BaseModel):
    title: str
    level: Literal["mini", "module", "capstone"]
    module_index: int = Field(description="0-based index of the module this project follows; -1 for a course-level capstone.")
    summary: str
    hours: int
    requirements: list[str]
    milestones: list[GenMilestone]


class GenOutline(BaseModel):
    title: str
    summary: str
    academic: bool = Field(description="True if research papers are useful study material for this subject.")
    syllabus: list[str] = Field(description="Every distinct topic from the learner's material (or the subject's core topics).")
    book_queries: list[str] = Field(description="1-3 queries that would find the best books on the subject.")
    stages: list[GenStage]
    projects: list[GenProject]


class GenPick(BaseModel):
    candidate: int
    role: Literal["required", "supplementary"]
    why: str = Field(description="One sentence: why this is worth the learner's time for this lesson.")


class GenLessonPicks(BaseModel):
    lesson: int
    picks: list[GenPick]


class GenModulePicks(BaseModel):
    lessons: list[GenLessonPicks]


class GenTutorAnswer(BaseModel):
    answer: str = Field(description="Markdown answer grounded in the provided passages.")
    cited: list[int] = Field(description="Numbers of the passages the answer relies on.")
    grounded: bool = Field(description="False if the passages don't contain the answer.")
