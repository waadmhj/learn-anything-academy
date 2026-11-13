"""Highlights, sticky notes, ink and the notebook."""
import pytest

SYLLABUS = "# Basics\n- Variables\n- Types\n- Names\n"


@pytest.fixture(scope="module")
def lessons(client):
    c = client.post("/api/courses", data={"subject": "Python basics", "text": SYLLABUS}).json()
    return [l["id"] for s in client.get(f"/api/courses/{c['id']}/curriculum").json() for mo in s["modules"] for l in mo["lessons"]]

HL = {"kind": "highlight", "color": "yellow", "data": {"scope": "s-0", "quote": "variables are names", "prefix": "In Python ", "suffix": " bound to", "start": 10}}
NOTE = {"kind": "note", "color": "pink", "text": "Remember: names, not boxes", "data": {"scope": "overview", "x": 0.4, "dy": 120}}
INK = {"kind": "ink", "color": "blue", "data": {"scope": "s-1", "tool": "pen", "size": 3, "points": [[0.1, 5, 0.5], [0.2, 9, 0.6]]}}


def test_create_list_update_delete(client, lessons):
    ids = [client.post(f"/api/lessons/{lessons[0]}/annotations", json=body).json()["id"] for body in (HL, NOTE, INK)]
    rows = client.get(f"/api/lessons/{lessons[0]}/annotations").json()
    assert [r["kind"] for r in rows if r["id"] in ids] == ["highlight", "note", "ink"]

    r = client.patch(f"/api/annotations/{ids[0]}", json={"text": "key idea", "pinned": True, "color": "green"}).json()
    assert (r["text"], r["pinned"], r["color"]) == ("key idea", True, "green")
    moved = client.patch(f"/api/annotations/{ids[1]}", json={"data": {"scope": "s-2", "x": 0.7, "dy": 40, "collapsed": True}})
    assert moved.json()["data"]["collapsed"] is True

    assert client.delete(f"/api/annotations/{ids[2]}").status_code == 204
    assert client.delete(f"/api/annotations/{ids[2]}").status_code == 404


def test_validation(client, lessons):
    bad_scope = HL | {"data": HL["data"] | {"scope": "<script>"}}
    assert client.post(f"/api/lessons/{lessons[0]}/annotations", json=bad_scope).status_code == 422
    wrong_shape = NOTE | {"data": INK["data"]}  # ink data on a note
    assert client.post(f"/api/lessons/{lessons[0]}/annotations", json=wrong_shape).status_code == 422
    assert client.post(f"/api/lessons/{lessons[0]}/annotations", json=NOTE | {"color": "chartreuse"}).status_code == 422
    assert client.post("/api/lessons/nope/annotations", json=NOTE).status_code == 404
    note = client.post(f"/api/lessons/{lessons[0]}/annotations", json=NOTE).json()
    # Patching data is validated against the annotation's own kind.
    assert client.patch(f"/api/annotations/{note['id']}", json={"data": HL["data"]}).status_code == 422


def test_bulk_delete_for_eraser(client, lessons):
    ids = [client.post(f"/api/lessons/{lessons[1]}/annotations", json=INK).json()["id"] for _ in range(3)]
    assert client.post("/api/annotations/delete", json={"ids": ids[:2]}).status_code == 204
    left = [r["id"] for r in client.get(f"/api/lessons/{lessons[1]}/annotations").json()]
    assert ids[2] in left and ids[0] not in left


def test_notebook_pinned_first_and_filters(client, lessons):
    a = client.post(f"/api/lessons/{lessons[2]}/annotations", json=NOTE | {"text": "cosine similarity intuition"}).json()
    b = client.post(f"/api/lessons/{lessons[2]}/annotations", json=HL | {"pinned": True}).json()
    client.post(f"/api/lessons/{lessons[2]}/annotations", json=INK)

    rows = client.get("/api/notebook").json()
    assert all(r["kind"] != "ink" for r in rows)
    assert rows[0]["pinned"] is True
    assert {"lesson_title", "module_title"} <= rows[0].keys()

    pinned = client.get("/api/notebook", params={"pinned": True}).json()
    assert b["id"] in [r["id"] for r in pinned] and a["id"] not in [r["id"] for r in pinned]
    found = client.get("/api/notebook", params={"q": "cosine"}).json()
    assert [r["id"] for r in found] == [a["id"]]
    by_quote = client.get("/api/notebook", params={"q": "variables are names", "kind": "highlight"}).json()
    assert b["id"] in [r["id"] for r in by_quote]
