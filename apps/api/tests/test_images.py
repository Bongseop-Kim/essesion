"""이미지 — 서명 URL·업로드 등록 upsert·정리 배치 2단계 삭제 (domains.md §8)."""

from datetime import UTC, datetime, timedelta

from db.models.images import Image
from sqlalchemy import select

from .factories import auth_headers, make_user

BATCH_HEADERS = {"Authorization": "Bearer test-batch-token"}


async def test_upload_url_validates_type(client, db_session, settings):
    user = await make_user(db_session)
    headers = auth_headers(user, settings)
    bad = await client.post(
        "/images/upload-url",
        json={
            "kind": "repair_shipping_upload",
            "filename": "malware.exe",
            "content_type": "image/png",
        },
        headers=headers,
    )
    assert bad.status_code == 400

    res = await client.post(
        "/images/upload-url",
        json={
            "kind": "repair_shipping_upload",
            "filename": "tie.png",
            "content_type": "image/png",
        },
        headers=headers,
    )
    assert res.status_code == 200
    body = res.json()
    assert body["object_key"].startswith("uploads/repair_shipping_upload/")
    assert body["upload_url"].startswith("https://")  # DryRun URL


async def test_reform_upload_register_upsert_and_ownership(client, db_session, settings):
    owner = await make_user(db_session)
    other = await make_user(db_session)
    issued = await client.post(
        "/images/reform-upload-url",
        json={"filename": "tie.png", "content_type": "image/png", "size_bytes": 100},
    )
    assert issued.status_code == 200
    key = issued.json()["object_key"]
    claim_token = issued.json()["claim_token"]
    assert claim_token
    assert issued.json()["required_headers"]["x-goog-content-length-range"].endswith(
        str(10 * 1024 * 1024)
    )

    first = await client.post(
        "/images/reform-uploads",
        json={"object_key": key, "claim_token": claim_token, "size_bytes": 100},
    )
    assert first.status_code == 201

    # claim token 보유자가 로그인하면 소유권을 인계한다.
    again = await client.post(
        "/images/reform-uploads",
        json={"object_key": key, "claim_token": claim_token, "size_bytes": 100},
        headers=auth_headers(owner, settings),
    )
    assert again.status_code == 201
    assert again.json()["id"] == first.json()["id"]

    # 타인 재등록 → 소유권 충돌
    conflict = await client.post(
        "/images/reform-uploads",
        json={"object_key": key, "size_bytes": 100},
        headers=auth_headers(other, settings),
    )
    assert conflict.status_code == 409


async def test_cleanup_images_two_phase(app, client, db_session):
    user = await make_user(db_session)
    expired = Image(
        object_key="uploads/quote/old.png",
        entity_type="quote_request",
        entity_id="q1",
        uploaded_by=user.id,
        expires_at=datetime.now(UTC) - timedelta(days=1),
    )
    keep = Image(
        object_key="uploads/quote/keep.png",
        entity_type="quote_request",
        entity_id="q2",
        uploaded_by=user.id,
    )
    db_session.add_all([expired, keep])
    await db_session.commit()

    res = await client.post("/batch/cleanup-images", headers=BATCH_HEADERS)
    assert res.status_code == 200
    assert res.json()["processed"] == 1
    assert app.state.gcs.deleted == ["uploads/quote/old.png"]

    rows = {i.object_key: i for i in (await db_session.scalars(select(Image))).all()}
    assert rows["uploads/quote/old.png"].deleted_at is not None
    assert rows["uploads/quote/old.png"].deletion_claimed_at is not None
    assert rows["uploads/quote/keep.png"].deleted_at is None

    # 재실행 — 이미 삭제된 것은 대상 아님
    res = await client.post("/batch/cleanup-images", headers=BATCH_HEADERS)
    assert res.json()["processed"] == 0
