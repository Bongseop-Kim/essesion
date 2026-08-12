"""클레임 status에 '취소' 추가 — 고객이 접은 토큰 환불 요청을 '거부'와 구분

Revision ID: e71baf2532ce
Revises: 6dbb8bb66939
Create Date: 2026-08-11 00:00:00.000000

일반 클레임의 고객 취소는 행 삭제지만 token_refund는 결제 감사 추적 때문에 행을 남겨야 해서
상태로 구분한다. 지금까지는 관리자 거부와 같은 '거부'로 기록돼 고객 화면에도 거부로 보였다.
기존 '거부' 데이터의 소급 변환은 하지 않는다 — 로그 memo("고객 환불 요청 취소")로 구분되고
로컬·초기 데이터뿐이다. '취소'는 '거부'와 같은 종료 상태라 활성 클레임 부분 인덱스(
uq_claims_active_per_item·uq_claims_single_active_per_order)의 where 절은 그대로 둔다.
downgrade는 '취소' 행을 '거부'로 되돌린다 — 제약을 되살리려면 위반 행이 없어야 한다.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "e71baf2532ce"
down_revision: str | None = "6dbb8bb66939"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

OLD_STATUSES = "'접수', '처리중', '수거요청', '수거완료', '재발송', '완료', '거부'"
NEW_STATUSES = f"{OLD_STATUSES}, '취소'"


def upgrade() -> None:
    op.drop_constraint("ck_claims_status", "claims")
    op.create_check_constraint("status", "claims", f"status IN ({NEW_STATUSES})")


def downgrade() -> None:
    op.execute("UPDATE claims SET status = '거부' WHERE status = '취소'")
    op.drop_constraint("ck_claims_status", "claims")
    op.create_check_constraint("status", "claims", f"status IN ({OLD_STATUSES})")
