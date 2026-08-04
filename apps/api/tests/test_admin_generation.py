from datetime import UTC, datetime, timedelta
from decimal import Decimal

import pytest
from api.domains.admin.generation import finalize_duration_seconds
from db.models.design import DesignSession, DesignSessionTurn, GenerationJob
from db.models.seamless import Motif, SeamlessGenerationLog
from db.models.tokens import DesignToken

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


async def test_seamless_detail_exposes_prompt_without_leaking_other_unsafe_payloads(
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
                "mode": "patch",
                "model": "gpt-5.6-luna",
                "authoring_attempts": 1,
                "patch_axes": ["background", "placement"],
                "resolved_count": 3,
                "recraft_calls": 3,
                "reference_count": 1,
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
                "recraft_calls": 2,
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
        description="customer-secret@test.local",
        tags=["botanical", "010-1234-5678"],
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
    assert all("prompt" not in item for item in page.json()["items"])
    assert all("intent" not in item for item in page.json()["items"])
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
    assert "recraft_calls" not in stats.json()

    detail = await client.get(f"/admin/generation/seamless/{rows[0].id}", headers=headers)
    assert detail.status_code == 200
    assert detail.json()["design"]["id"] == "safe-design"
    assert detail.json()["design"]["svg"] == safe_svg
    assert detail.json()["design"]["svg_status"] == "safe"
    assert detail.json()["prompt"] == "customer-secret@test.local"
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
        "mode": "patch",
        "model": "gpt-5.6-luna",
        "prompt_revision": None,
        "patch_axes": ["background", "placement"],
        "authoring_attempts": 1,
        "catalog_candidate_count": None,
        "resolved_count": 3,
        "authoring_ms": None,
        "compose_ms": None,
        "render_ms": None,
        "failure_code": None,
        "failure_stage": None,
        "failure_provider": None,
        "failure_operation": None,
        "failure_reason": None,
        "failure_status_code": None,
        "motif_resolutions": [],
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
    assert safe_detail.json()["description"] is None
    assert safe_detail.json()["tags"] == ["botanical"]

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
        input_type="prompt",
        warnings=[],
        status="success",
    )
    other_log = SeamlessGenerationLog(
        request_id="other-request",
        session_id=other_session.id,
        user_id=other_owner.id,
        input_type="prompt",
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
        input_type="prompt",
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
        diagnostics={
            "motif_resolutions": [
                {
                    "layer_id": "motif_1",
                    "subject": "triangle",
                    "scope": "partial",
                    "outcome": "dropped",
                    "provider": "recraft",
                    "operation": "generate_motif",
                    "reason_code": "rate_limited",
                    "status_code": 429,
                }
            ]
        },
        created_at=now,
    )
    previous_log = SeamlessGenerationLog(
        request_id="previous-run-request",
        session_id=design_session.id,
        user_id=owner.id,
        input_type="prompt",
        design={"id": "design-0"},
        warnings=[],
        status="success",
        created_at=now - timedelta(minutes=10),
    )
    # 실패 로그도 워커가 FK를 채운다 — 상관 턴이 없어도 요청자는 드러난다
    provider_failure = SeamlessGenerationLog(
        request_id="embedding-failure-request",
        session_id=design_session.id,
        user_id=owner.id,
        input_type="prompt",
        warnings=[],
        status="error",
        error_type="EmbeddingError",
        diagnostics={
            "failure_code": "provider_request_failed",
            "failure_stage": "motif_resolution",
            "failure_provider": "openai_embedding",
            "failure_operation": "embed",
            "failure_reason": "rate_limited",
            "failure_status_code": 429,
        },
        created_at=now,
    )
    db_session.add_all([log, previous_log, provider_failure])
    await db_session.flush()
    finalize_job = GenerationJob(
        user_id=owner.id,
        session_id=design_session.id,
        kind="finalize",
        status="succeeded",
        # 다른 run의 finalize는 현재 로그의 완료가 아니다.
        params={"run_id": str(previous_log.id)},
        result={"object_key": "fabric/0123456789abcdef.png"},
        created_at=now + timedelta(seconds=3),
        updated_at=now + timedelta(seconds=3),
        finished_at=now + timedelta(seconds=3),
    )
    db_session.add_all(
        [
            DesignToken(
                user_id=owner.id,
                amount=-5,
                type="use",
                token_class="free",
                work_id=f"design_generate_{log.id.hex}_use_free",
            ),
            DesignToken(
                user_id=owner.id,
                amount=5,
                type="refund",
                token_class="free",
                work_id=f"design_generate_{log.id.hex}_use_free_refund",
            ),
            DesignSessionTurn(
                session_id=design_session.id,
                seq=1,
                role="assistant",
                payload={
                    "type": "generate",
                    "run_id": str(previous_log.id),
                    "status": "succeeded",
                },
                created_at=now - timedelta(minutes=6),
            ),
            DesignSessionTurn(
                session_id=design_session.id,
                seq=2,
                role="assistant",
                payload={
                    "type": "generate",
                    "run_id": str(log.id),
                    "status": "succeeded",
                },
                created_at=now - timedelta(minutes=5),
            ),
            DesignSessionTurn(
                session_id=design_session.id,
                seq=3,
                role="user",
                payload={"type": "activate", "run_id": str(log.id)},
                created_at=now + timedelta(seconds=1),
            ),
            # 과거 실행을 다시 활성화해도 현재 로그의 판정을 덮어쓰면 안 된다.
            DesignSessionTurn(
                session_id=design_session.id,
                seq=4,
                role="user",
                payload={"type": "activate", "run_id": str(previous_log.id)},
                created_at=now + timedelta(seconds=2),
            ),
            finalize_job,
            DesignSessionTurn(
                session_id=design_session.id,
                seq=5,
                role="user",
                payload={"type": "generate_request"},
                created_at=now + timedelta(seconds=4),
            ),
        ]
    )
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
    assert body["diagnostics"]["motif_resolutions"][0] == {
        "layer_id": "motif_1",
        "subject": "triangle",
        "scope": "partial",
        "outcome": "dropped",
        "motif_id": None,
        "similarity": None,
        "match_type": None,
        "provider": "recraft",
        "operation": "generate_motif",
        "reason_code": "rate_limited",
        "status_code": 429,
    }
    assert body["outcome"] == {
        "session_id": str(design_session.id),
        "user_id": str(owner.id),
        "user_name": owner.name,
        "reactivated": True,
        "regenerated": True,
        "finalized": False,
    }
    assert body["token_accounting"] == {
        "matched": True,
        "debited": 5,
        "refunded": 5,
        "net": 0,
    }

    # run_id 등가 매칭은 시간창 없이 완료로 집계한다 — 다음 생성 뒤에 끝났어도
    # 이 run의 finalize임은 변하지 않는다.
    finalize_job.params = {"run_id": str(log.id)}
    finalize_job.finished_at = now + timedelta(seconds=5)
    await db_session.commit()
    completed = await client.get(
        f"/admin/generation/seamless/{log.id}",
        headers=auth_headers(admin, settings),
    )
    assert completed.json()["outcome"]["finalized"] is True

    failed_detail = await client.get(
        f"/admin/generation/seamless/{provider_failure.id}",
        headers=auth_headers(admin, settings),
    )
    assert failed_detail.status_code == 200
    assert failed_detail.json()["error_summary"] == "OpenAI 임베딩 생성 연동에 실패했습니다"
    assert failed_detail.json()["diagnostics"]["failure_reason"] == "rate_limited"
    assert failed_detail.json()["token_accounting"] == {
        "matched": False,
        "debited": 0,
        "refunded": 0,
        "net": 0,
    }
    # 상관 턴이 없으므로 활성화·재생성 판정은 비어 있지만 요청자는 FK에서 그대로 온다
    assert failed_detail.json()["outcome"] == {
        "session_id": str(design_session.id),
        "user_id": str(owner.id),
        "user_name": owner.name,
        "reactivated": False,
        "regenerated": False,
        "finalized": False,
    }


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
    # Recraft 유입 출처는 admin에서 세션 상관을 볼 수 있는 유일한 경로다.
    assert body["ingested_user_id"] == str(admin.id)
    assert body["ingested_session_id"] is None
    assert body["svg_status"] == "safe"
    assert body["status"] == "pending"
    assert body["reviewed_at"] is None
    assert "#010000" in body["symbol"] and "#0685b1" in body["symbol"]
    assert "color_slots" not in body
    assert "slot_colors" not in body
    assert "slot_parts" not in body


