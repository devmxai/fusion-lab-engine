-- FusionLab Production provider credentials.
-- Secret bytes live only in Supabase Vault. Browser-facing tables contain
-- immutable/redacted metadata and verification evidence only.

CREATE TABLE IF NOT EXISTS fusion_engine.provider_accounts (
  id text PRIMARY KEY CHECK (length(id) BETWEEN 3 AND 200),
  provider_id text NOT NULL CHECK (provider_id IN ('kie', 'openrouter')),
  display_name text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 200),
  environment text NOT NULL CHECK (environment IN ('PRODUCTION')),
  state text NOT NULL CHECK (state IN ('DISCONNECTED', 'PENDING_VERIFICATION', 'CONNECTED', 'DEGRADED', 'SUSPENDED', 'REVOKED')),
  active_credential_id uuid,
  last_verified_at timestamptz,
  verification_evidence jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider_id, environment)
);

CREATE TABLE IF NOT EXISTS fusion_engine.provider_credentials (
  id uuid PRIMARY KEY,
  provider_id text NOT NULL CHECK (provider_id IN ('kie', 'openrouter')),
  account_id text NOT NULL REFERENCES fusion_engine.provider_accounts(id),
  environment text NOT NULL CHECK (environment IN ('PRODUCTION')),
  purpose text NOT NULL CHECK (purpose IN ('PROVIDER_GENERATION_KEY', 'PROVIDER_WEBHOOK_HMAC', 'PROVIDER_MANAGEMENT_KEY')),
  vault_secret_id uuid NOT NULL UNIQUE,
  fingerprint char(16) NOT NULL CHECK (fingerprint ~ '^[a-f0-9]{16}$'),
  version integer NOT NULL CHECK (version > 0),
  status text NOT NULL CHECK (status IN ('PENDING_TEST', 'TESTED', 'ACTIVE', 'REVOKED')),
  created_by text NOT NULL,
  tested_by text,
  activated_by text,
  revoked_by text,
  verification_evidence jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  tested_at timestamptz,
  activated_at timestamptz,
  revoked_at timestamptz,
  UNIQUE (provider_id, account_id, environment, purpose, version)
);

ALTER TABLE fusion_engine.provider_accounts
  DROP CONSTRAINT IF EXISTS provider_accounts_active_credential_fk;
