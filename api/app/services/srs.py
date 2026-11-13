"""Spaced repetition scheduling — an SM-2 variant with four grades (Again / Hard / Good / Easy).

Intervals grow multiplicatively by the card's ease factor; failures ("Again") reset the card to a short
relearning step and reduce ease. This is the algorithm family used by SuperMemo-2 and Anki.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from ..models import CardState

AGAIN, HARD, GOOD, EASY = 0, 1, 2, 3
MIN_EASE = 1.3
RELEARN = timedelta(minutes=10)


def _q(grade: int) -> int:
    """Map 4-button grade to SM-2 quality 0..5."""
    return {AGAIN: 1, HARD: 3, GOOD: 4, EASY: 5}[grade]


def schedule(card: CardState, grade: int, now: datetime | None = None) -> CardState:
    if grade not in (AGAIN, HARD, GOOD, EASY):
        raise ValueError("grade must be 0 (again), 1 (hard), 2 (good) or 3 (easy)")
    now = now or datetime.now(timezone.utc)
    q = _q(grade)
    card.reviews += 1
    card.last_grade = grade
    card.last_reviewed_at = now
    card.ease = max(MIN_EASE, card.ease + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)))

    if grade == AGAIN:
        card.lapses += 1
        card.repetitions = 0
        card.interval_days = 0.0
        card.due_at = now + RELEARN
        return card

    card.correct += 1
    card.repetitions += 1
    if card.repetitions == 1:
        interval = 1.0
    elif card.repetitions == 2:
        interval = 3.0
    else:
        interval = max(card.interval_days, 1.0) * card.ease
    if grade == HARD:
        interval = max(1.0, max(card.interval_days, 1.0) * 1.2) if card.repetitions > 1 else 1.0
    elif grade == EASY:
        interval *= 1.3
    card.interval_days = round(interval, 2)
    card.due_at = now + timedelta(days=card.interval_days)
    return card


def retention(cards: list[CardState]) -> float | None:
    reviewed = [c for c in cards if c.reviews]
    if not reviewed:
        return None
    return sum(c.correct for c in reviewed) / sum(c.reviews for c in reviewed)
