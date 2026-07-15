"""이미지 — 서명 URL·업로드 등록 upsert·정리 배치 2단계 삭제 (domains.md §8)."""

from datetime import UTC, datetime, timedelta

from api.integrations.gcs import DryRunGcsClient, GcsObjectMetadata
from db.models.images import Image
from sqlalchemy import select

from .factories import auth_headers, make_user

BATCH_HEADERS = {"Authorization": "Bearer test-batch-token"}


class _MetadataGcs(DryRunGcsClient):
    upload_required = True

    def __init__(self) -> None:
        super().__init__()
        self.metadata: dict[str, GcsObjectMetadata] = {}

    async def object_metadata(
        self, object_key: str, *, bucket_name: str | None = None
    ) -> GcsObjectMetadata | None:
        return self.metadata.get(object_key)


class _FailOneDeleteGcs(DryRunGcsClient):
    def __init__(self, failed_key: str) -> None:
        super().__init__()
        self.failed_key = failed_key

    async def delete_object(self, object_key: str, *, bucket_name: str | None = None) -> bool:
        self.deleted.append(object_key)
        if object_key == self.failed_key:
            return False
        return True


async def test_upload_url_validates_type(client, db_session, settings):
    user = await make_user(db_session)
    headers = auth_headers(user, settings)
    bad = await client.post(
        "/images/upload-url",
        json={
            "kind": "repair_shipping_upload",
            "filename": "malware.exe",
            "content_type": "image/png",
            "size_bytes": 100,
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
            "size_bytes": 100,
        },
        headers=headers,
    )
    assert res.status_code == 200
    body = res.json()
    assert body["object_key"].startswith("uploads/repair_shipping_upload/")
    assert body["upload_id"]
    assert body["upload_url"].startswith("https://")  # DryRun URL
    assert body["required_headers"] == {
        "Content-Type": "image/png",
        "x-goog-if-generation-match": "0",
        "x-goog-content-length-range": f"1,{10 * 1024 * 1024}",
    }

    missing_size = await client.post(
        "/images/upload-url",
        json={
            "kind": "quote_request",
            "filename": "tie.png",
            "content_type": "image/png",
        },
        headers=headers,
    )
    assert missing_size.status_code == 422

    quote = await client.post(
        "/images/upload-url",
        json={
            "kind": "quote_request",
            "filename": "tie.png",
            "content_type": "image/png",
            "size_bytes": 100,
        },
        headers=headers,
    )
    assert quote.status_code == 200
    assert quote.json()["required_headers"]["x-goog-if-generation-match"] == "0"
    assert quote.json()["required_headers"]["x-goog-content-length-range"].endswith(
        str(10 * 1024 * 1024)
    )

    too_large = await client.post(
        "/images/upload-url",
        json={
            "kind": "repair_shipping_upload",
            "filename": "tie.png",
            "content_type": "image/png",
            "size_bytes": 10 * 1024 * 1024 + 1,
        },
        headers=headers,
    )
    assert too_large.status_code == 422


