from decimal import Decimal

import pytest
from db.models.seamless import SeamlessGenerationLog
from sqlalchemy import select
from worker.api import routes
from worker.render.raster import RasterError

from .intent_helpers import mvp_intent, register_test_motifs

register_test_motifs()


async def _latest_log(db_session) -> SeamlessGenerationLog:
    row = await db_session.scalar(
        select(SeamlessGenerationLog).order_by(SeamlessGenerationLog.created_at.desc())
    )
    assert row is not None
    return row


async def test_worker_records_success_with_actual_render_timing(client, db_session, monkeypatch):
    monkeypatch.setattr(
        routes,
        "rasterize_svg",
        lambda _svg, **_kwargs: (b"fake-png", "image/png"),
    )
    response = await client.post(
        "/generate",
        headers={"X-Request-ID": "log-success"},
        json={"intent": mvp_intent(), "candidate_count": 1},
    )
    assert response.status_code == 200

    row = await _latest_log(db_session)
    assert row.request_id == "log-success"
    assert row.status == "success"
    assert row.generate_ms is not None and row.generate_ms >= Decimal(0)
    assert row.render_ms is not None and row.render_ms >= Decimal(0)
    assert row.error_message is None
    assert row.diagnostics == {
        "mode": "variation",
        "reference_count": 0,
        "fixed_palette": False,
        "pattern_controls": False,
        "candidate_count": 1,
    }


async def test_worker_records_partial_with_render_timing_and_sanitized_warning(
    client, db_session, monkeypatch
):
    def fail_raster(_svg, **_kwargs):
        raise RasterError("/private/customer/path api_key=secret")

    monkeypatch.setattr(routes, "rasterize_svg", fail_raster)
    response = await client.post(
        "/generate",
        headers={"X-Request-ID": "log-partial"},
        json={"intent": mvp_intent(), "candidate_count": 1},
    )
    assert response.status_code == 200

    row = await _latest_log(db_session)
    assert row.status == "partial"
    assert row.render_ms is not None and row.render_ms >= Decimal(0)
    assert row.warnings == ["preview upload skipped"]
    assert "private" not in str(row.warnings)
    assert "secret" not in str(row.warnings)


async def test_worker_records_exception_with_sanitized_error_and_zero_render_time(
    client, db_session
):
    intent = mvp_intent()
    intent["layers"][0]["params"]["color"] = "customer-secret@test.local"
    response = await client.post(
        "/generate",
        headers={"X-Request-ID": "log-error"},
        json={"intent": intent},
    )
    assert response.status_code == 422

    row = await _latest_log(db_session)
    assert row.request_id == "log-error"
    assert row.status == "error"
    assert row.error_type == "intent_invalid"
    assert row.error_message == "generation rejected at intent stage"
    assert row.generate_ms is not None and row.generate_ms >= Decimal(0)
    assert row.render_ms == Decimal(0)
    assert "customer-secret@test.local" not in row.error_message
    assert row.diagnostics["failure_code"] == "intent_invalid"
    assert row.diagnostics["failure_stage"] == "intent"


async def test_worker_sanitizes_unexpected_exception_before_persisting(
    client, db_session, monkeypatch
):
    def fail_generation(*_args, **_kwargs):
        raise RuntimeError("api_key=super-secret /private/customer.png")

    monkeypatch.setattr(routes, "generate_candidates", fail_generation)
    with pytest.raises(RuntimeError, match="super-secret"):
        await client.post(
            "/generate",
            headers={"X-Request-ID": "log-unexpected"},
            json={"intent": mvp_intent()},
        )

    row = await _latest_log(db_session)
    assert row.status == "error"
    assert row.error_type == "RuntimeError"
    assert row.error_message == "generation failed"
    assert "super-secret" not in row.error_message
    assert row.render_ms == Decimal(0)
