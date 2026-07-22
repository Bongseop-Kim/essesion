"""add Vertex AI motif embeddings alongside legacy vectors"""

from collections.abc import Sequence

import pgvector.sqlalchemy
import sqlalchemy as sa
from alembic import op

revision: str = "9b7c6d5e4f3a"
down_revision: str | None = "f1a2b3c4d5e6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "motifs",
        sa.Column("embedding_vertex", pgvector.sqlalchemy.Vector(dim=3072), nullable=True),
    )
    op.create_index(
        "ix_motifs_embedding_vertex_halfvec_hnsw",
        "motifs",
        [sa.literal_column("(embedding_vertex::halfvec(3072))").label("embedding_vertex_halfvec")],
        unique=False,
        postgresql_using="hnsw",
        postgresql_ops={"embedding_vertex_halfvec": "halfvec_cosine_ops"},
    )


def downgrade() -> None:
    op.drop_index("ix_motifs_embedding_vertex_halfvec_hnsw", table_name="motifs")
    op.drop_column("motifs", "embedding_vertex")
