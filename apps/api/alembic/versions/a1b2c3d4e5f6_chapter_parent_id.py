"""Alembic migration: chapter parent_id for part hierarchy."""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "a1b2c3d4e5f6"
down_revision: Union[str, Sequence[str], None] = "f15f16964e07"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("chapters", sa.Column("parent_id", sa.String(), nullable=True))
    op.create_index(op.f("ix_chapters_parent_id"), "chapters", ["parent_id"], unique=False)
    op.create_foreign_key(
        "fk_chapters_parent_id",
        "chapters",
        "chapters",
        ["parent_id"],
        ["id"],
    )


def downgrade() -> None:
    op.drop_constraint("fk_chapters_parent_id", "chapters", type_="foreignkey")
    op.drop_index(op.f("ix_chapters_parent_id"), table_name="chapters")
    op.drop_column("chapters", "parent_id")
