-- One-time subscription activation keys. Plaintext keys never enter PostgreSQL.

CREATE TABLE IF NOT EXISTS fusion_engine.subscription_activation_keys (
  id uuid PRIMARY KEY,
  key_hash char(64) NOT NULL UNIQUE CHECK (key_hash ~ '^[a-f0-9]{64}$'),
  key_hint text NOT NULL CHECK (length(key_hint) BETWEEN 8 AND 40),
  plan_version_id text NOT NULL REFERENCES fusion_engine.subscription_plan_versions(id),
  state text NOT NULL CHECK (state IN ('ISSUED', 'REDEEMED', 'REVOKED')),
  expires_at timestamptz NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  redeemed_by text,
  redeemed_at timestamptz,
  subscription_id uuid REFERENCES fusion_engine.subscriptions(id),
  revoked_by text,
  revoked_at timestamptz,
  CHECK (expires_at > created_at),
  CHECK (
    (state='ISSUED' AND redeemed_by IS NULL AND redeemed_at IS NULL AND subscription_id IS NULL AND revoked_by IS NULL AND revoked_at IS NULL)
    OR (state='REDEEMED' AND redeemed_by IS NOT NULL AND redeemed_at IS NOT NULL AND subscription_id IS NOT NULL AND revoked_by IS NULL AND revoked_at IS NULL)
    OR (state='REVOKED' AND redeemed_by IS NULL AND redeemed_at IS NULL AND subscription_id IS NULL AND revoked_by IS NOT NULL AND revoked_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS subscription_activation_keys_state_expiry_idx
ON fusion_engine.subscription_activation_keys(state,expires_at);

CREATE TABLE IF NOT EXISTS fusion_engine.subscription_activation_admin_commands (
  command_id text PRIMARY KEY CHECK (length(command_id) BETWEEN 8 AND 200),
  actor_id text NOT NULL,
  action text NOT NULL CHECK (action IN ('GENERATE_ACTIVATION_KEY', 'REVOKE_ACTIVATION_KEY')),
  key_id uuid NOT NULL REFERENCES fusion_engine.subscription_activation_keys(id),
  request_hash char(64) NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS subscription_activation_admin_commands_immutable ON fusion_engine.subscription_activation_admin_commands;
CREATE TRIGGER subscription_activation_admin_commands_immutable
BEFORE UPDATE OR DELETE ON fusion_engine.subscription_activation_admin_commands
FOR EACH ROW EXECUTE FUNCTION fusion_engine.reject_immutable_mutation();

CREATE TABLE IF NOT EXISTS fusion_engine.subscription_activation_redemptions (
  command_id text PRIMARY KEY CHECK (length(command_id) BETWEEN 8 AND 200),
  owner_id text NOT NULL,
  key_id uuid NOT NULL REFERENCES fusion_engine.subscription_activation_keys(id),
  request_hash char(64) NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  subscription_id uuid NOT NULL REFERENCES fusion_engine.subscriptions(id),
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS subscription_activation_redemptions_immutable ON fusion_engine.subscription_activation_redemptions;
CREATE TRIGGER subscription_activation_redemptions_immutable
BEFORE UPDATE OR DELETE ON fusion_engine.subscription_activation_redemptions
FOR EACH ROW EXECUTE FUNCTION fusion_engine.reject_immutable_mutation();

CREATE TABLE IF NOT EXISTS fusion_engine.subscription_activation_audit (
  sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  action text NOT NULL CHECK (action IN ('ISSUED', 'REDEEMED', 'REVOKED')),
  actor_id text NOT NULL,
  key_id uuid NOT NULL REFERENCES fusion_engine.subscription_activation_keys(id),
  plan_version_id text NOT NULL REFERENCES fusion_engine.subscription_plan_versions(id),
  owner_id text,
  subscription_id uuid REFERENCES fusion_engine.subscriptions(id),
  evidence_hash char(64) NOT NULL CHECK (evidence_hash ~ '^[a-f0-9]{64}$'),
  occurred_at timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS subscription_activation_audit_immutable ON fusion_engine.subscription_activation_audit;
CREATE TRIGGER subscription_activation_audit_immutable
BEFORE UPDATE OR DELETE ON fusion_engine.subscription_activation_audit
FOR EACH ROW EXECUTE FUNCTION fusion_engine.reject_immutable_mutation();

ALTER TABLE fusion_engine.subscription_activation_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE fusion_engine.subscription_activation_admin_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE fusion_engine.subscription_activation_redemptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE fusion_engine.subscription_activation_audit ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON fusion_engine.subscription_activation_keys FROM anon,authenticated;
REVOKE ALL ON fusion_engine.subscription_activation_admin_commands FROM anon,authenticated;
REVOKE ALL ON fusion_engine.subscription_activation_redemptions FROM anon,authenticated;
REVOKE ALL ON fusion_engine.subscription_activation_audit FROM anon,authenticated;
