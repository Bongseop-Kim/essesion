"""주문 항목 사본과 문의 답변에 남은 essesion.shop 주소를 essesion.com으로 바꾼다

Revision ID: b3e7c9a41f06
Revises: 8c2f5a1d7e93
Create Date: 2026-11-20 00:00:00.000000

8c2f5a1d7e93이 다루지 않은 두 컬럼이다(2026-11-20 운영 DB 전수 확인에서 5행).
order_items.item_data는 주문 시점의 상품 사본이라 상품 이미지의 절대 URL이 함께 들어가고,
inquiries.answer는 관리자가 쓴 답변 본문에 사이트 링크가 있다. essesion.shop은 2026-12-12에 만료된다.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "b3e7c9a41f06"
down_revision: str | None = "8c2f5a1d7e93"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _swap(old: str, new: str) -> None:
    # 호스트 문자열에는 JSON 이스케이프 대상 문자가 없어 text로 치환해도 구조가 깨지지 않는다.
    op.execute(
        f"update order_items set item_data = replace(item_data::text, '{old}', '{new}')::jsonb "
        f"where item_data::text like '%{old}%'"
    )
    op.execute(
        f"update inquiries set answer = replace(answer, '{old}', '{new}') where answer like '%{old}%'"
    )


def upgrade() -> None:
    _swap("essesion.shop", "essesion.com")


def downgrade() -> None:
    _swap("essesion.com", "essesion.shop")
