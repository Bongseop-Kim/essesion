"""GCS 에뮬레이터(fake-gcs-server) 모드 — 로컬에서 RealGcsClient가 서명 없이 동작.

에뮬레이터 자체는 docker compose로 뜨므로 여기서는 네트워크 없이 검증 가능한
계약만 다룬다: 클라이언트 선택, URL 형태, 배포 환경 fail-closed.
"""

import pytest
from api.config import Settings
from api.integrations.gcs import (
    DryRunGcsClient,
    RealGcsClient,
    build_gcs_client,
    public_asset_url,
)
from pydantic_settings import SettingsConfigDict


class _TestSettings(Settings):
    model_config = SettingsConfigDict(env_file=None)


def _emulator_settings(**overrides) -> Settings:
    overrides.setdefault("env", "local")
    return _TestSettings(
        gcs_emulator_host="http://localhost:4443",
        gcs_upload_bucket="dev-uploads",
        gcs_assets_bucket="dev-assets",
        **overrides,
    )


def test_build_gcs_client_selects_real_client_against_emulator():
    client = build_gcs_client(_emulator_settings())
    assert isinstance(client, RealGcsClient)
    assert client.capability_mode == "real"
    # 에뮬레이터 host만 있고 버킷이 없으면 예전처럼 DryRun
    assert isinstance(
        build_gcs_client(
            _TestSettings(env="local", gcs_emulator_host="http://localhost:4443")
        ),
        DryRunGcsClient,
    )


def test_emulator_host_is_rejected_outside_local():
    with pytest.raises(RuntimeError):
        build_gcs_client(
            _emulator_settings(env="staging", public_api_origin="https://api.example.com")
        )


async def test_emulator_urls_skip_signing():
    client = build_gcs_client(_emulator_settings())
    upload_url = await client.signed_upload_url(
        "uploads/a/b.png", "image/png", max_size_bytes=1024, create_only=True
    )
    # X-Goog-Algorithm 쿼리가 있어야 fake-gcs-server가 signed-URL PUT으로 라우팅한다
    assert upload_url == (
        "http://localhost:4443/dev-uploads/uploads/a/b.png"
        "?X-Goog-Algorithm=GOOG4-RSA-SHA256&X-Goog-Signature=emulator"
    )
    assets_url = await client.signed_upload_url(
        "products/c.png", "image/png", bucket_name="dev-assets"
    )
    assert assets_url.startswith("http://localhost:4443/dev-assets/products/c.png?")
    read_url = await client.signed_read_url("uploads/a/b.png")
    assert read_url == "http://localhost:4443/dev-uploads/uploads/a/b.png"


def test_public_asset_url_points_at_emulator_assets_bucket():
    url = public_asset_url(_emulator_settings(), "fabric/abc.png")
    assert url == "http://localhost:4443/dev-assets/fabric/abc.png"
    # 명시적 override(Cloudflare asset proxy 등)가 항상 이긴다
    overridden = public_asset_url(
        _emulator_settings(gcs_assets_public_base_url="https://assets.example.com"),
        "fabric/abc.png",
    )
    assert overridden == "https://assets.example.com/fabric/abc.png"
