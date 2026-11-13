"""End-to-end API behaviour: building courses (with and without AI), learning, isolation and cleanup."""
from app import models as m
from app.db import SessionLocal

SYLLABUS = """# Week 1: Getting started
- What is gardening
- Soil types

# Week 2: Planting
- Seeds and seedlings
- Watering schedules
"""


def make(client, **kw):
    files = kw.pop("files", None)
    data = {"subject": kw.pop("subject", "Home gardening"), "level": "beginner", "hours_per_week": 4} | kw
    r = client.post("/api/courses", data=data, files=files)
    assert r.status_code == 201, r.text
    return r.json()


def test_health(client):
    assert client.get("/api/health").json() == {"status": "ok"}
    assert client.get("/api/ai/status").json()["available"] is False


def test_build_from_syllabus_without_ai(client, offline):
    c = make(client, text=SYLLABUS)
    assert c["status"] == "ready" and c["used_ai"] is False
    cur = client.get(f"/api/courses/{c['id']}/curriculum").json()
    modules = [mod for s in cur for mod in s["modules"]]
    assert [mo["title"] for mo in modules] == ["Week 1: Getting started", "Week 2: Planting"]
    assert [l["title"] for l in modules[1]["lessons"]] == ["Seeds and seedlings", "Watering schedules"]
    assert modules[1]["prerequisites"] == [modules[0]["id"]]
    lesson = client.get(f"/api/lessons/{modules[0]['lessons'][0]['id']}").json()
    assert lesson["content_status"] == "outline" and lesson["can_write"] is False
    assert lesson["resources"], "every lesson gets real resources"
    assert any(r["source"] == "wikipedia" for r in lesson["resources"])
    assert any(r["role"] == "required" for r in lesson["resources"])
    cov = client.get(f"/api/courses/{c['id']}/coverage").json()
    assert cov["topics"] == 4 and cov["covered"] == 4
    # Writing lessons needs AI
    assert client.post(f"/api/lessons/{lesson['id']}/write").status_code == 409
    # The tutor still answers, extractively
    a = client.post(f"/api/courses/{c['id']}/tutor/ask", json={"question": "Which soil types are there?"}).json()
    assert a["ok"] and a["used_llm"] is False and a["sources"]


def test_no_material_uses_subject_structure(client):
    c = make(client, subject="Photosynthesis")
    assert c["status"] == "ready"
    titles = [mo["title"] for s in client.get(f"/api/courses/{c['id']}/curriculum").json() for mo in s["modules"]]
    assert titles == ["Basics", "Advanced topics"]


def test_upload_and_limits(client):
    c = make(client, files={"file": ("syllabus.md", SYLLABUS.encode(), "text/markdown")})
    assert c["source_name"] == "syllabus.md" and c["has_material"]
    r = client.post("/api/courses", data={"subject": "X"}, files={"file": ("virus.exe", b"MZ", "application/octet-stream")})
    assert r.status_code == 422
    r = client.post("/api/courses", data={"subject": "Huge", "text": "word " * 70_000})
    assert r.status_code == 422 and "limit" in r.json()["detail"]


def test_build_with_ai_writes_first_lesson_and_lessons_on_demand(client, ai):
    c = make(client, subject="Linear algebra", goal="Understand ML maths")
    assert c["status"] == "ready" and c["used_ai"] and c["title"] == "Linear Algebra for Humans"
    assert c["lessons"] == 3 and c["lessons_written"] == 1
    assert "GenOutline" in ai.calls and "GenModulePicks" in ai.calls
    cur = client.get(f"/api/courses/{c['id']}/curriculum").json()
    mods = [mo for s in cur for mo in s["modules"]]
    assert mods[1]["prerequisites"] == [mods[0]["id"]], "invalid prerequisite indices are dropped"
    first, second = mods[0]["lessons"][0], mods[0]["lessons"][1]
    lesson = client.get(f"/api/lessons/{first['id']}").json()
    assert lesson["content_status"] == "authored" and len(lesson["quiz"]) == 5 and lesson["flashcards"] == 4
    diagram = next(s for s in lesson["sections"] if s["kind"] == "diagram")
    assert "<circle" in diagram["svg"] and "script" not in diagram["svg"]
    assert all(r["role"] in ("required", "supplementary") for r in lesson["resources"]) and len(lesson["resources"]) == 1

    r = client.post(f"/api/lessons/{second['id']}/write").json()
    assert r["status"] == "authored"
    assert client.post(f"/api/lessons/{second['id']}/write").status_code == 409

    # The full learning loop works on generated lessons
    answers = []
    for q in lesson["quiz"]:
        if q["kind"] == "mcq":
            answers.append({"question_id": q["id"], "response": 1 if q["prompt"] == "Pick B" else 0})
        elif q["kind"] == "multi":
            answers.append({"question_id": q["id"], "response": [0, 2]})
        else:
            answers.append({"question_id": q["id"], "response": "a recipe with formal steps, apply it", "self_grade": "correct"})
    res = client.post(f"/api/lessons/{first['id']}/quiz", json={"answers": answers}).json()
    assert res["score"] >= 0.9 and res["progress"]["status"] == "completed"
    assert len(client.get("/api/flashcards/due", params={"course_id": c["id"]}).json()) == 4

    projects = client.get(f"/api/courses/{c['id']}/projects").json()
    assert [p["level"] for p in projects] == ["capstone"]
    detail = client.get(f"/api/projects/{projects[0]['id']}").json()
    assert detail["rubric"] and detail["milestones"][0]["title"] == "Prototype"

    exam = client.get(f"/api/courses/{c['id']}/exam", params={"n": 5}).json()
    assert len(exam) == 5
    tutor = client.post(f"/api/courses/{c['id']}/tutor/ask", json={"question": "What is a vector?", "lesson_id": first["id"], "scope": "lesson"}).json()
    assert tutor["used_llm"] and tutor["sources"]

    dash = client.get(f"/api/courses/{c['id']}/dashboard").json()
    assert dash["totals"]["lessons"] == 3 and dash["totals"]["completed"] == 1 and dash["course"]["id"] == c["id"]

    write_all = client.post(f"/api/courses/{c['id']}/write-all").json()
    assert write_all["queued"] == 1 and write_all["course"]["lessons_written"] == 3


