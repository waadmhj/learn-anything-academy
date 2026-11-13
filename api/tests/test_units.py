from datetime import datetime, timedelta, timezone
import pytest

from app.models import CardState, Question
from app.services import grading, srs

def q(kind, **kw):
    return Question(id="t:q", kind=kind, prompt="p", options=kw.get("options", []), answer=kw.get("answer"), keywords=kw.get("keywords", []), model_answer=kw.get("model_answer"), explanation="e")


def test_mcq():
    assert grading.grade(q("mcq", options=["a", "b"], answer=1), 1).score == 1.0
    assert grading.grade(q("mcq", options=["a", "b"], answer=1), 0).score == 0.0


def test_multi_partial_credit_and_penalty():
    question = q("multi", options=list("abcd"), answer=[0, 2])
    assert grading.grade(question, [0, 2]).score == 1.0
    assert grading.grade(question, [0]).score == 0.5
    assert grading.grade(question, [0, 1]).score == 0.0  # one right, one wrong
    assert grading.grade(question, [1, 3]).score == 0.0


def test_open_requires_self_grade_and_caps_unsupported_claims():
    question = q("technical", keywords=[["identity"], ["value", "equal"]], model_answer="m")
    pending = grading.grade(question, "it checks identity")
    assert pending.score is None and pending.keyword_coverage == 0.5
    assert grading.grade(question, "identity vs value", "correct").score == 1.0
    assert grading.grade(question, "no idea", "correct").score == 0.5  # evidence cap
    assert grading.grade(question, "   ", "partial").score == 0.0
    with pytest.raises(ValueError):
        grading.grade(question, "x", "great")


def _card():
    return CardState(ease=2.5, interval_days=0.0, repetitions=0, lapses=0, reviews=0, correct=0)


def test_srs_intervals_grow_and_lapse_resets():
    now = datetime(2026, 1, 1, tzinfo=timezone.utc)
    c = _card()
    srs.schedule(c, srs.GOOD, now)
    assert c.interval_days == 1.0
    srs.schedule(c, srs.GOOD, now)
    assert c.interval_days == 3.0
    srs.schedule(c, srs.GOOD, now)
    assert c.interval_days == pytest.approx(3.0 * c.ease, rel=0.01)
    srs.schedule(c, srs.AGAIN, now)
    assert c.repetitions == 0 and c.lapses == 1 and c.due_at - now == timedelta(minutes=10)
    assert c.ease >= srs.MIN_EASE


def test_srs_easy_beats_hard():
    now = datetime(2026, 1, 1, tzinfo=timezone.utc)
    a, b = _card(), _card()
    for card, grade in ((a, srs.EASY), (b, srs.HARD)):
        for _ in range(3):
            srs.schedule(card, grade, now)
    assert a.interval_days > b.interval_days
    assert srs.retention([a, b]) == 1.0


def test_parse_syllabus_headings_numbering_and_flat_lists():
    from app.services.builder import parse_syllabus

    md = "# Week 1: Foundations\n- Sets\n- Functions\n\n# Week 2: Limits\n- Epsilon-delta\n- Continuity\n"
    assert parse_syllabus(md) == [("Week 1: Foundations", ["Sets", "Functions"]), ("Week 2: Limits", ["Epsilon-delta", "Continuity"])]
    numbered = "1. Phonetics\n1.1 Vowels\n1.2 Consonants\n2. Grammar\n2.1 Articles\n"
    assert parse_syllabus(numbered) == [("Phonetics", ["Vowels", "Consonants"]), ("Grammar", ["Articles"])]
    flat = "\n".join(f"- Topic {i}" for i in range(7))
    tree = parse_syllabus(flat)
    assert [len(ls) for _, ls in tree] == [5, 2]


def test_svg_sanitizer_strips_scripts_handlers_and_external_refs():
    from app.services.svg import sanitize

    dirty = (
        '<svg viewBox="0 0 10 10" onload="alert(1)"><script>alert(1)</script>'
        '<rect x="1" y="1" width="5" height="5" fill="url(http://evil/x)" onclick="x()"/>'
        '<a href="javascript:alert(1)"><text x="1" y="9">hi</text></a>'
        '<foreignObject><div>x</div></foreignObject><circle cx="5" cy="5" r="2" stroke="currentColor"/></svg>'
    )
    clean = sanitize(dirty)
    assert clean and "<circle" in clean and "<rect" in clean
    for bad in ("script", "onload", "onclick", "javascript", "foreignObject", "http://evil", "<a"):
        assert bad not in clean
    assert sanitize("<div>not svg</div>") is None
    assert sanitize('<!DOCTYPE svg [<!ENTITY x "y">]><svg>&x;</svg>') is None


def test_generated_lesson_must_meet_the_standard():
    from pydantic import ValidationError

    from app.services.builder import to_lesson_body
    from tests.fakes import gen_lesson

    body = to_lesson_body(gen_lesson("Vectors"))
    assert {s.kind for s in body.sections} >= {"simple", "technical", "real_world", "mistakes", "when"}
    assert body.quiz[0].answer == 1 and body.quiz[2].keywords
    broken = gen_lesson("Vectors")
    broken.sections = broken.sections[:2]
    with pytest.raises(ValidationError):
        to_lesson_body(broken)


def test_excerpt_keeps_relevant_chunks_within_budget():
    from app.services.textsearch import excerpt

    text = "\n\n".join([f"Paragraph {i} about gardening and soil." for i in range(300)] + ["Eigenvalues measure how a matrix stretches vectors."])
    out = excerpt(text, "eigenvalues matrix", budget=2000)
    assert "Eigenvalues" in out and len(out) <= 2100
