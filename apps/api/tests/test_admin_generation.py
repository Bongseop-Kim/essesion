from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from decimal import Decimal

import pytest
from api.domains.admin.generation import router as generation_router
from db.models.design import GenerationJob
from db.models.images import Image
from db.models.seamless import Motif, SeamlessGenerationLog
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from .factories import auth_headers, make_user


@pytest.fixture
async def generation_client(app: FastAPI) -> AsyncIterator[AsyncClient]:
    if not any(getattr(route, "path", "") == "/admin/generation/jobs" for route in app.routes):
        app.include_router(generation_router)
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
        headers={"Origin": app.state.settings.admin_frontend_origin},
    ) as client:
        yield client


async def test_generation_jobs_page_stats_and_safe_detail(
    app, generation_client, db_session, settings
):
    admin = await make_user(db_session, role="admin")
    owner = await make_user(db_session, email="owner-secret@test.local")
    app.state.settings.gcp_project_id = "test-project"
    app.state.settings.gcs_assets_bucket = "configured-assets"
    app.state.settings.gcs_assets_public_base_url = "https://cdn.example.test/assets/"
    now = datetime.now(UTC)
    succeeded = GenerationJob(
        user_id=owner.id,
        kind="finalize",
        status="succeeded",
        params={
            "intent": {"raw_prompt": "owner-secret@test.local"},
            "dpi": 300,
            "weave": "twill-45",
        },
        result={"object_key": "fabric/0123456789abcdef.png"},
        request_id="job-safe-1",
        attempts=1,
        created_at=now - timedelta(minutes=1),
        updated_at=now - timedelta(minutes=1),
    )
    failed = GenerationJob(
        user_id=owner.id,
        kind="finalize",
        status="failed",
        params={"intent": {"private_object_key": "uploads/private/customer.png"}},
        result=None,
        error_message="token=super-secret owner-secret@test.local /private/path",
        request_id="job-safe-2",
        attempts=2,
        created_at=now,
        updated_at=now,
    )
    db_session.add_all([succeeded, failed])
    await db_session.commit()

    headers = auth_headers(admin, settings)
    page = await generation_client.get(
        "/admin/generation/jobs", params={"limit": 1}, headers=headers
    )
    assert page.status_code == 200
    assert page.json()["total"] == 2
    assert len(page.json()["items"]) == 1
    serialized = page.text
    assert "owner-secret@test.local" not in serialized
    assert "super-secret" not in serialized
    assert "params" not in page.json()["items"][0]
    assert "result" not in page.json()["items"][0]
    assert "user_id" not in page.json()["items"][0]

    stats = await generation_client.get("/admin/generation/jobs/stats", headers=headers)
    assert stats.status_code == 200
    assert {key: stats.json()[key] for key in ("total", "succeeded", "failed")} == {
        "total": 2,
        "succeeded": 1,
        "failed": 1,
    }
    assert stats.json()["average_attempts"] == 1.5

    detail = await generation_client.get(f"/admin/generation/jobs/{succeeded.id}", headers=headers)
    assert detail.status_code == 200
    body = detail.json()
    assert body["parameter_summary"] == {
        "has_intent": True,
        "dpi": 300,
        "weave": "twill-45",
    }
    assert body["result_url"] == ("https://cdn.example.test/assets/fabric/0123456789abcdef.png")
    assert str(owner.id) not in detail.text
    assert "owner-secret@test.local" not in detail.text

    failed_detail = await generation_client.get(
        f"/admin/generation/jobs/{failed.id}", headers=headers
    )
    assert failed_detail.json()["error_summary"] == "생성 작업에 실패했습니다"
    assert "super-secret" not in failed_detail.text


