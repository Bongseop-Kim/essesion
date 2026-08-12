"""motifs.variant_group 드랍 — 재사용 래더 제거로 읽는 코드가 없다

Revision ID: a4d9c1e57b02
Revises: e71baf2532ce
Create Date: 2026-08-12 00:00:00.000000

모티프 AI 생성이 항상 새로 생성하는 계약으로 바뀌며 variant pool 샘플링이 사라졌다
(docs/plans/motif-generate-always-create.md). 값은 sha256(subject, scope) 파생이라 정보
손실이 없고, downgrade는 컬럼 복원 후 subject/scope로 재계산한다(원본 키 함수와 동일:
canonical_json({"v":2, "subject", "scope"})의 sha256 hex 앞 16자, NFC+strip+casefold).
"""

import hashlib
import json
import unicodedata
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "a4d9c1e57b02"
down_revision: str | None = "e71baf2532ce"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_column("motifs", "variant_group")


def _normalize(value: str | None) -> str:
    if value is None:
        return ""
    return unicodedata.normalize("NFC", value).strip().casefold()


def _variant_group_key(subject: str | None, scope: str | None) -> str:
    payload = {"v": 2, "subject": _normalize(subject), "scope": _normalize(scope)}
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()[:16]


def downgrade() -> None:
    op.add_column("motifs", sa.Column("variant_group", sa.Text(), nullable=True))
    conn = op.get_bind()
    rows = conn.execute(
        sa.text("SELECT id, subject, scope FROM motifs WHERE source != 'user_upload'")
    ).all()
    for motif_id, subject, scope in rows:
        conn.execute(
            sa.text("UPDATE motifs SET variant_group = :vg WHERE id = :id"),
            {"vg": _variant_group_key(subject, scope), "id": motif_id},
        )
