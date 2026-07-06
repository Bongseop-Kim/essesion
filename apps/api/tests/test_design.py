"""디자인 세션 골격 — 턴 seq 직렬화·예산 카운터 초기값."""

import json
from pathlib import Path

from .factories import auth_headers, make_user


class FakeWorker:
    def __init__(self):
        self.generate_payloads = []
        self.finalize_jobs = []

    async def generate(self, payload):
        self.generate_payloads.append(payload)
        return {
            "request_id": "rid-worker",
            "registry_version": "0.1.0",
            "engine_version": "0.1.0",
            "warnings": [],
            "candidates": [
                {
                    "id": "cand-1",
                    "design_index": 0,
                    "layout_id": "layout-1",
                    "source_fidelity": "vector",
                    "colorway_id": "default",
                    "seed": 7,
                    "svg": "<svg/>",
                    "png_object_key": "previews/rid-worker/cand-1.png",
                }
            ],
        }

    async def finalize_job(self, job_id):
        self.finalize_jobs.append(job_id)
        return {"status": "succeeded"}

    async def aclose(self):
        pass


async def test_session_lifecycle_and_turns(client, db_session, settings):
    user = await make_user(db_session)
    headers = auth_headers(user, settings)

    session = (await client.post("/design/sessions", headers=headers)).json()
    assert session["status"] == "active"
    assert session["recraft_used"] == 0 and session["finalize_used"] == 0

    sid = session["id"]
    turn1 = await client.post(
        f"/design/sessions/{sid}/turns",
        json={"role": "user", "payload": {"prompt": "잔잔한 페이즐리"}},
        headers=headers,
    )
    turn2 = await client.post(
        f"/design/sessions/{sid}/turns",
        json={"role": "assistant", "payload": {"candidates": []}},
        headers=headers,
    )
    assert turn1.json()["seq"] == 1 and turn2.json()["seq"] == 2

    turns = (await client.get(f"/design/sessions/{sid}/turns", headers=headers)).json()
    assert [t["seq"] for t in turns] == [1, 2]

    updated = await client.patch(
        f"/design/sessions/{sid}",
        json={"seed": 42, "colorway": "navy"},
        headers=headers,
    )
    assert updated.json()["seed"] == 42


async def test_generate_and_finalize_job(client, app, db_session, settings):
    app.state.worker = FakeWorker()
    user = await make_user(db_session)
    headers = auth_headers(user, settings)
    design_session = (await client.post("/design/sessions", headers=headers)).json()
    intent_path = Path(__file__).parents[2] / "worker/tests/golden/json/01_background_solid.json"
    intent = json.loads(intent_path.read_text())

    generated = await client.post(
        "/design/generate",
        json={
            "session_id": design_session["id"],
            "intent": intent,
            "seed": 7,
            "candidate_count": 1,
        },
        headers=headers,
    )
    assert generated.status_code == 200
    assert generated.json()["candidates"][0]["id"] == "cand-1"

    turns = (
        await client.get(f"/design/sessions/{design_session['id']}/turns", headers=headers)
    ).json()
    assert turns[-1]["payload"]["type"] == "generate"

    job = await client.post(
        f"/design/sessions/{design_session['id']}/finalize",
        json={"dpi": 300},
        headers=headers,
    )
    assert job.status_code == 201
    assert job.json()["status"] == "queued"

    fetched = await client.get(f"/design/jobs/{job.json()['id']}", headers=headers)
    assert fetched.json()["kind"] == "finalize"
