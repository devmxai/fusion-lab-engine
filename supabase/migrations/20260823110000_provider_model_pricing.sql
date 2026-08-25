-- Versioned provider cost evidence and FusionLab customer pricing.
-- Provider rates are imported from public provider sources. Customer prices
-- are independent Admin decisions and never overwrite provider evidence.

CREATE TABLE IF NOT EXISTS fusion_engine.provider_pricing_snapshots (
  id uuid PRIMARY KEY,
  provider_id text NOT NULL CHECK (provider_id IN ('kie', 'openrouter')),
  source_url text NOT NULL CHECK (source_url ~ '^https://'),
  observed_at timestamptz NOT NULL,
  payload_sha256 char(64) NOT NULL CHECK (payload_sha256 ~ '^[a-f0-9]{64}$'),
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS fusion_engine.provider_model_rate_versions (
  reference_model_id text NOT NULL CHECK (length(reference_model_id) BETWEEN 1 AND 200),
  rate_key text NOT NULL CHECK (length(rate_key) BETWEEN 1 AND 160),
  version integer NOT NULL CHECK (version > 0),
  provider_id text NOT NULL CHECK (provider_id IN ('kie', 'openrouter')),
  provider_model_id text NOT NULL CHECK (length(provider_model_id) BETWEEN 1 AND 300),
  label text NOT NULL CHECK (length(label) BETWEEN 1 AND 500),
  billing_unit text NOT NULL CHECK (length(billing_unit) BETWEEN 1 AND 100),
  provider_credit_micros bigint CHECK (provider_credit_micros IS NULL OR provider_credit_micros >= 0),
  provider_usd_picos bigint CHECK (provider_usd_picos IS NULL OR provider_usd_picos >= 0),
  variant jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_url text NOT NULL CHECK (source_url ~ '^https://'),
  snapshot_id uuid NOT NULL REFERENCES fusion_engine.provider_pricing_snapshots(id),
  effective_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (reference_model_id, rate_key, version),
  CHECK (provider_credit_micros IS NOT NULL OR provider_usd_picos IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS fusion_engine.provider_model_rate_pointers (
  reference_model_id text NOT NULL,
  rate_key text NOT NULL,
  current_version integer NOT NULL CHECK (current_version > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (reference_model_id, rate_key),
  FOREIGN KEY (reference_model_id, rate_key, current_version)
    REFERENCES fusion_engine.provider_model_rate_versions(reference_model_id, rate_key, version)
);

CREATE TABLE IF NOT EXISTS fusion_engine.platform_model_price_versions (
  reference_model_id text NOT NULL,
  rate_key text NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  provider_rate_version integer NOT NULL CHECK (provider_rate_version > 0),
  customer_credits bigint NOT NULL CHECK (customer_credits > 0 AND customer_credits <= 1000000000),
  configured_by text NOT NULL,
  reason_code text NOT NULL DEFAULT 'ADMIN_PRICE_CONFIGURATION' CHECK (length(reason_code) BETWEEN 3 AND 100),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (reference_model_id, rate_key, version),
  FOREIGN KEY (reference_model_id, rate_key, provider_rate_version)
    REFERENCES fusion_engine.provider_model_rate_versions(reference_model_id, rate_key, version)
);

CREATE TABLE IF NOT EXISTS fusion_engine.platform_model_price_pointers (
  reference_model_id text NOT NULL,
  rate_key text NOT NULL,
  current_version integer NOT NULL CHECK (current_version > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (reference_model_id, rate_key),
  FOREIGN KEY (reference_model_id, rate_key, current_version)
    REFERENCES fusion_engine.platform_model_price_versions(reference_model_id, rate_key, version)
);

CREATE TABLE IF NOT EXISTS fusion_engine.provider_pricing_commands (
  command_id text PRIMARY KEY CHECK (length(command_id) BETWEEN 8 AND 200),
  actor_id text NOT NULL,
  action text NOT NULL CHECK (action IN ('SYNC_PROVIDER_RATES', 'CONFIGURE_CUSTOMER_PRICE')),
  request_hash char(64) NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS fusion_engine.provider_pricing_audit (
  sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  command_id text NOT NULL UNIQUE REFERENCES fusion_engine.provider_pricing_commands(command_id),
  actor_id text NOT NULL,
  action text NOT NULL,
  resource_id text NOT NULL,
  before_version integer,
  after_version integer NOT NULL CHECK (after_version > 0),
  evidence_hash char(64) NOT NULL CHECK (evidence_hash ~ '^[a-f0-9]{64}$'),
  occurred_at timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS provider_pricing_snapshots_immutable ON fusion_engine.provider_pricing_snapshots;
CREATE TRIGGER provider_pricing_snapshots_immutable BEFORE UPDATE OR DELETE ON fusion_engine.provider_pricing_snapshots
FOR EACH ROW EXECUTE FUNCTION fusion_engine.reject_immutable_mutation();
DROP TRIGGER IF EXISTS provider_model_rate_versions_immutable ON fusion_engine.provider_model_rate_versions;
CREATE TRIGGER provider_model_rate_versions_immutable BEFORE UPDATE OR DELETE ON fusion_engine.provider_model_rate_versions
FOR EACH ROW EXECUTE FUNCTION fusion_engine.reject_immutable_mutation();
DROP TRIGGER IF EXISTS platform_model_price_versions_immutable ON fusion_engine.platform_model_price_versions;
CREATE TRIGGER platform_model_price_versions_immutable BEFORE UPDATE OR DELETE ON fusion_engine.platform_model_price_versions
FOR EACH ROW EXECUTE FUNCTION fusion_engine.reject_immutable_mutation();
DROP TRIGGER IF EXISTS provider_pricing_commands_immutable ON fusion_engine.provider_pricing_commands;
CREATE TRIGGER provider_pricing_commands_immutable BEFORE UPDATE OR DELETE ON fusion_engine.provider_pricing_commands
FOR EACH ROW EXECUTE FUNCTION fusion_engine.reject_immutable_mutation();
DROP TRIGGER IF EXISTS provider_pricing_audit_immutable ON fusion_engine.provider_pricing_audit;
CREATE TRIGGER provider_pricing_audit_immutable BEFORE UPDATE OR DELETE ON fusion_engine.provider_pricing_audit
FOR EACH ROW EXECUTE FUNCTION fusion_engine.reject_immutable_mutation();

CREATE INDEX IF NOT EXISTS provider_model_rates_provider_idx ON fusion_engine.provider_model_rate_versions(provider_id, provider_model_id);

ALTER TABLE fusion_engine.provider_pricing_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE fusion_engine.provider_model_rate_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE fusion_engine.provider_model_rate_pointers ENABLE ROW LEVEL SECURITY;
ALTER TABLE fusion_engine.platform_model_price_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE fusion_engine.platform_model_price_pointers ENABLE ROW LEVEL SECURITY;
ALTER TABLE fusion_engine.provider_pricing_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE fusion_engine.provider_pricing_audit ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE fusion_engine.provider_pricing_snapshots FROM anon, authenticated;
REVOKE ALL ON TABLE fusion_engine.provider_model_rate_versions FROM anon, authenticated;
REVOKE ALL ON TABLE fusion_engine.provider_model_rate_pointers FROM anon, authenticated;
REVOKE ALL ON TABLE fusion_engine.platform_model_price_versions FROM anon, authenticated;
REVOKE ALL ON TABLE fusion_engine.platform_model_price_pointers FROM anon, authenticated;
REVOKE ALL ON TABLE fusion_engine.provider_pricing_commands FROM anon, authenticated;
REVOKE ALL ON TABLE fusion_engine.provider_pricing_audit FROM anon, authenticated;

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'provider_pricing_snapshots','provider_model_rate_versions','provider_model_rate_pointers',
    'platform_model_price_versions','platform_model_price_pointers','provider_pricing_commands','provider_pricing_audit'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS engine_runtime_access ON fusion_engine.%I', table_name);
    EXECUTE format('CREATE POLICY engine_runtime_access ON fusion_engine.%I FOR ALL TO PUBLIC USING (current_user = ''fusion_engine_runtime'') WITH CHECK (current_user = ''fusion_engine_runtime'')', table_name);
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fusion_engine_runtime') THEN
    GRANT SELECT, INSERT ON fusion_engine.provider_pricing_snapshots, fusion_engine.provider_model_rate_versions,
      fusion_engine.platform_model_price_versions, fusion_engine.provider_pricing_commands, fusion_engine.provider_pricing_audit TO fusion_engine_runtime;
    GRANT SELECT, INSERT, UPDATE ON fusion_engine.provider_model_rate_pointers, fusion_engine.platform_model_price_pointers TO fusion_engine_runtime;
    GRANT USAGE, SELECT ON SEQUENCE fusion_engine.provider_pricing_audit_sequence_seq TO fusion_engine_runtime;
  END IF;
END
$$;
