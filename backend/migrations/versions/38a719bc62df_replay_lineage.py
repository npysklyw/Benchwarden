"""Replay lineage and historical configuration snapshots."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "38a719bc62df"
down_revision: str | None = "2c2af13af5e5"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "evaluation_runs",
        sa.Column("configuration_snapshot", postgresql.JSONB(none_as_null=True), nullable=True),
    )
    op.add_column("case_results", sa.Column("replay_of", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        "fk_case_results_replay_of_case_results",
        "case_results",
        "case_results",
        ["replay_of"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.create_index("ix_case_results_replay_of", "case_results", ["replay_of"])


def downgrade() -> None:
    op.drop_index("ix_case_results_replay_of", table_name="case_results")
    op.drop_constraint("fk_case_results_replay_of_case_results", "case_results", type_="foreignkey")
    op.drop_column("case_results", "replay_of")
    op.drop_column("evaluation_runs", "configuration_snapshot")
