"""reconcile finalize quota index

Revision ID: e7f9a1b2c3d4
Revises: d4e6f8a102b3
Create Date: 2026-07-19 23:10:00.000000

"""

from collections.abc import Sequence

from alembic import op

revision: str = "e7f9a1b2c3d4"
down_revision: str | None = "d4e6f8a102b3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # c4d1a9f27e83 was corrected before release to include status, but an older
    # local/staging application of that revision can still have the 3-column
    # index. Rebuild it at a new immutable revision so every lineage converges.
    with op.get_context().autocommit_block():
        op.drop_index(
            "ix_generation_jobs_user_kind_created",
            table_name="generation_jobs",
            postgresql_concurrently=True,
            if_exists=True,
        )
        op.create_index(
            "ix_generation_jobs_user_kind_created",
            "generation_jobs",
            ["user_id", "kind", "status", "created_at"],
            unique=False,
            postgresql_concurrently=True,
        )


def downgrade() -> None:
    # The canonical schema at d4e6f8a102b3 already has this 4-column index.
    # This repair revision therefore has no schema change to reverse.
    pass
