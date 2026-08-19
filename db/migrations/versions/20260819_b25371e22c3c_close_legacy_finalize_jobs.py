"""동기 전환 이전의 미종결 finalize 잡 종결 (1회 정리)

finalize가 Cloud Tasks 큐에서 동기 요청-응답으로 전환되면서 stale 잡을 canceled로
회수하던 reconcile 배치(batch-reconcile-stale-generation-jobs)가 제거됐다. 전환
시점에 queued/processing으로 걸쳐 있던 행은 종결자가 없어 영원히 비종결로 남으므로
여기서 한 번에 canceled로 종결한다 — 제거된 배치와 같은 전이라 과금 원장은 건드리지
않고, 감사 추적(request_id)을 위해 행은 삭제하지 않는다. 새 동기 경로는 성공만
INSERT하므로 이 상태의 행은 다시 생기지 않는다.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "b25371e22c3c"
down_revision: str | None = "f1c6a80b5d29"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        "update generation_jobs set status = 'canceled', result = null, "
        "error_message = '동기 전환 이전의 미종결 잡 — 마이그레이션으로 종결', "
        "finished_at = now() "
        "where kind = 'finalize' and status in ('queued', 'processing')"
    )


def downgrade() -> None:
    # 종결 전이는 원래 상태를 남기지 않는다 — 되돌릴 정보가 없어 no-op.
    pass
