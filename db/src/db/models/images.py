"""이미지 추적 — ImageKit → GCS 재설계 (url/file_id → object_key).

2단계 삭제(claim → finalize) 패턴 유지: 만료·수동삭제 대상을 deletion_claimed_at으로
클레임 후 GCS 삭제 성공 시 deleted_at 기록. 정리 배치는 Cloud Scheduler → api.
"""

import uuid
from datetime import datetime

from sqlalchemy import ForeignKey, Index, text
from sqlalchemy.orm import Mapped, mapped_column

from db.models.base import Base, CreatedAtMixin, uuid_pk


class Image(CreatedAtMixin, Base):
    __tablename__ = "images"

    id: Mapped[uuid.UUID] = uuid_pk()
    object_key: Mapped[str]  # 비공개 uploads 버킷 내 GCS 객체 키
    entity_type: Mapped[str]
    entity_id: Mapped[str]
    uploaded_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    claim_token_hash: Mapped[str | None]
    content_type: Mapped[str | None]
    size_bytes: Mapped[int | None]
    upload_completed_at: Mapped[datetime | None]
    expires_at: Mapped[datetime | None]  # null = 영구 보관
    deleted_at: Mapped[datetime | None]
    deletion_claimed_at: Mapped[datetime | None]

    __table_args__ = (
        Index("ix_images_entity", "entity_type", "entity_id"),
        Index(
            "ix_images_expires",
            "expires_at",
            postgresql_where=text("expires_at IS NOT NULL AND deleted_at IS NULL"),
        ),
        Index(
            "ix_images_deletion_claimed",
            "deletion_claimed_at",
            postgresql_where=text("deletion_claimed_at IS NOT NULL AND deleted_at IS NULL"),
        ),
        Index(
            "uq_images_reform_upload",
            "entity_type",
            "entity_id",
            unique=True,
            postgresql_where=text("entity_type = 'reform_upload'"),
        ),
        Index(
            "uq_images_repair_shipping_upload",
            "entity_type",
            "entity_id",
            unique=True,
            postgresql_where=text("entity_type = 'repair_shipping_upload'"),
        ),
    )
