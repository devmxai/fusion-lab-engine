-- Customer-visible Production offers are immutable snapshots of four facts:
-- selected provider model, official provider rate, FusionLab customer price,
-- and the active provider credential.  Pricing an already-selected model is
-- the explicit publish action in the simplified SaaS Admin workflow.

CREATE TABLE IF NOT EXISTS fusion_engine.production_offer_versions (
  offer_id text NOT NULL CHECK (length(offer_id) BETWEEN 8 AND 500),
  version integer NOT NULL CHECK (version > 0),
  provider_id text NOT NULL CHECK (provider_id IN ('kie', 'openrouter')),
  provider_account_id text NOT NULL REFERENCES fusion_engine.provider_accounts(id),
  credential_id uuid NOT NULL REFERENCES fusion_engine.provider_credentials(id),
  credential_version integer NOT NULL CHECK (credential_version > 0),
  reference_model_id text NOT NULL,
  provider_model_id text NOT NULL,
  rate_key text NOT NULL,
  provider_rate_version integer NOT NULL CHECK (provider_rate_version > 0),
  customer_price_version integer NOT NULL CHECK (customer_price_version > 0),
  customer_credits bigint NOT NULL CHECK (customer_credits > 0),
  provider_credit_micros bigint,
  provider_usd_picos bigint,
  display_name text NOT NULL,
  billing_unit text NOT NULL,
  variant jsonb NOT NULL,
  adapter_version text NOT NULL,
  evidence_sha256 char(64) NOT NULL CHECK (evidence_sha256 ~ '^[a-f0-9]{64}$'),
  published_by text NOT NULL,
  published_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (offer_id, version)
);

CREATE TABLE IF NOT EXISTS fusion_engine.production_offer_pointers (
  offer_id text PRIMARY KEY,
  current_version integer NOT NULL CHECK (current_version > 0),
  state text NOT NULL CHECK (state IN ('ACTIVE', 'INACTIVE')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (offer_id, current_version)
    REFERENCES fusion_engine.production_offer_versions(offer_id, version)
);

CREATE TABLE IF NOT EXISTS fusion_engine.production_asset_access_grants (
  token_hash char(64) PRIMARY KEY CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  asset_id uuid NOT NULL REFERENCES fusion_engine.operation_assets(id),
  owner_id text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  consumed_at timestamptz
);

DROP TRIGGER IF EXISTS production_offer_versions_immutable ON fusion_engine.production_offer_versions;
CREATE TRIGGER production_offer_versions_immutable BEFORE UPDATE OR DELETE ON fusion_engine.production_offer_versions
FOR EACH ROW EXECUTE FUNCTION fusion_engine.reject_immutable_mutation();

ALTER TABLE fusion_engine.production_offer_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE fusion_engine.production_offer_pointers ENABLE ROW LEVEL SECURITY;
ALTER TABLE fusion_engine.production_asset_access_grants ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE fusion_engine.production_offer_versions, fusion_engine.production_offer_pointers,
  fusion_engine.production_asset_access_grants FROM anon, authenticated;

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['production_offer_versions','production_offer_pointers','production_asset_access_grants'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS engine_runtime_access ON fusion_engine.%I', table_name);
    EXECUTE format('CREATE POLICY engine_runtime_access ON fusion_engine.%I FOR ALL TO PUBLIC USING (current_user = ''fusion_engine_runtime'') WITH CHECK (current_user = ''fusion_engine_runtime'')', table_name);
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fusion_engine_runtime') THEN
    GRANT SELECT, INSERT ON fusion_engine.production_offer_versions TO fusion_engine_runtime;
    GRANT SELECT, INSERT, UPDATE ON fusion_engine.production_offer_pointers,
      fusion_engine.production_asset_access_grants TO fusion_engine_runtime;
  END IF;
END
$$;

-- Existing configured prices become the first explicit Production release.
WITH candidates AS (
  SELECT
    'offer:' || rate.reference_model_id || ':' || rate.rate_key AS offer_id,
    rate.provider_id,
    account.id AS provider_account_id,
    credential.id AS credential_id,
    credential.version AS credential_version,
    rate.reference_model_id,
    rate.provider_model_id,
    rate.rate_key,
    rate.version AS provider_rate_version,
    price.version AS customer_price_version,
    price.customer_credits,
    rate.provider_credit_micros,
    rate.provider_usd_picos,
    rate.label AS display_name,
    rate.billing_unit,
    rate.variant,
    CASE WHEN rate.provider_id = 'kie' THEN 'kie-market.v1' ELSE 'openrouter-image.v1' END AS adapter_version,
    price.configured_by AS published_by
  FROM fusion_engine.provider_model_rate_pointers rate_pointer
  JOIN fusion_engine.provider_model_rate_versions rate
    ON rate.reference_model_id = rate_pointer.reference_model_id
   AND rate.rate_key = rate_pointer.rate_key AND rate.version = rate_pointer.current_version
  JOIN fusion_engine.platform_model_price_pointers price_pointer
    ON price_pointer.reference_model_id = rate.reference_model_id AND price_pointer.rate_key = rate.rate_key
  JOIN fusion_engine.platform_model_price_versions price
    ON price.reference_model_id = price_pointer.reference_model_id
   AND price.rate_key = price_pointer.rate_key AND price.version = price_pointer.current_version
  JOIN fusion_engine.provider_model_selections selection
    ON selection.reference_model_id = rate.reference_model_id AND selection.state = 'SELECTED'
  JOIN fusion_engine.provider_accounts account
    ON account.provider_id = rate.provider_id AND account.environment = 'PRODUCTION' AND account.state = 'CONNECTED'
  JOIN fusion_engine.provider_credentials credential
    ON credential.id = account.active_credential_id AND credential.status = 'ACTIVE'
)
INSERT INTO fusion_engine.production_offer_versions (
  offer_id, version, provider_id, provider_account_id, credential_id, credential_version,
  reference_model_id, provider_model_id, rate_key, provider_rate_version, customer_price_version,
  customer_credits, provider_credit_micros, provider_usd_picos, display_name, billing_unit,
  variant, adapter_version, evidence_sha256, published_by
)
SELECT offer_id, 1, provider_id, provider_account_id, credential_id, credential_version,
  reference_model_id, provider_model_id, rate_key, provider_rate_version, customer_price_version,
  customer_credits, provider_credit_micros, provider_usd_picos, display_name, billing_unit,
  variant, adapter_version,
  encode(extensions.digest(concat_ws('|', offer_id, provider_rate_version, customer_price_version,
    credential_id::text, customer_credits::text), 'sha256'), 'hex'), published_by
FROM candidates
ON CONFLICT (offer_id, version) DO NOTHING;

INSERT INTO fusion_engine.production_offer_pointers (offer_id, current_version, state)
SELECT offer_id, max(version), 'ACTIVE'
FROM fusion_engine.production_offer_versions
GROUP BY offer_id
ON CONFLICT (offer_id) DO UPDATE SET current_version = excluded.current_version, state = 'ACTIVE', updated_at = now();

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('generated-originals-private', 'generated-originals-private', false, 104857600,
  ARRAY['image/png','image/jpeg','video/mp4','audio/wav'])
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