def test_lesson_that_fails_validation_is_marked_failed(client, ai):
    c = make(client, subject="Linear algebra")
    ai.fail_lessons = True
    lessons = [l for s in client.get(f"/api/courses/{c['id']}/curriculum").json() for mo in s["modules"] for l in mo["lessons"]]
    r = client.post(f"/api/lessons/{lessons[1]['id']}/write").json()
    assert r["status"] == "failed" and "standard" in r["error"]
    ai.fail_lessons = False
    assert client.post(f"/api/lessons/{lessons[1]['id']}/write").json()["status"] == "authored", "failed lessons can be retried"


def test_other_peoples_courses_are_invisible(client):
    with SessionLocal() as db:
        other = m.User(email="other@example.com", display_name="Other")
        db.add(other)
        db.flush()
        course = m.Course(owner_id=other.id, title="Secret", subject="Secret", status="ready")
        db.add(course)
        db.flush()
        db.add(m.Stage(id=f"c{course.id}-s1", course_id=course.id, order=1, title="S", summary=""))
        db.add(m.Module(id=f"c{course.id}-m01", course_id=course.id, stage_id=f"c{course.id}-s1", order=0, title="M", summary=""))
        db.add(m.Lesson(id=f"c{course.id}-l001", course_id=course.id, module_id=f"c{course.id}-m01", order=0, global_order=1, title="L",
                        level="beginner", minutes=10, status="outline", objectives=["x"]))
        db.commit()
        cid = course.id
    assert client.get(f"/api/courses/{cid}").status_code == 404
    assert client.get(f"/api/courses/{cid}/curriculum").status_code == 404
    assert client.get(f"/api/lessons/c{cid}-l001").status_code == 404
    assert client.post(f"/api/lessons/c{cid}-l001/open").status_code == 404
    assert client.get(f"/api/lessons/c{cid}-l001/annotations").status_code == 404
    assert client.get(f"/api/modules/c{cid}-m01").status_code == 404
    assert all(x["id"] != cid for x in client.get("/api/courses").json())
    assert client.get("/api/search", params={"q": "Secret"}).json()["courses"] == []


def test_delete_course_removes_content_and_my_progress(client):
    c = make(client, text=SYLLABUS)
    lesson_id = client.get(f"/api/courses/{c['id']}/curriculum").json()[0]["modules"][0]["lessons"][0]["id"]
    client.post(f"/api/lessons/{lesson_id}/open")
    client.post(f"/api/lessons/{lesson_id}/annotations", json={"kind": "note", "color": "yellow", "data": {"scope": "overview", "x": 0.1, "dy": 5}})
    assert client.delete(f"/api/courses/{c['id']}").status_code == 204
    assert client.get(f"/api/courses/{c['id']}").status_code == 404
    with SessionLocal() as db:
        assert db.get(m.Lesson, lesson_id) is None
        assert db.query(m.LessonProgress).filter_by(lesson_id=lesson_id).count() == 0
        assert db.query(m.Annotation).filter_by(lesson_id=lesson_id).count() == 0
        assert db.query(m.Resource).filter_by(course_id=c["id"]).count() == 0


def test_opening_does_not_complete(client):
    c = make(client, text=SYLLABUS)
    lid = client.get(f"/api/courses/{c['id']}/curriculum").json()[0]["modules"][0]["lessons"][0]["id"]
    p = client.post(f"/api/lessons/{lid}/open").json()
    assert p["status"] == "in_progress" and p["mastery"] == 0
    assert client.put(f"/api/lessons/{lid}/status", json={"status": "completed"}).status_code == 409
    p = client.put(f"/api/lessons/{lid}/objectives", json={"checked": [0, 1, 2]}).json()
    assert p["status"] == "completed" and p["mastery"] <= 0.7
