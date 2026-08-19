from api.integrations.gcs import GcsObjectMetadata
from db.models.images import Image
from sqlalchemy import select


class FakeGcsClient:
    """실 GCS 대역. 업로드 완료 검증을 통과시키려면 테스트가 `metadata`를 채운다."""

    def __init__(self) -> None:
        self.deleted: list[str] = []
        self.deleted_from: list[tuple[str | None, str]] = []
        self.copied: list[tuple[str, str, str]] = []
        self.metadata: dict[str, GcsObjectMetadata] = {}

    async def signed_upload_url(
        self,
        object_key: str,
        content_type: str,
        *,
        max_size_bytes: int | None = None,
        bucket_name: str | None = None,
        create_only: bool = False,
    ) -> str:
        bucket = f"{bucket_name}/" if bucket_name else ""
        return f"https://storage.googleapis.example/test/{bucket}{object_key}"

    async def signed_read_url(self, object_key: str) -> str:
        return f"https://storage.googleapis.example/test/{object_key}"

    async def delete_object(self, object_key: str, *, bucket_name: str | None = None) -> bool:
        self.deleted.append(object_key)
        self.deleted_from.append((bucket_name, object_key))
        return True

    async def object_metadata(
        self, object_key: str, *, bucket_name: str | None = None
    ) -> GcsObjectMetadata | None:
        return self.metadata.get(object_key)

    async def copy_from_bucket(
        self, source_bucket: str, source_key: str, destination_key: str
    ) -> bool:
        self.copied.append((source_bucket, source_key, destination_key))
        # 복사가 끝나면 대상 객체가 실제로 존재한다 — 호출자의 메타데이터 검증 대상.
        self.metadata[destination_key] = self.metadata.get(
            source_key, GcsObjectMetadata(size_bytes=1, content_type="image/png")
        )
        return True


async def simulate_uploads(app) -> None:  # noqa: ANN001 — FastAPI app state만 사용
    """스테이징된 Image 행대로 객체가 올라간 것처럼 등록한다 — 브라우저 PUT 대역."""

    gcs = app.state.gcs
    async with app.state.sessionmaker() as session:
        images = (await session.scalars(select(Image))).all()
    for image in images:
        gcs.metadata[image.object_key] = GcsObjectMetadata(
            size_bytes=image.size_bytes or 1, content_type=image.content_type
        )
