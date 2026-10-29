"""初始结构：14 张表（对应《项目开发文档》1.4）。

Revision ID: 0001_init
Revises:
Create Date: 2026-10-28

说明：结构直接由 `app.models.Base.metadata` 驱动，保证模型与迁移永不漂移；
后续变更请新增 revision，不要修改本文件。
"""

from __future__ import annotations

from alembic import op

from app.models import Base

revision = "0001_init"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    # pgvector 扩展必须先于 embeddings 表创建
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")
    Base.metadata.create_all(bind=bind)
    # 全文检索索引（关键词搜索）：转写稿与摘要内容
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_transcript_fts ON transcript_segments "
        "USING gin (to_tsvector('simple', content))"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_summaries_fts ON summaries "
        "USING gin (to_tsvector('simple', content::text))"
    )
    # 向量检索索引（HNSW，余弦距离）
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_embeddings_hnsw ON embeddings "
        "USING hnsw (embedding vector_cosine_ops)"
    )


def downgrade() -> None:
    bind = op.get_bind()
    Base.metadata.drop_all(bind=bind)
