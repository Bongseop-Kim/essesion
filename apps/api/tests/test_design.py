"""디자인 세션 골격 — 턴 seq 직렬화·예산 카운터 초기값."""

from .factories import auth_headers, make_user


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
