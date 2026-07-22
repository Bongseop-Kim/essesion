"""finalize 계정 쿼터 — 24시간 윈도우 카운트·advisory lock 직렬화·관리자 한도.

실 Postgres(testcontainers) 경유 — conftest가 테스트마다 TRUNCATE하므로
마이그레이션이 시드한 design_finalize_daily_limit 행은 남지 않는다. 쿼터가
필요한 테스트는 seed_setting으로 직접 시드한다.
"""

import asyncio
import uuid
from datetime import UTC, datetime, timedelta

import pytest
from api.domains.design.quota import parse_finalize_limit
from db.models.design import GenerationJob
from sqlalchemy import select

from .factories import auth_headers, make_admin, make_user, seed_setting

LIMIT_KEY = "design_finalize_daily_limit"
INTENT = {"canvas": {"tile_mm": 24}, "layers": []}


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("0", 0),
        (" 010 ", 10),
        ("1000", 1000),
        ("", None),
        ("-1", None),
        ("1001", None),
        ("1.5", None),
        ("invalid", None),
    ],
)
def test_parse_finalize_limit(value, expected):
    assert parse_finalize_limit(value) == expected


async def _seed_limit(db_session, limit):
    await seed_setting(db_session, LIMIT_KEY, str(limit))


async def _make_session(client, headers) -> str:
    response = await client.post("/design/sessions", headers=headers)
    assert response.status_code == 201
    return response.json()["id"]


async def _post_finalize(client, headers, session_id):
    return await client.post(
        f"/design/sessions/{session_id}/finalize",
        json={"intent": INTENT},
        headers=headers,
    )


async def _add_job(db_session, user, *, status="queued", created_at=None) -> GenerationJob:
    """세션 없는 finalize job — 쿼터는 계정 스코프라 session_id NULL도 카운트된다."""
    job = GenerationJob(user_id=user.id, kind="finalize", status=status, params={"intent": {}})
    if created_at is not None:
        job.created_at = created_at
        job.updated_at = created_at
    db_session.add(job)
    await db_session.commit()
    await db_session.refresh(job)
    return job


async def test_quota_exhaustion_returns_409_with_reset_hint(client, db_session, settings):
    user = await make_user(db_session)
    await _seed_limit(db_session, 2)
    headers = auth_headers(user, settings)
    session_id = await _make_session(client, headers)

    assert (await _post_finalize(client, headers, session_id)).status_code == 201
    assert (await _post_finalize(client, headers, session_id)).status_code == 201

    third = await _post_finalize(client, headers, session_id)
    assert third.status_code == 409
    body = third.json()
    assert body["code"] == "finalize_quota_exhausted"
    assert "최근 24시간 실사화 한도(2회)" in body["detail"]
    # 방금 만든 job이 가장 오래된 카운트 — 리셋까지 약 24시간
    assert "약 24시간 후" in body["detail"]


async def test_failed_and_canceled_jobs_free_quota_slots(client, db_session, settings):
    user = await make_user(db_session)
    await _seed_limit(db_session, 1)
    headers = auth_headers(user, settings)
    session_id = await _make_session(client, headers)

    first = await _post_finalize(client, headers, session_id)
    assert first.status_code == 201
    assert (await _post_finalize(client, headers, session_id)).status_code == 409

    # 취소하면 카운트에서 빠져 슬롯이 풀린다
    cancel = await client.post(f"/design/jobs/{first.json()['id']}/cancel", headers=headers)
    assert cancel.status_code == 200
    second = await _post_finalize(client, headers, session_id)
    assert second.status_code == 201

    # failed 전이도 동일하게 슬롯을 해제한다
    job = await db_session.get(GenerationJob, uuid.UUID(second.json()["id"]))
    assert job is not None
    job.status = "failed"
    job.error_message = "test failure"
    await db_session.commit()
    assert (await _post_finalize(client, headers, session_id)).status_code == 201


async def test_jobs_outside_24h_window_do_not_count(client, db_session, settings):
    user = await make_user(db_session)
    await _seed_limit(db_session, 1)
    headers = auth_headers(user, settings)
    session_id = await _make_session(client, headers)
    await _add_job(db_session, user, created_at=datetime.now(UTC) - timedelta(hours=25))

    assert (await _post_finalize(client, headers, session_id)).status_code == 201
    # 윈도우 안의 새 job이 한도를 채웠다
    assert (await _post_finalize(client, headers, session_id)).status_code == 409


