import os
import sys
from pathlib import Path

import pytest

API_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(API_DIR))
os.environ["DATABASE_URL"] = "sqlite:///" + (API_DIR / "test.db").as_posix()
os.environ["AUTH_MODE"] = "local"
os.environ["SYNC_JOBS"] = "1"
os.environ["FETCH_TITLES"] = "0"

from fastapi.testclient import TestClient  # noqa: E402

from app.db import Base, engine  # noqa: E402
from app.main import app  # noqa: E402
from app.services import llm, sources  # noqa: E402
from tests.fakes import FakeLLM, FakeSources  # noqa: E402


@pytest.fixture(scope="session")
def client():
    Base.metadata.drop_all(engine)
    with TestClient(app) as c:
        yield c
    engine.dispose()
    for suffix in ("", "-wal", "-shm"):
        (API_DIR / f"test.db{suffix}").unlink(missing_ok=True)


@pytest.fixture(autouse=True)
def offline():
    """Every test runs without network: fake resource sources, and no AI unless a test asks for it."""
    fake = FakeSources()
    sources.set_backend(fake)
    llm.set_provider(None)
    yield fake
    llm.reset_provider()


@pytest.fixture
def ai():
    fake = FakeLLM()
    llm.set_provider(fake)
    return fake
