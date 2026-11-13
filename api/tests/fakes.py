"""Test doubles: a fake Claude provider and a fake resource backend (no network, no cost)."""
from __future__ import annotations

import re

from app.content.schemas import (
    GenExercise, GenFlashcard, GenLesson, GenLessonPicks, GenLessonRef, GenMilestone, GenModule, GenModulePicks, GenOutline,
    GenOverview, GenPick, GenProject, GenQuestion, GenSection, GenStage, GenTutorAnswer,
)
from app.services.sources import Candidate


def gen_lesson(title: str) -> GenLesson:
    sec = lambda kind, body, svg="": GenSection(kind=kind, title=f"{kind} of {title}", body=body, svg=svg, caption="")
    return GenLesson(
        overview=GenOverview(what=f"What {title} is", why="It matters", where="Everywhere", prerequisites="None"),
        sections=[
            sec("simple", f"{title} is like a recipe."),
            sec("technical", f"Formally, {title} is defined as $x^2$."),
            sec("example", "Worked example: step 1, step 2."),
            sec("diagram", "", '<svg viewBox="0 0 10 10"><script>x</script><circle cx="5" cy="5" r="3" stroke="currentColor" fill="none"/></svg>'),
            sec("real_world", "Used by professionals daily."),
            sec("mistakes", "People confuse it with something else."),
            sec("when", "Use it when the situation calls for it."),
        ],
        exercise=GenExercise(title="Practice", prompt=f"Apply {title}.", starter="", expected="A correct application", hints=["Start small"],
                             solution="The solution.", explanation="Because.", advanced="Harder version."),
        quiz=[
            GenQuestion(kind="mcq", prompt="Pick B", options=["A", "B", "C"], answer_indices=[1], key_ideas=[], model_answer="", explanation="B is right"),
            GenQuestion(kind="multi", prompt="Pick A and C", options=["A", "B", "C"], answer_indices=[0, 2], key_ideas=[], model_answer="", explanation="A and C"),
            GenQuestion(kind="short", prompt="Define it", options=[], answer_indices=[], key_ideas=[["recipe", "steps"], ["defined", "formal"]],
                        model_answer="A recipe-like formal definition.", explanation="See the lesson"),
            GenQuestion(kind="scenario", prompt="In situation X, what do you do?", options=[], answer_indices=[], key_ideas=[["apply"]],
                        model_answer="Apply it.", explanation="Because"),
            GenQuestion(kind="mcq", prompt="Pick A", options=["A", "B"], answer_indices=[0], key_ideas=[], model_answer="", explanation="A"),
        ],
        flashcards=[GenFlashcard(front=f"Card {i}", back=f"Answer {i}") for i in range(4)],
    )


def gen_outline() -> GenOutline:
    ref = lambda t, covers: GenLessonRef(title=t, minutes=30, level="beginner", objectives=[f"Explain {t}", f"Apply {t}"], covers=covers,
                                         search_queries=[f"{t} guide"])
    return GenOutline(
        title="Linear Algebra for Humans", summary="From vectors to eigenvalues.", academic=False,
        syllabus=["Vectors", "Matrices", "Eigenvalues"], book_queries=["linear algebra"],
        stages=[
            GenStage(title="Foundations", summary="The basics", modules=[
                GenModule(title="Vectors and matrices", summary="Objects", prerequisites=[], search_queries=["vectors matrices"],
                          lessons=[ref("Vectors", ["Vectors"]), ref("Matrices", ["Matrices"])]),
            ]),
            GenStage(title="Core", summary="Deeper", modules=[
                GenModule(title="Spectral ideas", summary="Eigen", prerequisites=[0, 5], search_queries=["eigenvalues"],
                          lessons=[ref("Eigenvalues", ["Eigenvalues"])]),
            ]),
        ],
        projects=[
            GenProject(title="Image compression with SVD", level="capstone", module_index=-1, summary="Compress an image", hours=8,
                       requirements=["Compress", "Report"], milestones=[GenMilestone(title="Prototype", deliverables=["Notebook"])]),
        ],
    )


class FakeLLM:
    def __init__(self, fail_lessons: bool = False):
        self.calls: list[str] = []
        self.fail_lessons = fail_lessons

    def structured(self, *, system, prompt, schema, max_tokens, effort):
        self.calls.append(schema.__name__)
        if schema is GenOutline:
            return gen_outline()
        if schema is GenLesson:
            title = re.search(r"This lesson: (.+?) \(", prompt).group(1)
            lesson = gen_lesson(title)
            if self.fail_lessons:
                lesson.quiz = lesson.quiz[:1]  # never meets the standard
            return lesson
        if schema is GenModulePicks:
            n = len(re.findall(r"^\[\d+\] ", prompt.split("<candidates>")[0], re.M))
            return GenModulePicks(lessons=[GenLessonPicks(lesson=i, picks=[GenPick(candidate=0, role="required", why="Best overview."),
                                                                           GenPick(candidate=99, role="supplementary", why="out of range")])
                                           for i in range(n)])
        if schema is GenTutorAnswer:
            return GenTutorAnswer(answer="Vectors have magnitude and direction [1].", cited=[1], grounded=True)
        raise AssertionError(schema)

    def text(self, **kw):
        return "text"


class FakeSources:
    def __init__(self):
        self.queries: list[str] = []

    def _c(self, query, source, kind, **kw):
        slug = re.sub(r"\W+", "-", query.lower()).strip("-")
        return Candidate(title=kw.pop("title", f"{source} guide to {query}"), url=f"https://{source}.example/{slug}", type=kind, source=source,
                         provider=f"{source}.example", queries={query}, **kw)

    def hn_stories(self, query, min_points=15, limit=12):
        self.queries.append(query)
        return [self._c(query, "hackernews", "article", score=640, comments=210, discussion_url="https://news.ycombinator.com/item?id=1")]

    def hn_recommendations(self, subject, limit=12):
        return [self._c(subject, "hackernews", "book", title=f"The classic {subject} book", recommended_by=4, score=300)]

    def wikipedia(self, query, limit=2):
        return [self._c(query, "wikipedia", "article", title=f"{query} (Wikipedia)", summary=f"{query} is an important topic.")]

    def books(self, query, limit=4):
        return [self._c(query, "openlibrary", "book", title=f"Introduction to {query}", score=250, rating=4.6, isbn="9780000000001")]

    def papers(self, query, limit=3):
        return []

    def youtube(self, query, limit=3):
        return []

    def archive_videos(self, query, limit=3, subject=""):
        return [self._c(query, "internetarchive", "video", title=f"Lecture: {query}", score=50_000, archive_id=re.sub(r"\W+", "-", query.lower()))]

    def hn_videos(self, query, limit=3):
        return []

    def wikipedia_outline(self, subject):
        return [("Basics", ["Introduction", "Key terms"]), ("Advanced topics", ["Deep dive"])]
