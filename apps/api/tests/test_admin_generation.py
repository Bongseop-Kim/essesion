from datetime import UTC, datetime, timedelta
from decimal import Decimal

from db.models.design import GenerationJob
from db.models.images import Image
from db.models.seamless import Motif, SeamlessGenerationLog

from .factories import auth_headers, make_user


async def test_generation_jobs_page_stats_and_safe_detail(app, client, db_session, settings):
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
    page = await client.get("/admin/generation/jobs", params={"limit": 1}, headers=headers)
    assert page.status_code == 200
    assert page.json()["total"] == 2
    assert len(page.json()["items"]) == 1
    serialized = page.text
    assert "owner-secret@test.local" not in serialized
    assert "super-secret" not in serialized
    assert "params" not in page.json()["items"][0]
    assert "result" not in page.json()["items"][0]
    assert "user_id" not in page.json()["items"][0]

    stats = await client.get("/admin/generation/jobs/stats", headers=headers)
    assert stats.status_code == 200
    assert {key: stats.json()[key] for key in ("total", "succeeded", "failed")} == {
        "total": 2,
        "succeeded": 1,
        "failed": 1,
    }
    assert stats.json()["average_attempts"] == 1.5

    filtered_page = await client.get(
        "/admin/generation/jobs", params={"job_id": str(succeeded.id)}, headers=headers
    )
    assert filtered_page.status_code == 200
    assert filtered_page.json()["total"] == 1
    assert [item["id"] for item in filtered_page.json()["items"]] == [str(succeeded.id)]

    filtered_stats = await client.get(
        "/admin/generation/jobs/stats", params={"job_id": str(succeeded.id)}, headers=headers
    )
    assert filtered_stats.status_code == 200
    assert {key: filtered_stats.json()[key] for key in ("total", "succeeded", "failed")} == {
        "total": 1,
        "succeeded": 1,
        "failed": 0,
    }

    invalid_job_id = await client.get(
        "/admin/generation/jobs", params={"job_id": "not-a-uuid"}, headers=headers
    )
    assert invalid_job_id.status_code == 422

    detail = await client.get(f"/admin/generation/jobs/{succeeded.id}", headers=headers)
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

    failed_detail = await client.get(f"/admin/generation/jobs/{failed.id}", headers=headers)
    assert failed_detail.json()["error_summary"] == "생성 작업에 실패했습니다"
    assert "super-secret" not in failed_detail.text