async def test_session_response_exposes_quota_with_reset_at(client, db_session, settings):
    user = await make_user(db_session)
    await _seed_limit(db_session, 5)
    headers = auth_headers(user, settings)
    session_id = await _make_session(client, headers)

    # 카운트 0 — reset_at 없음
    empty = (await client.get(f"/design/sessions/{session_id}", headers=headers)).json()
    assert empty["finalize_quota"] == {
        "limit": 5,
        "used": 0,
        "remaining": 5,
        "reset_at": None,
    }

    now = datetime.now(UTC)
    oldest = await _add_job(db_session, user, created_at=now - timedelta(hours=2))
    await _add_job(db_session, user, created_at=now - timedelta(hours=1))

    body = (await client.get(f"/design/sessions/{session_id}", headers=headers)).json()
    quota = body["finalize_quota"]
    assert quota["limit"] == 5
    assert quota["used"] == 2
    assert quota["remaining"] == 3
    # 가장 오래된 카운트 job + 24h에 슬롯이 하나 풀린다
    reset_at = datetime.fromisoformat(quota["reset_at"])
    assert reset_at == oldest.created_at + timedelta(hours=24)
    # 세션 목록은 쿼터를 싣지 않는다 (단건 GET 전용)
    listed = (await client.get("/design/sessions", headers=headers)).json()
    assert listed[0]["finalize_quota"] is None


async def test_admin_can_adjust_limit_and_rejects_invalid_values(client, db_session, settings):
    admin = await make_admin(db_session)
    user = await make_user(db_session)
    # GET /admin/settings는 allowlist 전 키의 행 존재를 요구한다
    await seed_setting(db_session, "default_courier_company", "롯데택배")
    await seed_setting(db_session, "design_token_initial_grant", "30")
    await seed_setting(db_session, "authoring_pipeline_mode", "legacy")
    await seed_setting(db_session, "authoring_shadow_percent", "5")
    await seed_setting(db_session, "authoring_canary_percent", "10")
    await _seed_limit(db_session, 0)
    admin_headers = auth_headers(admin, settings)
    user_headers = auth_headers(user, settings)
    session_id = await _make_session(client, user_headers)

    # 한도 0 — 즉시 소진 상태
    assert (await _post_finalize(client, user_headers, session_id)).status_code == 409

    rows = (await client.get("/admin/settings", headers=admin_headers)).json()
    row = next(item for item in rows if item["key"] == LIMIT_KEY)
    updated = await client.put(
        "/admin/settings",
        json={
            "operation_id": str(uuid.uuid4()),
            "reason": "실사화 한도 상향",
            "items": [{"key": LIMIT_KEY, "value": "2", "expected_updated_at": row["updated_at"]}],
        },
        headers=admin_headers,
    )
    assert updated.status_code == 200
    assert (await _post_finalize(client, user_headers, session_id)).status_code == 201

    fresh = next(
        item
        for item in (await client.get("/admin/settings", headers=admin_headers)).json()
        if item["key"] == LIMIT_KEY
    )
    invalid = await client.put(
        "/admin/settings",
        json={
            "operation_id": str(uuid.uuid4()),
            "reason": "잘못된 값 시도",
            "items": [
                {"key": LIMIT_KEY, "value": "abc", "expected_updated_at": fresh["updated_at"]}
            ],
        },
        headers=admin_headers,
    )
    assert invalid.status_code == 422
    assert invalid.json()["code"] == "invalid_setting"


async def test_missing_or_invalid_limit_configuration(client, db_session, settings):
    user = await make_user(db_session)
    headers = auth_headers(user, settings)
    session_id = await _make_session(client, headers)

    # 설정 행 부재 — 생성은 503, 표시(GET 세션)는 관대하게 null
    response = await _post_finalize(client, headers, session_id)
    assert response.status_code == 503
    assert response.json()["code"] == "missing_configuration"
    fetched = (await client.get(f"/design/sessions/{session_id}", headers=headers)).json()
    assert fetched["finalize_quota"] is None

    # 비정수 값 — 생성·조회 모두 invalid_configuration
    await seed_setting(db_session, LIMIT_KEY, "not-a-number")
    invalid = await _post_finalize(client, headers, session_id)
    assert invalid.status_code == 503
    assert invalid.json()["code"] == "invalid_configuration"


async def test_concurrent_requests_cannot_exceed_limit(client, db_session, settings):
    user = await make_user(db_session)
    await _seed_limit(db_session, 1)
    headers = auth_headers(user, settings)
    session_id = await _make_session(client, headers)

    responses = await asyncio.gather(
        _post_finalize(client, headers, session_id),
        _post_finalize(client, headers, session_id),
    )

    # advisory lock이 계정 단위로 직렬화 — 정확히 한 건만 성공한다
    assert sorted(r.status_code for r in responses) == [201, 409]
    jobs = (
        await db_session.scalars(select(GenerationJob).where(GenerationJob.user_id == user.id))
    ).all()
    assert len(jobs) == 1