ALTER TABLE fusion_engine.provider_accounts
  ADD CONSTRAINT provider_accounts_active_credential_fk
  FOREIGN KEY (active_credential_id) REFERENCES fusion_engine.provider_credentials(id)
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE IF NOT EXISTS fusion_engine.provider_credential_commands (
  command_id text PRIMARY KEY CHECK (length(command_id) BETWEEN 8 AND 200),
  actor_id text NOT NULL,
  action text NOT NULL CHECK (action IN ('WRITE', 'TEST', 'ACTIVATE', 'REVOKE')),
  request_hash char(64) NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  credential_id uuid NOT NULL REFERENCES fusion_engine.provider_credentials(id),
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS fusion_engine.provider_credential_audit (
  sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  command_id text NOT NULL UNIQUE REFERENCES fusion_engine.provider_credential_commands(command_id),
  actor_id text NOT NULL,
  action text NOT NULL,
  credential_id uuid NOT NULL REFERENCES fusion_engine.provider_credentials(id),
  before_status text,
  after_status text NOT NULL,
  evidence_hash char(64) NOT NULL CHECK (evidence_hash ~ '^[a-f0-9]{64}$'),
  occurred_at timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS provider_credential_commands_immutable ON fusion_engine.provider_credential_commands;
CREATE TRIGGER provider_credential_commands_immutable
BEFORE UPDATE OR DELETE ON fusion_engine.provider_credential_commands
FOR EACH ROW EXECUTE FUNCTION fusion_engine.reject_immutable_mutation();

DROP TRIGGER IF EXISTS provider_credential_audit_immutable ON fusion_engine.provider_credential_audit;
CREATE TRIGGER provider_credential_audit_immutable
BEFORE UPDATE OR DELETE ON fusion_engine.provider_credential_audit
FOR EACH ROW EXECUTE FUNCTION fusion_engine.reject_immutable_mutation();

ALTER TABLE fusion_engine.provider_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE fusion_engine.provider_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE fusion_engine.provider_credential_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE fusion_engine.provider_credential_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS engine_runtime_access ON fusion_engine.provider_accounts;
CREATE POLICY engine_runtime_access ON fusion_engine.provider_accounts
FOR ALL TO PUBLIC USING (current_user = 'fusion_engine_runtime') WITH CHECK (current_user = 'fusion_engine_runtime');

DROP POLICY IF EXISTS engine_runtime_access ON fusion_engine.provider_credentials;
CREATE POLICY engine_runtime_access ON fusion_engine.provider_credentials
FOR ALL TO PUBLIC USING (current_user = 'fusion_engine_runtime') WITH CHECK (current_user = 'fusion_engine_runtime');

DROP POLICY IF EXISTS engine_runtime_access ON fusion_engine.provider_credential_commands;
CREATE POLICY engine_runtime_access ON fusion_engine.provider_credential_commands
FOR ALL TO PUBLIC USING (current_user = 'fusion_engine_runtime') WITH CHECK (current_user = 'fusion_engine_runtime');

DROP POLICY IF EXISTS engine_runtime_access ON fusion_engine.provider_credential_audit;
CREATE POLICY engine_runtime_access ON fusion_engine.provider_credential_audit
FOR ALL TO PUBLIC USING (current_user = 'fusion_engine_runtime') WITH CHECK (current_user = 'fusion_engine_runtime');

CREATE OR REPLACE FUNCTION fusion_engine.store_provider_secret(
  secret_value text,
  secret_name text,
  secret_description text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  secret_id uuid;
BEGIN
  IF length(secret_value) < 12 OR length(secret_value) > 16384 THEN
    RAISE EXCEPTION 'provider_secret_length_out_of_range';
  END IF;
  SELECT vault.create_secret(secret_value, secret_name, secret_description) INTO secret_id;
  RETURN secret_id;
END;
$$;

CREATE OR REPLACE FUNCTION fusion_engine.lease_provider_secret(p_credential_id uuid)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT secret.decrypted_secret
  FROM fusion_engine.provider_credentials AS credential
  JOIN vault.decrypted_secrets AS secret ON secret.id = credential.vault_secret_id
  WHERE credential.id = p_credential_id
    AND credential.status <> 'REVOKED'
$$;

CREATE OR REPLACE FUNCTION fusion_engine.destroy_provider_secret(p_credential_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  target_secret_id uuid;
BEGIN
  SELECT vault_secret_id INTO target_secret_id
  FROM fusion_engine.provider_credentials
  WHERE id = p_credential_id;
  IF target_secret_id IS NOT NULL THEN
    DELETE FROM vault.secrets WHERE id = target_secret_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION fusion_engine.store_provider_secret(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION fusion_engine.lease_provider_secret(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION fusion_engine.destroy_provider_secret(uuid) FROM PUBLIC;

REVOKE ALL ON TABLE fusion_engine.provider_accounts FROM anon, authenticated;
REVOKE ALL ON TABLE fusion_engine.provider_credentials FROM anon, authenticated;
REVOKE ALL ON TABLE fusion_engine.provider_credential_commands FROM anon, authenticated;
REVOKE ALL ON TABLE fusion_engine.provider_credential_audit FROM anon, authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fusion_engine_runtime') THEN
    GRANT SELECT, INSERT, UPDATE ON fusion_engine.provider_accounts TO fusion_engine_runtime;
    GRANT SELECT, INSERT, UPDATE ON fusion_engine.provider_credentials TO fusion_engine_runtime;
    GRANT SELECT, INSERT ON fusion_engine.provider_credential_commands TO fusion_engine_runtime;
    GRANT SELECT, INSERT ON fusion_engine.provider_credential_audit TO fusion_engine_runtime;
    GRANT USAGE, SELECT ON SEQUENCE fusion_engine.provider_credential_audit_sequence_seq TO fusion_engine_runtime;
    GRANT EXECUTE ON FUNCTION fusion_engine.store_provider_secret(text, text, text) TO fusion_engine_runtime;
    GRANT EXECUTE ON FUNCTION fusion_engine.lease_provider_secret(uuid) TO fusion_engine_runtime;
    GRANT EXECUTE ON FUNCTION fusion_engine.destroy_provider_secret(uuid) TO fusion_engine_runtime;
  END IF;
END
$$;