async def test_seamless_and_motif_projections_never_expose_unsafe_payloads(
    client, db_session, settings
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
            diagnostics={
                "mode": "prompt",
                "model": "gemini-2.5-flash-lite",
                "authoring_attempts": 1,
                "plan_count": 3,
                "validated_count": 3,
                "resolved_count": 3,
                "candidate_count": 2,
                "fixed_palette": False,
                "pattern_controls": True,
                "reference_count": 1,
            },
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
            diagnostics={
                "mode": "prompt",
                "failure_code": "authoring_invalid",
                "failure_stage": "authoring",
                "model": "customer-secret@test.local",
            },
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

    page = await client.get("/admin/generation/seamless", headers=headers)
    assert page.status_code == 200
    assert page.json()["total"] == 3
    assert "customer-secret@test.local" not in page.text
    assert "<svg" not in page.text
    assert "private/secret" not in page.text
    error_item = next(item for item in page.json()["items"] if item["status"] == "error")
    assert error_item["error_summary"] == "외부 생성 연동에 실패했습니다"
    assert error_item["failure_code"] == "authoring_invalid"
    assert error_item["failure_stage"] == "authoring"
    assert error_item["render_ms"] == 0.0

    stats = await client.get("/admin/generation/seamless/stats", headers=headers)
    assert {key: stats.json()[key] for key in ("total", "success", "partial", "error")} == {
        "total": 3,
        "success": 1,
        "partial": 1,
        "error": 1,
    }
    assert stats.json()["average_render_ms"] == 2.5

    detail = await client.get(f"/admin/generation/seamless/{rows[0].id}", headers=headers)
    assert detail.status_code == 200
    assert detail.json()["candidates"][0]["svg"] == safe_svg
    assert detail.json()["candidates"][0]["svg_status"] == "safe"
    assert detail.json()["candidates"][1]["svg"] is None
    assert detail.json()["candidates"][1]["svg_status"] == "unsafe"
    assert "png_object_key" not in detail.text
    assert "customer-secret@test.local" not in detail.text
    assert detail.json()["diagnostics"] == {
        "mode": "prompt",
        "model": "gemini-2.5-flash-lite",
        "reference_count": 1,
        "fixed_palette": False,
        "pattern_controls": True,
        "authoring_attempts": 1,
        "plan_count": 3,
        "validated_count": 3,
        "resolved_count": 3,
        "candidate_count": 2,
        "failure_code": None,
        "failure_stage": None,
    }

    motif_page = await client.get("/admin/motifs", headers=headers)
    assert motif_page.json()["total"] == 2
    motif_items = {item["id"]: item for item in motif_page.json()["items"]}
    assert motif_items["motif-safe"]["svg_status"] == "safe"
    assert motif_items["motif-safe"]["symbol"] == safe_motif.symbol
    assert motif_items["motif-unsafe"]["svg_status"] == "unsafe"
    assert motif_items["motif-unsafe"]["symbol"] is None
    assert "description" not in motif_items["motif-safe"]
    assert "alert(1)" not in motif_page.text
    assert "customer-secret@test.local" not in motif_page.text

    safe_detail = await client.get(f"/admin/motifs/{safe_motif.id}", headers=headers)
    assert safe_detail.json()["svg_status"] == "safe"
    assert safe_detail.json()["symbol"] == safe_motif.symbol
    assert safe_detail.json()["description"] is None
    assert safe_detail.json()["tags"] == ["botanical"]

    unsafe_detail = await client.get(f"/admin/motifs/{unsafe_motif.id}", headers=headers)
    assert unsafe_detail.json()["svg_status"] == "unsafe"
    assert unsafe_detail.json()["symbol"] is None


async def test_motif_list_searches_fields_and_filters_kst_created_date(
    client, db_session, settings
):
    admin = await make_user(db_session, role="admin")
    headers = auth_headers(admin, settings)
    motifs = [
        Motif(
            id="motif-id-needle",
            symbol='<symbol id="motif-id-needle"/>',
            color_slots=["s0"],
            bbox=[0, 0, 1, 1],
            anchor=[0.5, 0.5],
            subject="Rose",
            scope="whole",
            source="seed",
            created_at=datetime(2026, 6, 30, 15, 0, tzinfo=UTC),
        ),
        Motif(
            id="motif-subject",
            symbol='<symbol id="motif-subject"/>',
            color_slots=["s0"],
            bbox=[0, 0, 1, 1],
            anchor=[0.5, 0.5],
            subject="Needle Flower",
            scope="partial",
            source="catalog",
            created_at=datetime(2026, 7, 1, 14, 59, 59, tzinfo=UTC),
        ),
        Motif(
            id="motif-source",
            symbol='<symbol id="motif-source"/>',
            color_slots=["s0"],
            bbox=[0, 0, 1, 1],
            anchor=[0.5, 0.5],
            subject="Plain",
            scope="whole",
            source="needle-source",
            created_at=datetime(2026, 7, 1, 15, 0, tzinfo=UTC),
        ),
        Motif(
            id="motif-literal",
            symbol='<symbol id="motif-literal"/>',
            color_slots=["s0"],
            bbox=[0, 0, 1, 1],
            anchor=[0.5, 0.5],
            subject="literal %_ mark",
            scope="whole",
            source="seed",
            created_at=datetime(2026, 7, 1, 3, 0, tzinfo=UTC),
        ),
    ]
    db_session.add_all(motifs)
    await db_session.commit()

    for query, expected_id in (
        ("id-needle", "motif-id-needle"),
        ("NEEDLE FLOWER", "motif-subject"),
        ("needle-source", "motif-source"),
        ("%_", "motif-literal"),
    ):
        searched = await client.get("/admin/motifs", params={"q": query}, headers=headers)
        assert searched.status_code == 200
        assert [item["id"] for item in searched.json()["items"]] == [expected_id]

    filtered = await client.get(
        "/admin/motifs",
        params={"scope": "whole", "source": "seed"},
        headers=headers,
    )
    assert filtered.status_code == 200
    assert {item["id"] for item in filtered.json()["items"]} == {
        "motif-id-needle",
        "motif-literal",
    }

    dated = await client.get(
        "/admin/motifs",
        params={"start_date": "2026-07-01", "end_date": "2026-07-01"},
        headers=headers,
    )
    assert dated.status_code == 200
    assert {item["id"] for item in dated.json()["items"]} == {
        "motif-id-needle",
        "motif-subject",
        "motif-literal",
    }

    invalid_range = await client.get(
        "/admin/motifs",
        params={"start_date": "2026-07-02", "end_date": "2026-07-01"},
        headers=headers,
    )
    assert invalid_range.status_code == 400
    assert invalid_range.json()["code"] == "invalid_range"

    assert (
        await client.get("/admin/motifs", params={"q": "x"}, headers=headers)
    ).status_code == 422
    assert (
        await client.get("/admin/motifs", params={"q": "x" * 101}, headers=headers)
    ).status_code == 422
    blank_search = await client.get("/admin/motifs", params={"q": "  "}, headers=headers)
    assert blank_search.status_code == 400
    assert blank_search.json()["code"] == "invalid_search"


async def test_seamless_reference_image_is_relation_checked_and_never_exposes_object_key(
    client, db_session, settings
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
    detail = await client.get(f"/admin/generation/seamless/{log.id}", headers=headers)
    assert detail.status_code == 200
    assert detail.json()["reference_image_id"] == str(image.id)
    assert detail.json()["reference_image_available"] is True
    assert image.object_key not in detail.text
    assert "object_key" not in detail.text

    path = f"/admin/generation/seamless/{log.id}/reference-image/{image.id}/read-url"
    denied = await client.post(path, headers=auth_headers(customer, settings))
    assert denied.status_code == 403

    read_url = await client.post(path, headers=headers)
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
    wrong_relation = await client.post(
        f"/admin/generation/seamless/{log.id}/reference-image/{wrong_image.id}/read-url",
        headers=headers,
    )
    assert wrong_relation.status_code == 404

    await db_session.delete(image)
    await db_session.commit()
    await db_session.refresh(log)
    assert log.reference_image_id is None


async def test_seamless_reference_image_requires_completed_matching_private_image(
    client, db_session, settings
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
        detail = await client.get(f"/admin/generation/seamless/{row.id}", headers=headers)
        assert detail.json()["reference_image_id"] == str(image.id)
        assert detail.json()["reference_image_available"] is False
        read_url = await client.post(
            f"/admin/generation/seamless/{row.id}/reference-image/{image.id}/read-url",
            headers=headers,
        )
        assert read_url.status_code == 404

    expired_detail = await client.get(
        f"/admin/generation/seamless/{expired_log.id}", headers=headers
    )
    assert expired_detail.json()["reference_image_available"] is False
    expired_url = await client.post(
        f"/admin/generation/seamless/{expired_log.id}/reference-image/{expired.id}/read-url",
        headers=headers,
    )
    assert expired_url.status_code == 400
    assert expired_url.json()["code"] == "image_expired"