async def test_seamless_and_motif_projections_never_expose_unsafe_payloads(
    generation_client, db_session, settings
):
    admin = await make_user(db_session, role="admin")
    headers = auth_headers(admin, settings)
    safe_svg = '<svg xmlns="http://www.w3.org/2000/svg"><rect fill="#123456"/></svg>'
    unsafe_svg = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
    rows = [
        SeamlessGenerationLog(
            request_id="seamless-success",
            input_type="prompt",
            prompt="customer-secret@test.local",
            candidate_count_requested=2,
            candidate_count_returned=2,
            distinct_layouts=1,
            candidates=[
                {
                    "id": "safe-candidate",
                    "design_index": 0,
                    "layout_id": "grid",
                    "source_fidelity": "exact",
                    "colorway_id": "default",
                    "seed": 1,
                    "svg": safe_svg,
                    "png_object_key": "previews/private/secret.png",
                },
                {"id": "unsafe-candidate", "svg": unsafe_svg},
            ],
            warnings=[],
            generate_ms=Decimal("10.5"),
            render_ms=Decimal("3.5"),
            status="success",
        ),
        SeamlessGenerationLog(
            request_id="seamless-partial",
            input_type="intent",
            warnings=["preview upload skipped: /private/customer.png"],
            generate_ms=Decimal("20"),
            render_ms=Decimal("4"),
            status="partial",
        ),
        SeamlessGenerationLog(
            request_id="seamless-error",
            input_type="prompt",
            prompt="raw secret prompt",
            warnings=[],
            generate_ms=Decimal("5"),
            render_ms=Decimal("0"),
            status="error",
            error_type="AdapterClientError",
            error_message="api_key=secret-value customer-secret@test.local",
        ),
    ]
    safe_motif = Motif(
        id="motif-safe",
        symbol='<symbol id="motif-safe"><path d="M0 0L1 1"/></symbol>',
        color_slots=["s0"],
        bbox=[0, 0, 1, 1],
        anchor=[0.5, 0.5],
        subject="flower",
        scope="whole",
        description="customer-secret@test.local",
        tags=["botanical", "010-1234-5678"],
        source="seed",
    )
    unsafe_motif = Motif(
        id="motif-unsafe",
        symbol='<symbol id="motif-unsafe"><script>alert(1)</script></symbol>',
        color_slots=["s0"],
        bbox=[0, 0, 1, 1],
        anchor=[0, 0],
        subject="unsafe",
        scope="partial",
        source="seed",
    )
    db_session.add_all([*rows, safe_motif, unsafe_motif])
    await db_session.commit()

    page = await generation_client.get("/admin/generation/seamless", headers=headers)
    assert page.status_code == 200
    assert page.json()["total"] == 3
    assert "customer-secret@test.local" not in page.text
    assert "<svg" not in page.text
    assert "private/secret" not in page.text
    error_item = next(item for item in page.json()["items"] if item["status"] == "error")
    assert error_item["error_summary"] == "외부 생성 연동에 실패했습니다"
    assert error_item["render_ms"] == 0.0

    stats = await generation_client.get("/admin/generation/seamless/stats", headers=headers)
    assert {key: stats.json()[key] for key in ("total", "success", "partial", "error")} == {
        "total": 3,
        "success": 1,
        "partial": 1,
        "error": 1,
    }
    assert stats.json()["average_render_ms"] == 2.5

    detail = await generation_client.get(
        f"/admin/generation/seamless/{rows[0].id}", headers=headers
    )
    assert detail.status_code == 200
    assert detail.json()["candidates"][0]["svg"] == safe_svg
    assert detail.json()["candidates"][0]["svg_status"] == "safe"
    assert detail.json()["candidates"][1]["svg"] is None
    assert detail.json()["candidates"][1]["svg_status"] == "unsafe"
    assert "png_object_key" not in detail.text
    assert "customer-secret@test.local" not in detail.text

    motif_page = await generation_client.get("/admin/motifs", params={"limit": 1}, headers=headers)
    assert motif_page.json()["total"] == 2
    assert "symbol" not in motif_page.json()["items"][0]
    assert "description" not in motif_page.json()["items"][0]
    assert "customer-secret@test.local" not in motif_page.text

    safe_detail = await generation_client.get(f"/admin/motifs/{safe_motif.id}", headers=headers)
    assert safe_detail.json()["svg_status"] == "safe"
    assert safe_detail.json()["symbol"] == safe_motif.symbol
    assert safe_detail.json()["description"] is None
    assert safe_detail.json()["tags"] == ["botanical"]

    unsafe_detail = await generation_client.get(f"/admin/motifs/{unsafe_motif.id}", headers=headers)
    assert unsafe_detail.json()["svg_status"] == "unsafe"
    assert unsafe_detail.json()["symbol"] is None


