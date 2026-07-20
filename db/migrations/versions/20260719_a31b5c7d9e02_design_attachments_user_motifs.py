"""add design attachments and user motif library

Revision ID: a31b5c7d9e02
Revises: c4d1a9f27e83
Create Date: 2026-07-19 18:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "a31b5c7d9e02"
down_revision: str | None = "c4d1a9f27e83"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("images", sa.Column("original_filename", sa.Text(), nullable=True))
    op.create_table(
        "user_motifs",
        sa.Column("id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("motif_id", sa.Text(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["motif_id"], ["motifs.id"], name=op.f("fk_user_motifs_motif_id_motifs")
        ),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name=op.f("fk_user_motifs_user_id_users")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_user_motifs")),
        sa.UniqueConstraint("user_id", "motif_id", name=op.f("uq_user_motifs_user_id_motif_id")),
    )
    op.create_index(op.f("ix_user_motifs_user_id"), "user_motifs", ["user_id"])

    op.create_table(
        "design_turn_attachments",
        sa.Column("id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("turn_id", sa.Uuid(), nullable=False),
        sa.Column("kind", sa.Text(), nullable=False),
        sa.Column("image_id", sa.Uuid(), nullable=True),
        sa.Column("motif_id", sa.Text(), nullable=True),
        sa.Column("filename", sa.Text(), nullable=False),
        sa.Column("ordinal", sa.Integer(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "kind IN ('photo', 'svg')", name=op.f("ck_design_turn_attachments_kind")
        ),
        sa.CheckConstraint(
            "(image_id IS NOT NULL)::int + (motif_id IS NOT NULL)::int = 1",
            name=op.f("ck_design_turn_attachments_exactly_one_target"),
        ),
        sa.ForeignKeyConstraint(
            ["image_id"],
            ["images.id"],
            name=op.f("fk_design_turn_attachments_image_id_images"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["motif_id"], ["motifs.id"], name=op.f("fk_design_turn_attachments_motif_id_motifs")
        ),
        sa.ForeignKeyConstraint(
            ["turn_id"],
            ["design_session_turns.id"],
            name=op.f("fk_design_turn_attachments_turn_id_design_session_turns"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_design_turn_attachments")),
        sa.UniqueConstraint(
            "turn_id", "ordinal", name=op.f("uq_design_turn_attachments_turn_id_ordinal")
        ),
    )
    op.create_index(
        op.f("ix_design_turn_attachments_turn_id"), "design_turn_attachments", ["turn_id"]
    )

    op.create_table(
        "seamless_generation_attachments",
        sa.Column("id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("log_id", sa.Uuid(), nullable=False),
        sa.Column("image_id", sa.Uuid(), nullable=False),
        sa.Column("ordinal", sa.Integer(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["image_id"],
            ["images.id"],
            name=op.f("fk_seamless_generation_attachments_image_id_images"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["log_id"],
            ["seamless_generation_logs.id"],
            name=op.f("fk_seamless_generation_attachments_log_id_seamless_generation_logs"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_seamless_generation_attachments")),
    )
    op.create_index(
        op.f("ix_seamless_generation_attachments_image_id"),
        "seamless_generation_attachments",
        ["image_id"],
    )
    op.create_index(
        op.f("ix_seamless_generation_attachments_log_id"),
        "seamless_generation_attachments",
        ["log_id"],
    )
    op.create_index(
        "uq_seamless_generation_attachments_log_ordinal",
        "seamless_generation_attachments",
        ["log_id", "ordinal"],
        unique=True,
    )
    op.execute(
        """
        INSERT INTO seamless_generation_attachments (log_id, image_id, ordinal)
        SELECT id, reference_image_id, 0
        FROM seamless_generation_logs
        WHERE reference_image_id IS NOT NULL
        ON CONFLICT DO NOTHING
        """
    )


def downgrade() -> None:
    op.drop_table("seamless_generation_attachments")
    op.drop_table("design_turn_attachments")
    op.drop_index(op.f("ix_user_motifs_user_id"), table_name="user_motifs")
    op.drop_table("user_motifs")
    op.drop_column("images", "original_filename")