async def test_repair_shipping_completion_verifies_issued_object_metadata(
    app, client, db_session, settings
):
    gcs = _MetadataGcs()
    app.state.gcs = gcs
    owner = await make_user(db_session)
    other = await make_user(db_session)
    owner_headers = auth_headers(owner, settings)
    issued = await client.post(
        "/images/upload-url",
        json={
            "kind": "repair_shipping_upload",
            "filename": "tie.png",
            "content_type": "image/png",
            "size_bytes": 100,
        },
        headers=owner_headers,
    )
    assert issued.status_code == 200, issued.text
    upload_id = issued.json()["upload_id"]
    object_key = issued.json()["object_key"]

    missing = await client.post(
        "/images/repair-shipping-uploads",
        json={"upload_id": upload_id},
        headers=owner_headers,
    )
    assert missing.status_code == 400
    assert missing.json()["code"] == "upload_not_found"

    gcs.metadata[object_key] = GcsObjectMetadata(size_bytes=100, content_type="image/jpeg")
    wrong_type = await client.post(
        "/images/repair-shipping-uploads",
        json={"upload_id": upload_id},
        headers=owner_headers,
    )
    assert wrong_type.status_code == 400
    assert wrong_type.json()["code"] == "invalid_image_type"

    gcs.metadata[object_key] = GcsObjectMetadata(
        size_bytes=10 * 1024 * 1024 + 1,
        content_type="image/png",
    )
    too_large = await client.post(
        "/images/repair-shipping-uploads",
        json={"upload_id": upload_id},
        headers=owner_headers,
    )
    assert too_large.status_code == 400
    assert too_large.json()["code"] == "image_too_large"

    gcs.metadata[object_key] = GcsObjectMetadata(size_bytes=101, content_type="image/png")
    wrong_size = await client.post(
        "/images/repair-shipping-uploads",
        json={"upload_id": upload_id},
        headers=owner_headers,
    )
    assert wrong_size.status_code == 400
    assert wrong_size.json()["code"] == "invalid_image_size"

    denied = await client.post(
        "/images/repair-shipping-uploads",
        json={"upload_id": upload_id},
        headers=auth_headers(other, settings),
    )
    assert denied.status_code == 409
    assert denied.json()["code"] == "ownership_conflict"

    gcs.metadata[object_key] = GcsObjectMetadata(size_bytes=100, content_type="image/png")
    completed = await client.post(
        "/images/repair-shipping-uploads",
        json={"upload_id": upload_id},
        headers=owner_headers,
    )
    assert completed.status_code == 201, completed.text
    assert completed.json()["object_key"] == object_key

    image = await db_session.get(Image, completed.json()["id"])
    assert image is not None
    assert image.upload_completed_at is not None


async def test_repair_shipping_completion_rejects_foreign_prefix(client, db_session, settings):
    owner = await make_user(db_session)
    image = Image(
        object_key="uploads/custom_order/not-repair.png",
        entity_type="repair_shipping_upload",
        entity_id="uploads/custom_order/not-repair.png",
        uploaded_by=owner.id,
        content_type="image/png",
        size_bytes=100,
        expires_at=datetime.now(UTC) + timedelta(hours=1),
    )
    db_session.add(image)
    await db_session.commit()

    response = await client.post(
        "/images/repair-shipping-uploads",
        json={"upload_id": str(image.id)},
        headers=auth_headers(owner, settings),
    )
    assert response.status_code == 400
    assert response.json()["code"] == "invalid_repair_shipping_image"


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
    assert issued.json()["required_headers"]["x-goog-if-generation-match"] == "0"
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


async def test_cleanup_images_failed_delete_does_not_starve_later_rows(
    app, client, db_session, monkeypatch
):
    monkeypatch.setattr("api.domains.batch.router.CLEANUP_BATCH_SIZE", 1)
    user = await make_user(db_session)
    old = datetime.now(UTC) - timedelta(days=2)
    failed_key = "uploads/quote/fails.png"
    app.state.gcs = _FailOneDeleteGcs(failed_key)
    db_session.add_all(
        [
            Image(
                object_key=failed_key,
                entity_type="quote_request",
                entity_id="failed",
                uploaded_by=user.id,
                expires_at=old,
            ),
            Image(
                object_key="uploads/quote/later.png",
                entity_type="quote_request",
                entity_id="later",
                uploaded_by=user.id,
                expires_at=old + timedelta(seconds=1),
            ),
        ]
    )
    await db_session.commit()

    first = await client.post("/batch/cleanup-images", headers=BATCH_HEADERS)
    second = await client.post("/batch/cleanup-images", headers=BATCH_HEADERS)

    assert first.json() == {"processed": 0}
    assert second.json() == {"processed": 1}
    assert app.state.gcs.deleted == [failed_key, "uploads/quote/later.png"]
