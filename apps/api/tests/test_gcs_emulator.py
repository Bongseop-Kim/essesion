"""로컬 GCS 기본값 — fake-gcs-server 실경로와 배포 fail-fast 계약."""

import uuid

import httpx
import pytest
from api.config import Settings
from api.integrations.gcs import (
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
    assert isinstance(build_gcs_client(_TestSettings(env="local")), RealGcsClient)


def test_emulator_host_is_rejected_outside_local():
    with pytest.raises(RuntimeError):
        build_gcs_client(
            _emulator_settings(env="staging", public_api_origin="https://api.example.com")
        )


def test_nonlocal_missing_buckets_fail_fast():
    settings = _TestSettings(env="staging", public_api_origin="https://api.example.com")
    with pytest.raises(RuntimeError, match="GCS_UPLOAD_BUCKET"):
        build_gcs_client(settings)
    with pytest.raises(RuntimeError, match="GCS_ASSETS_BUCKET"):
        build_gcs_client(
            _TestSettings(
                env="staging",
                public_api_origin="https://api.example.com",
                gcs_upload_bucket="uploads",
            )
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


async def test_default_local_client_round_trips_through_emulator():
    client = build_gcs_client(_TestSettings(env="test"))
    object_key = f"uploads/test/{uuid.uuid4()}.txt"
    upload_url = await client.signed_upload_url(object_key, "text/plain", create_only=True)

    async with httpx.AsyncClient() as http:
        uploaded = await http.put(
            upload_url,
            content=b"emulator",
            headers={"Content-Type": "text/plain"},
        )
    assert uploaded.status_code < 300
    assert await client.object_metadata(object_key) is not None
    assert await client.delete_object(object_key)
    assert await client.object_metadata(object_key) is None


def test_public_asset_url_points_at_emulator_assets_bucket():
    url = public_asset_url(_emulator_settings(), "fabric/abc.png")
    assert url == "http://localhost:4443/dev-assets/fabric/abc.png"
    # 명시적 override(Cloudflare asset proxy 등)가 항상 이긴다
    overridden = public_asset_url(
        _emulator_settings(gcs_assets_public_base_url="https://assets.example.com"),
        "fabric/abc.png",
    )
    assert overridden == "https://assets.example.com/fabric/abc.png"

    assert public_asset_url(_TestSettings(env="local"), "fabric/default.png") == (
        "http://localhost:4443/dev-assets/fabric/default.png"
    )
