"""Add AI job usage tracking fields and monthly quota index."""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "b2c3d4e5f6a7"
down_revision: Union[str, Sequence[str], None] = "a1b2c3d4e5f6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("ai_jobs", sa.Column("job_type", sa.String(), nullable=False, server_default="chapter"))
    op.add_column("ai_jobs", sa.Column("action", sa.String(), nullable=True))
    op.add_column("ai_jobs", sa.Column("model", sa.String(), nullable=True))
    op.add_column("ai_jobs", sa.Column("input_tokens", sa.Integer(), nullable=False, server_default="0"))
    op.add_column("ai_jobs", sa.Column("output_tokens", sa.Integer(), nullable=False, server_default="0"))
    op.create_index("ix_ai_jobs_user_created", "ai_jobs", ["user_id", "created_at"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_ai_jobs_user_created", table_name="ai_jobs")
    op.drop_column("ai_jobs", "output_tokens")
    op.drop_column("ai_jobs", "input_tokens")
    op.drop_column("ai_jobs", "model")
    op.drop_column("ai_jobs", "action")
    op.drop_column("ai_jobs", "job_type")
