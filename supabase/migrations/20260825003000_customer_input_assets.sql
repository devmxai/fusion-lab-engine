-- Customer source media is intentionally separate from provider-delivered
-- operation assets. It has its own owner/project binding and lifecycle so a
-- browser upload can never masquerade as a settled provider delivery.
CREATE TABLE IF NOT EXISTS fusion_engine.customer_input_assets (
  id uuid PRIMARY KEY,
  owner_id text NOT NULL,
  project_id text NOT NULL,
  bucket text NOT NULL DEFAULT 'customer-inputs-private',
  object_key text NOT NULL UNIQUE,
  original_filename text NOT NULL,
  content_type text NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp')),
  byte_length bigint NOT NULL CHECK (byte_length > 0 AND byte_length <= 10485760),
  checksum_sha256 char(64) NOT NULL CHECK (checksum_sha256 ~ '^[a-f0-9]{64}$'),
  state text NOT NULL CHECK (state IN ('PENDING_UPLOAD', 'READY', 'FAILED', 'EXPIRED')),
  upload_expires_at timestamptz NOT NULL,
  finalized_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS customer_input_assets_owner_project_ready_idx
  ON fusion_engine.customer_input_assets(owner_id, project_id, state, created_at DESC);

ALTER TABLE fusion_engine.customer_input_assets ENABLE ROW LEVEL SECURITY;

-- The Production gateway connects through the isolated runtime role.  Keep
-- the schema private from browser roles, but explicitly allow the server to
-- create, verify and read customer-owned input assets.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fusion_engine_runtime') THEN
    GRANT SELECT, INSERT, UPDATE ON fusion_engine.customer_input_assets TO fusion_engine_runtime;
  END IF;
END
$$;

DROP POLICY IF EXISTS engine_runtime_access ON fusion_engine.customer_input_assets;
CREATE POLICY engine_runtime_access
  ON fusion_engine.customer_input_assets
  FOR ALL
  TO fusion_engine_runtime
  USING (true)
  WITH CHECK (true);

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('customer-inputs-private', 'customer-inputs-private', false, 10485760, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;
