"""LLM/임베딩을 OpenAI로 교체 — embedding_vertex(3072) → embedding_openai(1536)

Revision ID: 6dbb8bb66939
Revises: f8c3b2a19d47
Create Date: 2026-08-03 00:00:00.000000

기존 Vertex 벡터는 모델이 달라 전부 무효 — 새 컬럼은 NULL로 시작하고 재임베딩은
스크립트가 한다: `index_motif_embeddings.py --confirm-live` →
`seed_authoring_examples.py --confirm-live`(bootstrap active 복구 포함).
pending/hold 승격 후보는 삭제한다 — 원본 생성 로그가 다시 스캔 가능해져 관리자
scan이 새 임베딩으로 재생성한다. downgrade는 스키마만 복원한다(데이터 복원 없음).
"""

from collections.abc import Sequence

import pgvector.sqlalchemy
import sqlalchemy as sa
from alembic import op

revision: str = "6dbb8bb66939"
down_revision: str | None = "f8c3b2a19d47"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

EMBEDDING_DIM = 1536
OLD_EMBEDDING_DIM = 3072


def upgrade() -> None:
    # motifs — halfvec expression HNSW가 필요 없어졌다: 1536 ≤ pgvector 인덱스 dim 한계(2000)
    op.drop_index("ix_motifs_embedding_vertex_halfvec_hnsw", table_name="motifs")
    op.drop_column("motifs", "embedding_vertex")
    op.add_column(
        "motifs",
        sa.Column("embedding_openai", pgvector.sqlalchemy.Vector(dim=EMBEDDING_DIM), nullable=True),
    )
    op.create_index(
        "ix_motifs_embedding_openai_hnsw",
        "motifs",
        ["embedding_openai"],
        unique=False,
        postgresql_using="hnsw",
        postgresql_ops={"embedding_openai": "vector_cosine_ops"},
    )

    # authoring_examples — active 행은 새 컬럼에서 임베딩이 NULL이라 active_ready를 위반한다.
    # bootstrap 행은 activation 이력을 비워 seed 스크립트가 재임베딩하며 active를 복구하게
    # 하고, promoted/authored 행은 관리자 재활성화 대상으로 남긴다.
    op.execute(
        "UPDATE authoring_examples SET active = false, active_updated_at = NULL, "
        "active_updated_by = NULL, active_reason = NULL WHERE source = 'bootstrap'"
    )
    op.execute(
        "UPDATE authoring_examples SET active = false, "
        "active_reason = 'embedding model migration: re-embed required' WHERE active"
    )
    op.drop_constraint("ck_authoring_examples_active_ready", "authoring_examples")
    op.drop_column("authoring_examples", "embedding_vertex")
    op.add_column(
        "authoring_examples",
        sa.Column("embedding_openai", pgvector.sqlalchemy.Vector(dim=EMBEDDING_DIM), nullable=True),
    )
    op.create_check_constraint(
        "active_ready",
        "authoring_examples",
        "NOT active OR (embedding_openai IS NOT NULL AND approved_at IS NOT NULL)",
    )

    # authoring_promotion_candidates — pending/hold는 임베딩 없이 검토 대기 상태로 존재할 수
    # 없다(reviewable_ready). 삭제하면 원본 로그의 후보 배제가 풀려 다음 scan이 새 임베딩으로
    # 재생성한다. terminal 행(approved 등)은 감사 기록으로 남기되 임베딩 페어를 NULL로 정리.
    op.execute("DELETE FROM authoring_promotion_candidates WHERE status IN ('pending', 'hold')")
    op.drop_constraint(
        "ck_authoring_promotion_candidates_reviewable_ready", "authoring_promotion_candidates"
    )
    op.drop_column("authoring_promotion_candidates", "embedding_vertex")
    op.add_column(
        "authoring_promotion_candidates",
        sa.Column("embedding_openai", pgvector.sqlalchemy.Vector(dim=EMBEDDING_DIM), nullable=True),
    )
    op.execute("UPDATE authoring_promotion_candidates SET embedding_model = NULL")
    # approved는 terminal이라 제외 — 임베딩 모델 이관 후에도 승인 이력을 보존한다.
    op.create_check_constraint(
        "reviewable_ready",
        "authoring_promotion_candidates",
        "status NOT IN ('pending', 'hold') OR "
        "(embedding_model IS NOT NULL AND embedding_openai IS NOT NULL "
        "AND structural_fingerprint IS NOT NULL)",
    )


def downgrade() -> None:
    op.drop_constraint(
        "ck_authoring_promotion_candidates_reviewable_ready", "authoring_promotion_candidates"
    )
    op.drop_column("authoring_promotion_candidates", "embedding_openai")
    op.add_column(
        "authoring_promotion_candidates",
        sa.Column(
            "embedding_vertex", pgvector.sqlalchemy.Vector(dim=OLD_EMBEDDING_DIM), nullable=True
        ),
    )
    # upgrade 이후 쌓인 pending/hold는 embedding_vertex가 NULL이라 복원 제약을 위반한다 —
    # upgrade와 같은 근거로 삭제해 원본 로그의 후보 배제를 풀고 다음 scan이 재생성하게 한다.
    op.execute("DELETE FROM authoring_promotion_candidates WHERE status IN ('pending', 'hold')")
    # 구 제약은 approved에도 임베딩을 요구한다 — 벡터가 사라진 approved 행은 invalid로 강등.
    op.execute(
        "UPDATE authoring_promotion_candidates SET status = 'invalid' WHERE status = 'approved'"
    )
    op.create_check_constraint(
        "reviewable_ready",
        "authoring_promotion_candidates",
        "status NOT IN ('pending', 'hold', 'approved') OR "
        "(embedding_model IS NOT NULL AND embedding_vertex IS NOT NULL "
        "AND structural_fingerprint IS NOT NULL)",
    )

    op.drop_constraint("ck_authoring_examples_active_ready", "authoring_examples")
    op.drop_column("authoring_examples", "embedding_openai")
    op.add_column(
        "authoring_examples",
        sa.Column(
            "embedding_vertex", pgvector.sqlalchemy.Vector(dim=OLD_EMBEDDING_DIM), nullable=True
        ),
    )
    op.execute("UPDATE authoring_examples SET active = false WHERE active")
    op.create_check_constraint(
        "active_ready",
        "authoring_examples",
        "NOT active OR (embedding_vertex IS NOT NULL AND approved_at IS NOT NULL)",
    )

    op.drop_index("ix_motifs_embedding_openai_hnsw", table_name="motifs")
    op.drop_column("motifs", "embedding_openai")
    op.add_column(
        "motifs",
        sa.Column(
            "embedding_vertex", pgvector.sqlalchemy.Vector(dim=OLD_EMBEDDING_DIM), nullable=True
        ),
    )
    op.create_index(
        "ix_motifs_embedding_vertex_halfvec_hnsw",
        "motifs",
        [sa.literal_column("(embedding_vertex::halfvec(3072))").label("embedding_vertex_halfvec")],
        unique=False,
        postgresql_using="hnsw",
        postgresql_ops={"embedding_vertex_halfvec": "halfvec_cosine_ops"},
    )
