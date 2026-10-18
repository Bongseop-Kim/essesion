from datetime import UTC, datetime
from decimal import Decimal

from db.models.design import DesignSession
from db.models.seamless import Motif, SeamlessGenerationLog

from .factories import auth_headers, make_user


async def test_seamless_detail_projects_intent_without_leaking_unsafe_payloads(
    client, db_session, settings
):
    admin = await make_user(db_session, role="admin")
    headers = auth_headers(admin, settings)
    safe_svg = '<svg xmlns="http://www.w3.org/2000/svg"><rect fill="#123456"/></svg>'
    unsafe_svg = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
    rows = [
        SeamlessGenerationLog(
            request_id="seamless-success",
            input_type="intent",
            intent={
                "design": {
                    "intent_version": 1,
                    "canvas": {
                        "tile_mm": 48,
                        "dpi": 300,
                        "private_path": "/private/customer.png",
                    },
                    "seed": 7,
                    "production": {"method": "print", "max_colors": 4},
                    "palette": {
                        "slots": [
                            {
                                "id": "ground",
                                "hex": "#112233",
                                "name": "navy",
                                "provider_payload": "raw-provider-secret",
                            }
                        ]
                    },
                    "colorways": [
                        {
                            "id": "default",
                            "mapping": {"ground": "#112233"},
                        }
                    ],
                    "layers": [
                        {
                            "id": "ground",
                            "type": "background",
                            "params": {
                                "color": "ground",
                                "private_path": "/private/customer.png",
                            },
                            "z_order": 0,
                        },
                        {
                            "id": "flower",
                            "type": "motif",
                            "params": {
                                "motif_id": "motif-safe",
                                "size_mm": 12,
                            },
                            "placement": {
                                "type": "lattice",
                                "fixed_rotation_deg": 0,
                                "lattice": {
                                    "cell_w_mm": 24,
                                    "cell_h_mm": 24,
                                    "offset_x_mm": 12,
                                    "offset_y_mm": 12,
                                    "drop_fraction": 0.5,
                                    "drop_axis": "row",
                                },
                            },
                            "z_order": 1,
                        },
                    ],
                    "provider_payload": {"api_key": "raw-provider-secret"},
                },
                "provider_response": "raw-provider-secret",
            },
            design={
                "id": "safe-design",
                "layout_id": "grid",
                "source_fidelity": "exact",
                "colorway_id": "default",
                "seed": 1,
                "svg": safe_svg,
                "png_object_key": "previews/private/secret.png",
            },
            warnings=[],
            generate_ms=Decimal("10.5"),
            render_ms=Decimal("3.5"),
            status="success",
            diagnostics={
                "mode": "motif_slot",
                "compose_ms": 12.5,
                "note": "customer-secret@test.local",
                "provider_payload": "raw-provider-secret",
                "legacy_provider_calls": 3,
            },
        ),
        SeamlessGenerationLog(
            request_id="seamless-partial",
            input_type="intent",
            design={"id": "unsafe-design", "svg": unsafe_svg},
            warnings=["preview upload skipped: /private/customer.png"],
            generate_ms=Decimal("20"),
            render_ms=Decimal("4"),
            status="partial",
        ),
        SeamlessGenerationLog(
            request_id="seamless-error",
            input_type="intent",
            warnings=[],
            generate_ms=Decimal("5"),
            render_ms=Decimal("0"),
            status="error",
            error_type="IntentInvalid",
            error_message="api_key=secret-value customer-secret@test.local",
            diagnostics={
                "mode": "variation",
                "failure_code": "intent_invalid",
                "failure_stage": "intent",
                "model": "customer-secret@test.local",
                "legacy_provider_calls": 2,
            },
        ),
    ]
    safe_motif = Motif(
        id="motif-safe",
        symbol='<symbol id="motif-safe"><path d="M0 0L1 1"/></symbol>',
        bbox=[0, 0, 1, 1],
        anchor=[0.5, 0.5],
        subject="flower",
        scope="whole",
        source="seed",
    )
    unsafe_motif = Motif(
        id="motif-unsafe",
        symbol='<symbol id="motif-unsafe"><script>alert(1)</script></symbol>',
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
    assert all("intent" not in item for item in page.json()["items"])
    assert "customer-secret@test.local" not in page.text
    assert "<svg" not in page.text
    assert "private/secret" not in page.text
    error_item = next(item for item in page.json()["items"] if item["status"] == "error")
    assert error_item["error_summary"] == "입력 intent 검증에 실패했습니다"
    assert error_item["failure_code"] == "intent_invalid"
    assert error_item["failure_stage"] == "intent"
    assert error_item["render_ms"] == 0.0

    stats = await client.get("/admin/generation/seamless/stats", headers=headers)
    assert {key: stats.json()[key] for key in ("total", "success", "partial", "error")} == {
        "total": 3,
        "success": 1,
        "partial": 1,
        "error": 1,
    }
    assert stats.json()["average_render_ms"] == 2.5
    assert "legacy_provider_calls" not in stats.json()

    detail = await client.get(f"/admin/generation/seamless/{rows[0].id}", headers=headers)
    assert detail.status_code == 200
    assert detail.json()["design"]["id"] == "safe-design"
    assert detail.json()["design"]["svg"] == safe_svg
    assert detail.json()["design"]["svg_status"] == "safe"
    assert "prompt" not in detail.json()
    assert "customer-secret@test.local" not in detail.text
    assert detail.json()["intent"] == {
        "intent_version": 1,
        "canvas": {"tile_mm": 48, "dpi": 300},
        "seed": 7,
        "production": {"method": "print", "max_colors": 4},
        "palette": {"slots": [{"id": "ground", "hex": "#112233", "name": "navy"}]},
        "colorways": [{"id": "default", "mapping": {"ground": "#112233"}}],
        "layers": [
            {
                "id": "ground",
                "type": "background",
                "params": {"color": "ground"},
                "z_order": 0,
            },
            {
                "id": "flower",
                "type": "motif",
                "params": {
                    "motif_id": "motif-safe",
                    "size_mm": 12,
                },
                "placement": {
                    "type": "lattice",
                    "fixed_rotation_deg": 0,
                    "lattice": {
                        "cell_w_mm": 24,
                        "cell_h_mm": 24,
                        "offset_x_mm": 12,
                        "offset_y_mm": 12,
                        "drop_fraction": 0.5,
                        "drop_axis": "row",
                    },
                },
                "z_order": 1,
            },
        ],
    }
    assert "raw-provider-secret" not in detail.text
    assert "png_object_key" not in detail.text
    assert detail.json()["diagnostics"] == {
        "mode": "motif_slot",
        "compose_ms": 12.5,
        "render_ms": None,
        "failure_code": None,
        "failure_stage": None,
    }

    unsafe_detail_log = await client.get(
        f"/admin/generation/seamless/{rows[1].id}", headers=headers
    )
    assert unsafe_detail_log.json()["design"]["svg"] is None
    assert unsafe_detail_log.json()["design"]["svg_status"] == "unsafe"
    assert unsafe_detail_log.json()["intent"] is None

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
    assert "description" not in safe_detail.json()
    assert "tags" not in safe_detail.json()

    unsafe_detail = await client.get(f"/admin/motifs/{unsafe_motif.id}", headers=headers)
    assert unsafe_detail.json()["svg_status"] == "unsafe"
    assert unsafe_detail.json()["symbol"] is None


async def test_seamless_identifier_filter_matches_request_log_session_and_user(
    client, db_session, settings
):
    admin = await make_user(db_session, role="admin")
    owner = await make_user(db_session)
    other_owner = await make_user(db_session)
    owner_session = DesignSession(user_id=owner.id)
    other_session = DesignSession(user_id=other_owner.id)
    db_session.add_all([owner_session, other_session])
    await db_session.flush()
    owner_log = SeamlessGenerationLog(
        request_id="identifier-request",
        session_id=owner_session.id,
        user_id=owner.id,
        input_type="intent",
        warnings=[],
        status="success",
    )
    other_log = SeamlessGenerationLog(
        request_id="other-request",
        session_id=other_session.id,
        user_id=other_owner.id,
        input_type="intent",
        warnings=[],
        status="success",
    )
    db_session.add_all([owner_log, other_log])
    await db_session.commit()
    headers = auth_headers(admin, settings)

    for identifier in (
        owner_log.request_id,
        str(owner_log.id),
        str(owner_session.id),
        str(owner.id),
    ):
        page = await client.get(
            "/admin/generation/seamless",
            params={"identifier": identifier},
            headers=headers,
        )
        stats = await client.get(
            "/admin/generation/seamless/stats",
            params={"identifier": identifier},
            headers=headers,
        )
        assert page.status_code == stats.status_code == 200
        assert page.json()["total"] == stats.json()["total"] == 1
        assert page.json()["items"][0]["id"] == str(owner_log.id)

    invalid = await client.get(
        "/admin/generation/seamless",
        params={"identifier": "invalid/id"},
        headers=headers,
    )
    assert invalid.status_code == 400
    assert invalid.json()["code"] == "invalid_identifier"


async def test_seamless_detail_groups_warning_causes_and_links_session_outcome(
    client, db_session, settings
):
    admin = await make_user(db_session, role="admin")
    owner = await make_user(db_session, email="generation-owner@test.local")
    now = datetime.now(UTC)
    design_session = DesignSession(user_id=owner.id, status="active")
    db_session.add(design_session)
    await db_session.flush()
    cmyk_colors = ["#0000FF", "#00FF00", "#FF0000", "#FF4500", "#FFA500", "#FFFF00"]
    log = SeamlessGenerationLog(
        request_id="warning-groups-request",
        session_id=design_session.id,
        user_id=owner.id,
        input_type="intent",
        design={"id": "design-1"},
        warnings=[
            "motif layer 'motif_1' dropped — Tier-1 gate exhausted (triangle/partial)",
            "motif layer 'motif_2' dropped — Tier-1 gate exhausted (line/partial)",
            *[
                f"color {color} in colorway 'default' likely outside CMYK gamut"
                for color in cmyk_colors
            ],
            "layer 'motif_1': spacing_mm 7.2 snapped to 6.8mm for exact path closure",
            "stripe 'stripe_0' period_mm 7.2 snapped to 6.8 for exact tiling",
            "알 수 없는 경고",
        ],
        status="partial",
        created_at=now,
    )
    failure = SeamlessGenerationLog(
        request_id="intent-failure-request",
        session_id=design_session.id,
        user_id=owner.id,
        input_type="intent",
        warnings=[],
        status="error",
        error_type="constraint_conflict",
        diagnostics={"failure_code": "constraint_conflict", "failure_stage": "constraints"},
        created_at=now,
    )
    db_session.add_all([log, failure])
    await db_session.commit()

    detail = await client.get(
        f"/admin/generation/seamless/{log.id}",
        headers=auth_headers(admin, settings),
    )
    assert detail.status_code == 200
    body = detail.json()
    assert body["warning_count"] == 11
    assert body["warning_groups"] == [
        {
            "code": "motif_layer_dropped",
            "count": 2,
            "items": ["triangle", "line"],
        },
        {
            "code": "cmyk_gamut",
            "count": 6,
            "items": cmyk_colors,
        },
        {
            "code": "spacing_snap",
            "count": 1,
            "items": [],
        },
        {
            "code": "stripe_period_snap",
            "count": 1,
            "items": [],
        },
        {
            "code": "generation_warning",
            "count": 1,
            "items": [],
        },
    ]
    assert body["outcome"] == {
        "session_id": str(design_session.id),
        "user_id": str(owner.id),
        "user_name": owner.name,
    }

    # 실패 로그도 워커가 FK를 채운다 — 요청자는 그대로 드러난다
    failed_detail = await client.get(
        f"/admin/generation/seamless/{failure.id}",
        headers=auth_headers(admin, settings),
    )
    assert failed_detail.status_code == 200
    assert failed_detail.json()["error_summary"] == "선택한 생성 조건이 충돌했습니다"
    assert failed_detail.json()["diagnostics"]["failure_stage"] == "constraints"
    assert failed_detail.json()["outcome"]["user_id"] == str(owner.id)


async def test_motif_detail_returns_concrete_symbol_without_slot_metadata(
    client, db_session, settings
):
    admin = await make_user(db_session, role="admin")
    headers = auth_headers(admin, settings)
    db_session.add(
        Motif(
            id="motif-fixed-colors",
            symbol=(
                '<symbol id="motif-fixed-colors">'
                '<path fill="#010000"/><path fill="#0685b1"/></symbol>'
            ),
            bbox=[0, 0, 1, 1],
            anchor=[0.5, 0.5],
            subject="pelican",
            scope="whole",
            source="seed",
            ingested_user_id=admin.id,
        )
    )
    await db_session.commit()

    response = await client.get("/admin/motifs/motif-fixed-colors", headers=headers)
    assert response.status_code == 200
    body = response.json()
    # GPT Image 유입 출처는 admin에서 세션 상관을 볼 수 있는 유일한 경로다.
    assert body["ingested_user_id"] == str(admin.id)
    assert body["ingested_session_id"] is None
    assert body["svg_status"] == "safe"
    assert "status" not in body
    assert "reviewed_at" not in body
    assert "#010000" in body["symbol"] and "#0685b1" in body["symbol"]
    assert "color_slots" not in body
    assert "slot_colors" not in body
    assert "slot_parts" not in body


async def test_motif_metadata_edit_requires_admin(client, db_session, settings):
    admin = await make_user(db_session, role="admin")
    manager = await make_user(db_session, role="manager")
    motif = Motif(
        id="motif-metadata-edit",
        symbol='<symbol id="motif-metadata-edit"/>',
        bbox=[0, 0, 1, 1],
        anchor=[0.5, 0.5],
        subject="old subject",
        scope="whole",
        style="outline",
        source="seed",
        status="approved",
    )
    db_session.add(motif)
    await db_session.commit()
    path = f"/admin/motifs/{motif.id}"

    assert (
        await client.patch(
            path,
            json={"subject": "manager edit"},
            headers=auth_headers(manager, settings),
        )
    ).status_code == 403
    assert (
        await client.patch(
            path,
            json={"scope": "partial"},
            headers=auth_headers(admin, settings),
        )
    ).status_code == 422
    empty = await client.patch(path, json={}, headers=auth_headers(admin, settings))
    assert empty.status_code == 400
    assert empty.json()["code"] == "empty_motif_update"

    updated = await client.patch(
        path,
        json={"subject": "N" * 170, "style": "flat"},
        headers=auth_headers(admin, settings),
    )
    assert updated.status_code == 200
    assert updated.json()["subject"] == "N" * 160
    assert updated.json()["style"] == "flat"

    removed_field = await client.patch(
        path, json={"tags": ["꽃"]}, headers=auth_headers(admin, settings)
    )
    assert removed_field.status_code == 422

    unsafe = await client.patch(
        path,
        json={"subject": "contact secret@example.com"},
        headers=auth_headers(admin, settings),
    )
    assert unsafe.status_code == 400
    assert unsafe.json()["code"] == "invalid_motif_metadata"


async def test_motif_list_searches_fields_and_filters_kst_created_date(
    client, db_session, settings
):
    admin = await make_user(db_session, role="admin")
    headers = auth_headers(admin, settings)
    motifs = [
        Motif(
            id="motif-id-needle",
            symbol='<symbol id="motif-id-needle"/>',
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