async def test_seamless_reference_image_is_relation_checked_and_never_exposes_object_key(
    generation_client, db_session, settings
):
    admin = await make_user(db_session, role="admin")
    customer = await make_user(db_session)
    log = SeamlessGenerationLog(
        request_id="seamless-with-reference",
        input_type="reference_image",
        has_reference_image=True,
        reference_image_bytes=1234,
        warnings=[],
        status="success",
    )
    db_session.add(log)
    await db_session.flush()
    image = Image(
        object_key=f"uploads/seamless_generation/{log.id}/reference.png",
        entity_type="seamless_generation",
        entity_id=str(log.id),
        content_type="image/png",
        size_bytes=1234,
        upload_completed_at=datetime.now(UTC),
    )
    db_session.add(image)
    await db_session.flush()
    log.reference_image_id = image.id
    await db_session.commit()

    headers = auth_headers(admin, settings)
    detail = await generation_client.get(f"/admin/generation/seamless/{log.id}", headers=headers)
    assert detail.status_code == 200
    assert detail.json()["reference_image_id"] == str(image.id)
    assert detail.json()["reference_image_available"] is True
    assert image.object_key not in detail.text
    assert "object_key" not in detail.text

    path = f"/admin/generation/seamless/{log.id}/reference-image/{image.id}/read-url"
    denied = await generation_client.post(path, headers=auth_headers(customer, settings))
    assert denied.status_code == 403

    read_url = await generation_client.post(path, headers=headers)
    assert read_url.status_code == 200
    assert read_url.json()["read_url"].endswith(image.object_key)

    wrong_image = Image(
        object_key="uploads/seamless_generation/unrelated/reference.png",
        entity_type="seamless_generation",
        entity_id="unrelated",
        upload_completed_at=datetime.now(UTC),
    )
    db_session.add(wrong_image)
    await db_session.commit()
    wrong_relation = await generation_client.post(
        f"/admin/generation/seamless/{log.id}/reference-image/{wrong_image.id}/read-url",
        headers=headers,
    )
    assert wrong_relation.status_code == 404

    await db_session.delete(image)
    await db_session.commit()
    await db_session.refresh(log)
    assert log.reference_image_id is None


async def test_seamless_reference_image_requires_completed_matching_private_image(
    generation_client, db_session, settings
):
    admin = await make_user(db_session, role="admin")
    headers = auth_headers(admin, settings)
    now = datetime.now(UTC)

    incomplete_log = SeamlessGenerationLog(
        input_type="reference_image",
        has_reference_image=True,
        warnings=[],
        status="success",
    )
    wrong_type_log = SeamlessGenerationLog(
        input_type="reference_image",
        has_reference_image=True,
        warnings=[],
        status="success",
    )
    expired_log = SeamlessGenerationLog(
        input_type="reference_image",
        has_reference_image=True,
        warnings=[],
        status="success",
    )
    db_session.add_all([incomplete_log, wrong_type_log, expired_log])
    await db_session.flush()
    incomplete = Image(
        object_key=f"uploads/seamless_generation/{incomplete_log.id}/incomplete.png",
        entity_type="seamless_generation",
        entity_id=str(incomplete_log.id),
        upload_completed_at=None,
    )
    wrong_type = Image(
        object_key=f"uploads/seamless_generation/{wrong_type_log.id}/wrong-type.png",
        entity_type="quote_request",
        entity_id=str(wrong_type_log.id),
        upload_completed_at=now,
    )
    expired = Image(
        object_key=f"uploads/seamless_generation/{expired_log.id}/expired.png",
        entity_type="seamless_generation",
        entity_id=str(expired_log.id),
        upload_completed_at=now,
        expires_at=now - timedelta(seconds=1),
    )
    db_session.add_all([incomplete, wrong_type, expired])
    await db_session.flush()
    incomplete_log.reference_image_id = incomplete.id
    wrong_type_log.reference_image_id = wrong_type.id
    expired_log.reference_image_id = expired.id
    await db_session.commit()

    for row, image in ((incomplete_log, incomplete), (wrong_type_log, wrong_type)):
        detail = await generation_client.get(
            f"/admin/generation/seamless/{row.id}", headers=headers
        )
        assert detail.json()["reference_image_id"] == str(image.id)
        assert detail.json()["reference_image_available"] is False
        read_url = await generation_client.post(
            f"/admin/generation/seamless/{row.id}/reference-image/{image.id}/read-url",
            headers=headers,
        )
        assert read_url.status_code == 404

    expired_detail = await generation_client.get(
        f"/admin/generation/seamless/{expired_log.id}", headers=headers
    )
    assert expired_detail.json()["reference_image_available"] is False
    expired_url = await generation_client.post(
        f"/admin/generation/seamless/{expired_log.id}/reference-image/{expired.id}/read-url",
        headers=headers,
    )
    assert expired_url.status_code == 400
    assert expired_url.json()["code"] == "image_expired"
