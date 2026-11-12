"""저장된 이미지·링크 주소를 essesion.shop에서 essesion.com으로 바꾼다

Revision ID: 8c2f5a1d7e93
Revises: 6b1e4d2a9c75
Create Date: 2026-11-12 00:00:00.000000

상품 이미지는 저장 시점에 절대 URL로 컬럼에 들어간다(admin/products.py의 public_asset_url).
essesion.shop은 2026-12-12에 만료되므로 그 전에 저장된 주소를 새 호스트로 옮긴다
(docs/plans/domain-move-essesion-com.md D-6). assets.essesion.com이 200을 주는 것을 확인한 뒤 실행한다.
대상은 절대 URL을 저장하는 컬럼뿐이다 — object_key만 저장하는 컬럼은 조회 시점에 URL을 만든다.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "8c2f5a1d7e93"
down_revision: str | None = "6b1e4d2a9c75"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# (테이블, 컬럼) — text 컬럼
_TEXT_COLUMNS = (
    ("products", "image"),
    ("design_examples", "photo_full_url"),
    ("design_examples", "photo_detail_url"),
    ("popup_notices", "link_url"),
)


def _swap(old: str, new: str) -> None:
    for table, column in _TEXT_COLUMNS:
        op.execute(
            f"update {table} set {column} = replace({column}, '{old}', '{new}') "
            f"where {column} like '%{old}%'"
        )
    # text[] — 원소별로 치환한다.
    op.execute(
        "update products set detail_images = "
        f"(select array_agg(replace(u, '{old}', '{new}') order by ord) "
        "from unnest(detail_images) with ordinality as t(u, ord)) "
        f"where array_to_string(detail_images, ' ') like '%{old}%'"
    )


def upgrade() -> None:
    _swap("essesion.shop", "essesion.com")


def downgrade() -> None:
    _swap("essesion.com", "essesion.shop")
