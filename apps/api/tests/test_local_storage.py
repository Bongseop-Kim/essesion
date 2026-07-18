"""로컬 스토리지(GCS 대체) — LocalGcsClient + /local-storage 라우트.

GCS 미설정 local에서 파일이 실제로 저장·서빙되는 계약을 검증한다.
테스트 스위트 공용 settings는 local_storage_dir=""(DryRun)이므로, 여기서만
tmp_path를 루트로 지정해 디스크 격리한다.
"""

import pytest
from api.config import Settings
from api.integrations.gcs import (
    DryRunGcsClient,
    LocalGcsClient,
    build_gcs_client,
    local_object_path,
    public_asset_url,
)
from api.main import create_app
from fastapi.testclient import TestClient
from pydantic_settings import SettingsConfigDict


class _TestSettings(Settings):
    model_config = SettingsConfigDict(env_file=None)


def _local_settings(tmp_path) -> Settings:
    return _TestSettings(env="local", local_storage_dir=str(tmp_path))


def test_build_gcs_client_selects_local_store_then_dry_run(tmp_path):
    assert isinstance(build_gcs_client(_local_settings(tmp_path)), LocalGcsClient)
    assert isinstance(
        build_gcs_client(_TestSettings(env="local", local_storage_dir="")), DryRunGcsClient
    )


def test_public_asset_url_points_at_local_route(tmp_path):
    url = public_asset_url(_local_settings(tmp_path), "fabric/abc.png")
    assert url == "http://localhost:8000/local-storage/dry-run-assets/fabric/abc.png"
    # local_storage_dir이 비면 예전 dry-run URL 형태 유지
    legacy = public_asset_url(_TestSettings(env="local", local_storage_dir=""), "fabric/abc.png")
    assert legacy is not None and legacy.startswith("https://storage.googleapis.com/")


async def test_signed_urls_and_metadata(tmp_path):
    settings = _local_settings(tmp_path)
    gcs = LocalGcsClient(settings)

    upload_url = await gcs.signed_upload_url(
        "uploads/a/b.png", "image/png", max_size_bytes=1024, create_only=True
    )
    assert upload_url == (
        "http://localhost:8000/local-storage/dry-run-uploads/uploads/a/b.png"
        "?max_size=1024&create_only=1"
    )
    read_url = await gcs.signed_read_url("uploads/a/b.png")
    assert read_url == "http://localhost:8000/local-storage/dry-run-uploads/uploads/a/b.png"

    assert await gcs.object_metadata("uploads/none.png") is None


def test_put_get_roundtrip_updates_metadata(tmp_path):
    settings = _local_settings(tmp_path)
    application = create_app(settings)
    with TestClient(application) as client:
        put = client.put(
            "/local-storage/dry-run-uploads/uploads/a/b.png?max_size=1024",
            content=b"png-bytes",
            headers={"Content-Type": "image/png"},
        )
        assert put.status_code == 200

        got = client.get("/local-storage/dry-run-uploads/uploads/a/b.png")
        assert got.status_code == 200
        assert got.content == b"png-bytes"
        assert got.headers["content-type"].startswith("image/png")

    stored = local_object_path(tmp_path, "dry-run-uploads", "uploads/a/b.png")
    assert stored.read_bytes() == b"png-bytes"


def test_put_enforces_create_only_and_size(tmp_path):
    settings = _local_settings(tmp_path)
    application = create_app(settings)
    with TestClient(application) as client:
        url = "/local-storage/dry-run-uploads/uploads/immutable.png?create_only=1&max_size=4"
        assert client.put(url, content=b"1234").status_code == 200
        # staging 키 불변 — 재업로드는 GCS generation-match 위반과 동일하게 거부
        assert client.put(url, content=b"5678").status_code == 412
        assert (
            client.put(
                "/local-storage/dry-run-uploads/uploads/too-big.png?max_size=4",
                content=b"12345",
            ).status_code
            == 413
        )
        assert (
            client.put("/local-storage/dry-run-uploads/uploads/empty.png", content=b"").status_code
            == 413
        )


def test_serving_rejects_path_traversal(tmp_path):
    settings = _local_settings(tmp_path)
    (tmp_path / "secret.txt").write_text("do-not-serve")
    application = create_app(settings)
    with TestClient(application) as client:
        assert client.get("/local-storage/dry-run-assets/../secret.txt").status_code == 404
        assert client.get("/local-storage/dry-run-assets/%2e%2e/secret.txt").status_code == 404
        assert (
            client.put("/local-storage/dry-run-assets/../evil.txt", content=b"x").status_code
            == 404
        )
    with pytest.raises(ValueError):
        local_object_path(tmp_path, "dry-run-assets", "../secret.txt")
    with pytest.raises(ValueError):
        local_object_path(tmp_path, "..", "secret.txt")


async def test_copy_and_delete_semantics(tmp_path):
    settings = _local_settings(tmp_path)
    gcs = LocalGcsClient(settings)
    source = tmp_path / "dry-run-assets" / "fabric" / "src.png"
    source.parent.mkdir(parents=True)
    source.write_bytes(b"fabric")
    (tmp_path / "dry-run-assets" / "fabric" / "src.png.ctype").write_text("image/png")

    assert await gcs.copy_from_bucket("dry-run-assets", "fabric/src.png", "uploads/dst.png")
    copied = await gcs.object_metadata("uploads/dst.png")
    assert copied is not None and copied.content_type == "image/png"
    # 대상이 이미 있으면 덮어쓰지 않고 성공 취급 (create-only 의미)
    assert await gcs.copy_from_bucket("dry-run-assets", "fabric/src.png", "uploads/dst.png")
    # 원본 없음 → False (호출자가 upstream 실패 처리)
    assert not await gcs.copy_from_bucket("dry-run-assets", "fabric/none.png", "uploads/x.png")

    assert await gcs.delete_object("uploads/dst.png")
    assert await gcs.object_metadata("uploads/dst.png") is None
    assert await gcs.delete_object("uploads/dst.png")  # 멱등


def test_local_storage_route_not_mounted_in_dry_run(tmp_path):
    application = create_app(_TestSettings(env="local", local_storage_dir=""))
    with TestClient(application) as client:
        assert client.get("/local-storage/dry-run-assets/a.png").status_code == 404
