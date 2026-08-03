"""remove design-generation reference photos and implicit motif sources

Revision ID: 6c4f2a9d1b7e
Revises: dadd999bf858
Create Date: 2026-08-03 10:30:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "6c4f2a9d1b7e"
down_revision: str | None = "dadd999bf858"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Preserve only the staged-upload infrastructure still used by palette extraction and
    # photo-to-SVG. Images attached solely to removed design-generation flows are orphans.
    op.execute(
        """
        CREATE TEMP TABLE removed_design_reference_image_ids ON COMMIT DROP AS
        SELECT image_id FROM seamless_generation_attachments
        UNION
        SELECT image_id FROM design_turn_attachments
        WHERE image_id IS NOT NULL AND kind = 'photo'
        """
    )
    op.execute("DELETE FROM design_turn_attachments WHERE kind = 'photo'")
    op.execute(
        """
        DELETE FROM images
        WHERE id IN (SELECT image_id FROM removed_design_reference_image_ids)
          AND entity_type IN (
            'design_reference_upload',
            'design_reference',
            'design_reference_deleted'
          )
        """
    )

    op.drop_constraint(
        op.f("ck_design_turn_attachments_exactly_one_target"),
        "design_turn_attachments",
        type_="check",
    )
    op.drop_constraint(
        op.f("ck_design_turn_attachments_purpose"),
        "design_turn_attachments",
        type_="check",
    )
    op.drop_constraint(
        op.f("ck_design_turn_attachments_kind"),
        "design_turn_attachments",
        type_="check",
    )
    op.drop_constraint(
        op.f("fk_design_turn_attachments_image_id_images"),
        "design_turn_attachments",
        type_="foreignkey",
    )
    op.alter_column("design_turn_attachments", "motif_id", nullable=False)
    op.drop_column("design_turn_attachments", "purpose")
    op.drop_column("design_turn_attachments", "image_id")
    op.drop_column("design_turn_attachments", "kind")

    # Curated examples and candidates using removed Plan v3 variants cannot be parsed anymore.
    for table in ("authoring_promotion_candidates", "authoring_examples"):
        op.execute(
            f"""
            DELETE FROM {table}
            WHERE EXISTS (
              SELECT 1
              FROM jsonb_array_elements(COALESCE(plan->'motifs', '[]'::jsonb)) AS motif
              WHERE motif->>'source' IN ('generate', 'reference')
            )
            """
        )

    # Remove curated pointers before deleting legacy logs (design_examples.run_id is RESTRICT).
    op.execute(
        """
        DELETE FROM design_examples
        WHERE run_id IN (
          SELECT id
          FROM seamless_generation_logs
          WHERE input_type = 'reference_image'
             OR EXISTS (
               SELECT 1
               FROM jsonb_array_elements(
                 COALESCE(intent->'authoring'->'plan'->'motifs', '[]'::jsonb)
               ) AS motif
               WHERE motif->>'source' IN ('generate', 'reference')
             )
        )
        """
    )
    op.execute(
        """
        DELETE FROM seamless_generation_logs
        WHERE input_type = 'reference_image'
           OR EXISTS (
             SELECT 1
             FROM jsonb_array_elements(
               COALESCE(intent->'authoring'->'plan'->'motifs', '[]'::jsonb)
             ) AS motif
             WHERE motif->>'source' IN ('generate', 'reference')
           )
        """
    )
    op.drop_table("seamless_generation_attachments")
    op.drop_constraint(
        op.f("ck_seamless_generation_logs_input_type"),
        "seamless_generation_logs",
        type_="check",
    )
    op.create_check_constraint(
        op.f("ck_seamless_generation_logs_input_type"),
        "seamless_generation_logs",
        "input_type IN ('intent', 'prompt')",
    )
    op.drop_column("seamless_generation_logs", "reference_image_bytes")
    op.drop_column("seamless_generation_logs", "has_reference_image")


def downgrade() -> None:
    op.add_column(
        "seamless_generation_logs",
        sa.Column(
            "has_reference_image",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
    )
    op.add_column(
        "seamless_generation_logs",
        sa.Column("reference_image_bytes", sa.Integer(), nullable=True),
    )
    op.drop_constraint(
        op.f("ck_seamless_generation_logs_input_type"),
        "seamless_generation_logs",
        type_="check",
    )
    op.create_check_constraint(
        op.f("ck_seamless_generation_logs_input_type"),
        "seamless_generation_logs",
        "input_type IN ('intent', 'prompt', 'reference_image')",
    )
    op.create_table(
        "seamless_generation_attachments",
        sa.Column("id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("log_id", sa.Uuid(), nullable=False),
        sa.Column("image_id", sa.Uuid(), nullable=False),
        sa.Column("purpose", sa.Text(), server_default="auto", nullable=False),
        sa.Column("ordinal", sa.Integer(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "purpose IN ('auto', 'color_mood', 'motif', 'composition')",
            name=op.f("ck_seamless_generation_attachments_purpose"),
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

    op.add_column(
        "design_turn_attachments",
        sa.Column("kind", sa.Text(), server_default="svg", nullable=False),
    )
    op.add_column(
        "design_turn_attachments",
        sa.Column("image_id", sa.Uuid(), nullable=True),
    )
    op.add_column(
        "design_turn_attachments",
        sa.Column("purpose", sa.Text(), nullable=True),
    )
    op.alter_column("design_turn_attachments", "motif_id", nullable=True)
    op.create_foreign_key(
        op.f("fk_design_turn_attachments_image_id_images"),
        "design_turn_attachments",
        "images",
        ["image_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_check_constraint(
        op.f("ck_design_turn_attachments_kind"),
        "design_turn_attachments",
        "kind IN ('photo', 'svg')",
    )
    op.create_check_constraint(
        op.f("ck_design_turn_attachments_purpose"),
        "design_turn_attachments",
        "(kind = 'photo' AND purpose IS NOT NULL "
        "AND purpose IN ('auto', 'color_mood', 'motif', 'composition')) "
        "OR (kind = 'svg' AND purpose IS NULL)",
    )
    op.create_check_constraint(
        op.f("ck_design_turn_attachments_exactly_one_target"),
        "design_turn_attachments",
        "(image_id IS NOT NULL)::int + (motif_id IS NOT NULL)::int = 1",
    )
