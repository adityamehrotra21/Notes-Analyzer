-- pgvector must exist before any vector(N) column or HNSW index is created.
CREATE EXTENSION IF NOT EXISTS vector;
