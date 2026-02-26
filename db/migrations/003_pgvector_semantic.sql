CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE embeddings
  ADD COLUMN IF NOT EXISTS embedding vector;

UPDATE embeddings e
SET embedding = (
  (
    '[' ||
    (
      SELECT string_agg(value, ',')
      FROM jsonb_array_elements_text(e.vector_json) AS x(value)
    ) ||
    ']'
  )::vector
)
WHERE e.embedding IS NULL
  AND jsonb_typeof(e.vector_json) = 'array'
  AND jsonb_array_length(e.vector_json) = e.dims;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_embeddings_dims_positive'
  ) THEN
    ALTER TABLE embeddings
      ADD CONSTRAINT chk_embeddings_dims_positive
      CHECK (dims > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_embeddings_json_dims'
  ) THEN
    ALTER TABLE embeddings
      ADD CONSTRAINT chk_embeddings_json_dims
      CHECK (
        jsonb_typeof(vector_json) = 'array'
        AND jsonb_array_length(vector_json) = dims
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_embeddings_vector_dims'
  ) THEN
    ALTER TABLE embeddings
      ADD CONSTRAINT chk_embeddings_vector_dims
      CHECK (embedding IS NULL OR vector_dims(embedding) = dims);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_embeddings_model_dims
  ON embeddings (model, dims);

DO $$
DECLARE
  dim_count INTEGER;
  dim_value INTEGER;
BEGIN
  SELECT COUNT(DISTINCT dims), MIN(dims)
  INTO dim_count, dim_value
  FROM embeddings
  WHERE dims IS NOT NULL;

  IF dim_count = 1 AND dim_value IS NOT NULL THEN
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS idx_embeddings_embedding_hnsw_cosine
       ON embeddings
       USING hnsw ((embedding::vector(%s)) vector_cosine_ops)
       WHERE embedding IS NOT NULL AND dims = %s',
      dim_value,
      dim_value
    );
  END IF;
END $$;
