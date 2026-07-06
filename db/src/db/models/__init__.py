"""전 모델 임포트 — Base.metadata에 33개 테이블을 등록한다 (alembic autogenerate 대상)."""

from db.models import auth, commerce, design, images, seamless, tokens  # noqa: F401
from db.models.base import Base

__all__ = ["Base", "auth", "commerce", "design", "images", "seamless", "tokens"]