async def test_motif_review_requires_admin_and_allows_reversal(client, db_session, settings):
    admin = await make_user(db_session, role="admin")
    manager = await make_user(db_session, role="manager")
    customer = await make_user(db_session)
    motif = Motif(
        id="motif-review-gate",
        symbol='<symbol id="motif-review-gate"/>',
        bbox=[0, 0, 1, 1],
        anchor=[0.5, 0.5],
        subject="review gate",
        scope="whole",
        source="recraft",
    )
    db_session.add(motif)
    await db_session.commit()

    path = f"/admin/motifs/{motif.id}/review"
    assert (await client.post(path, json={"status": "approved"})).status_code == 401
    assert (
        await client.post(
            path,
            json={"status": "approved"},
            headers=auth_headers(customer, settings),
        )
    ).status_code == 403
    assert (
        await client.post(
            path,
            json={"status": "approved"},
            headers=auth_headers(manager, settings),
        )
    ).status_code == 403

    headers = auth_headers(admin, settings)
    invalid = await client.post(path, json={"status": "pending"}, headers=headers)
    assert invalid.status_code == 422

    approved = await client.post(path, json={"status": "approved"}, headers=headers)
    assert approved.status_code == 200
    assert approved.json()["status"] == "approved"
    assert approved.json()["reviewed_at"] is not None
    await db_session.refresh(motif)
    assert motif.reviewed_by == admin.id
    assert motif.reviewed_at is not None

    pending_page = await client.get("/admin/motifs", headers=headers)
    approved_page = await client.get(
        "/admin/motifs", params={"status": "approved"}, headers=headers
    )
    all_page = await client.get("/admin/motifs", params={"status": "all"}, headers=headers)
    assert pending_page.json()["total"] == 0
    assert [item["id"] for item in approved_page.json()["items"]] == [motif.id]
    assert all_page.json()["total"] == 1

    no_op = await client.post(path, json={"status": "approved"}, headers=headers)
    assert no_op.status_code == 409
    assert no_op.json()["code"] == "invalid_motif_transition"

    rejected = await client.post(path, json={"status": "rejected"}, headers=headers)
    assert rejected.status_code == 200
    assert rejected.json()["status"] == "rejected"

    # user_upload은 소스 필터로 공개 카탈로그에서 이미 제외 — 검토 대상이 아니다.
    db_session.add(
        Motif(
            id="motif-user-upload",
            symbol='<symbol id="motif-user-upload"/>',
            bbox=[0, 0, 1, 1],
            anchor=[0.5, 0.5],
            subject="user upload",
            scope="whole",
            source="user_upload",
            status="approved",
        )
    )
    await db_session.commit()
    upload_review = await client.post(
        "/admin/motifs/motif-user-upload/review",
        json={"status": "rejected"},
        headers=headers,
    )
    assert upload_review.status_code == 409
    assert upload_review.json()["code"] == "invalid_motif_transition"


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


async def test_finalize_duration_uses_started_finished_timestamps(db_session):
    """감사 이연 항목(p50/p95)의 산출 조건 — 성공 finalize만, updated_at 근사 없음."""
    owner = await make_user(db_session)
    now = datetime.now(UTC)
    db_session.add_all(
        [
            GenerationJob(
                user_id=owner.id,
                kind="finalize",
                status="succeeded",
                params={},
                started_at=now,
                finished_at=now + timedelta(seconds=seconds),
            )
            for seconds in (10, 20, 120)
        ]
        + [
            # 실패 job과 타임스탬프 없는 job은 분포에 들어가지 않는다
            GenerationJob(
                user_id=owner.id,
                kind="finalize",
                status="failed",
                params={},
                started_at=now,
                finished_at=now + timedelta(seconds=9999),
            ),
            GenerationJob(user_id=owner.id, kind="finalize", status="succeeded", params={}),
        ]
    )
    await db_session.commit()

    duration = await finalize_duration_seconds(db_session)
    assert duration.average == 50.0
    assert duration.p50 == 20.0
    assert duration.p95 == pytest.approx(110.0)
