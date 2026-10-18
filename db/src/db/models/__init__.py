"""전 모델 임포트 — Base.metadata에 36개 테이블을 등록한다 (alembic autogenerate 대상)."""

from db.models import auth, commerce, content, design, images, seamless  # noqa: F401
from db.models.base import Base

__all__ = ["Base", "auth", "commerce", "design", "images", "seamless"]
