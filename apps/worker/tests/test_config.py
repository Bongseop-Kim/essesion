"""Settings 경계값 검증 — 잘못된 τ·비유한 float·0 이하 리소스 상한은 부팅 전에 거부."""

import pytest
from pydantic import ValidationError
from worker.config import Settings


def _settings(**overrides: object) -> Settings:
    return Settings(_env_file=None, **overrides)  # type: ignore[call-arg]


def test_settings_validates_motif_similarity_tau() -> None:
    _settings(motif_similarity_tau=0.0)
    _settings(motif_similarity_tau=1.0)

    with pytest.raises(ValidationError):
        _settings(motif_similarity_tau=-0.01)
    with pytest.raises(ValidationError):
        _settings(motif_similarity_tau=1.01)


def test_settings_validates_recraft_max_color_slots() -> None:
    _settings(recraft_max_color_slots=1)

    with pytest.raises(ValidationError):
        _settings(recraft_max_color_slots=0)


@pytest.mark.parametrize("value", [float("nan"), float("inf"), float("-inf")])
def test_settings_rejects_non_finite_motif_max_aspect_ratio(value: float) -> None:
    with pytest.raises(ValidationError):
        _settings(motif_max_aspect_ratio=value)


@pytest.mark.parametrize("value", [float("nan"), float("inf"), float("-inf")])
def test_settings_rejects_non_finite_motif_edge_seam_tol(value: float) -> None:
    with pytest.raises(ValidationError):
        _settings(motif_edge_seam_tol=value)


@pytest.mark.parametrize("value", [float("nan"), float("inf"), float("-inf")])
def test_settings_rejects_non_finite_max_tile_mm(value: float) -> None:
    with pytest.raises(ValidationError):
        _settings(max_tile_mm=value)


def test_settings_resource_ceiling_defaults() -> None:
    s = _settings()
    assert s.max_placement_instances == 50_000
    assert s.max_svg_bytes == 2_000_000
    assert s.preview_dpi == 192
    assert s.preview_render_concurrency == 2
    assert s.finalize_lease_seconds == 960
    assert s.service_mode == "all"


def test_settings_validates_resource_ceilings() -> None:
    _settings(
        max_placement_instances=1,
        max_svg_bytes=1,
        preview_dpi=1200,
        preview_render_concurrency=8,
        finalize_lease_seconds=1,
    )

    with pytest.raises(ValidationError):
        _settings(max_placement_instances=0)
    with pytest.raises(ValidationError):
        _settings(max_svg_bytes=0)
    with pytest.raises(ValidationError):
        _settings(preview_dpi=1201)
    with pytest.raises(ValidationError):
        _settings(preview_render_concurrency=9)
    with pytest.raises(ValidationError):
        _settings(finalize_lease_seconds=0)


def test_settings_validates_service_mode() -> None:
    _settings(service_mode="generate")
    _settings(service_mode="finalize")

    with pytest.raises(ValidationError):
        _settings(service_mode="other")


def test_settings_validates_gemini_temperature() -> None:
    _settings(gemini_temperature=0.0)
    _settings(gemini_temperature=2.0)

    with pytest.raises(ValidationError):
        _settings(gemini_temperature=2.01)


def test_settings_does_not_own_authoring_rollout() -> None:
    settings = _settings()
    assert not hasattr(settings, "authoring_pipeline_mode")
    assert not hasattr(settings, "authoring_shadow_percent")
    assert not hasattr(settings, "authoring_canary_percent")


def test_settings_validates_stripe_max_band_coverage() -> None:
    _settings(stripe_max_band_coverage=0.1)
    _settings(stripe_max_band_coverage=1.0)

    with pytest.raises(ValidationError):
        _settings(stripe_max_band_coverage=0.05)
    with pytest.raises(ValidationError):
        _settings(stripe_max_band_coverage=1.01)
