"""design_finalize_cost admin_settings 행 보강

Revision ID: a3f7d94c1e28
Revises: b25371e22c3c
Create Date: 2026-08-21 00:00:00.000000

실사화 과금(`design_finalize_cost`)은 커밋 de06e7d에서 도입됐지만 기존 DB에 행을 넣는
경로가 수동 `seed-config`뿐이었다. 행이 없으면 `ledger.get_cost`가 하드 에러를 내고
`GET /tokens/balance` 전체가 400 `token_cost_not_configured`로 죽는다(2026-08-21 로컬 재현).

`seed-config`는 수동이라 잊힌다 — 기존 운영 DB에 **새 키를 추가**할 때는 이 마이그레이션처럼
`on conflict do nothing` INSERT를 함께 넣는다(값 변경은 f1c6a80b5d29의 UPDATE 패턴).
값은 `apps/api/src/api/config_defaults.py`·`docs/api-spec/money.md`가 정본이다.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "a3f7d94c1e28"
down_revision: str | None = "b25371e22c3c"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        "insert into admin_settings (key, value) values ('design_finalize_cost', '200') "
        "on conflict (key) do nothing"
    )


def downgrade() -> None:
    # 행을 지우면 잔액 조회가 다시 죽는다 — 되돌릴 대상이 아니다.
    pass
