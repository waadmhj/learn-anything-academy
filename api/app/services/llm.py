"""Claude access for course building, lesson writing and the tutor.

The platform works without an AI key (courses are built from the syllabus structure and lessons stay as guided
outlines). With a key, Claude writes outlines, full lessons, resource picks and tutor answers.

Tests install a fake provider with `set_provider(...)` so no network calls or costs happen.
"""
from __future__ import annotations

import logging
import os
from typing import Protocol, TypeVar

from pydantic import BaseModel

from ..config import get_settings

log = logging.getLogger("academy.llm")
T = TypeVar("T", bound=BaseModel)


class LLMError(Exception):
    """Generation failed in a way the learner should see (refusal, truncation, API error)."""


class Provider(Protocol):
    def structured(self, *, system: str, prompt: str, schema: type[T], max_tokens: int, effort: str) -> T: ...

    def text(self, *, system: str, prompt: str, max_tokens: int, effort: str) -> str: ...


class ClaudeProvider:
    """Anthropic SDK. Uses structured outputs (validated Pydantic objects) and server-side refusal fallbacks."""

    def __init__(self) -> None:
        import anthropic  # imported lazily so the app runs without the package configured

        self._anthropic = anthropic
        self.client = anthropic.Anthropic(max_retries=3)
        self.model = get_settings().ai_model

    def _call(self, fn, **kwargs):
        a = self._anthropic
        try:
            return fn(
                model=self.model,
                betas=["server-side-fallback-2026-07-01"],
                fallbacks="default",
                **kwargs,
            )
        except a.AuthenticationError as e:
            raise LLMError("The AI key was rejected. Check ANTHROPIC_API_KEY.") from e
        except a.PermissionDeniedError as e:
            raise LLMError("The AI key doesn't have permission to use this model.") from e
        except a.RateLimitError as e:
            raise LLMError("The AI service is rate-limiting requests. Try again in a minute.") from e
        except a.BadRequestError as e:
            raise LLMError(f"The AI request was rejected: {e.message}") from e
        except a.APIStatusError as e:
            raise LLMError(f"The AI service returned an error ({e.status_code}). Try again later.") from e
        except a.APIConnectionError as e:
            raise LLMError("Couldn't reach the AI service. Check the server's internet connection.") from e

    @staticmethod
    def _check(resp) -> None:
        if resp.stop_reason == "refusal":
            raise LLMError("The AI declined to write this content.")
        if resp.stop_reason == "max_tokens":
            raise LLMError("The AI response was cut off before it finished.")

    def structured(self, *, system: str, prompt: str, schema: type[T], max_tokens: int, effort: str) -> T:
        resp = self._call(
            self.client.beta.messages.parse,
            max_tokens=max_tokens,
            system=system,
            messages=[{"role": "user", "content": prompt}],
            output_format=schema,
            output_config={"effort": effort},
        )
        self._check(resp)
        if resp.parsed_output is None:
            raise LLMError("The AI response didn't match the expected structure.")
        return resp.parsed_output

    def text(self, *, system: str, prompt: str, max_tokens: int, effort: str) -> str:
        resp = self._call(
            self.client.beta.messages.create,
            max_tokens=max_tokens,
            system=system,
            messages=[{"role": "user", "content": prompt}],
            output_config={"effort": effort},
        )
        self._check(resp)
        return "".join(b.text for b in resp.content if b.type == "text").strip()


_provider: Provider | None = None
_override = False


def set_provider(p: Provider | None) -> None:
    """Install a provider (tests) or None to force 'no AI'."""
    global _provider, _override
    _provider, _override = p, True


def reset_provider() -> None:
    global _provider, _override
    _provider, _override = None, False


def _has_credentials() -> bool:
    s = get_settings()
    return bool(s.anthropic_api_key or os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN"))


def provider() -> Provider | None:
    global _provider
    if _override:
        return _provider
    if _provider is None and get_settings().ai_enabled and _has_credentials():
        s = get_settings()
        if s.anthropic_api_key and not os.environ.get("ANTHROPIC_API_KEY"):
            os.environ["ANTHROPIC_API_KEY"] = s.anthropic_api_key  # the SDK reads the key from the environment
        try:
            _provider = ClaudeProvider()
        except Exception:  # pragma: no cover - misconfigured SDK
            log.exception("Couldn't initialise the Claude client")
            return None
    return _provider


def available() -> bool:
    return provider() is not None
