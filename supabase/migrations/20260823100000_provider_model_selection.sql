-- Provider model selection is an Admin staging decision only. It never makes
-- a model customer-visible and never creates a runnable provider route.

CREATE TABLE IF NOT EXISTS fusion_engine.provider_model_selections (
  reference_model_id text PRIMARY KEY CHECK (length(reference_model_id) BETWEEN 1 AND 200),
  provider_id text NOT NULL CHECK (provider_id IN ('kie', 'openrouter')),
  catalog_snapshot_id text NOT NULL CHECK (length(catalog_snapshot_id) BETWEEN 1 AND 200),
  state text NOT NULL CHECK (state IN ('SELECTED', 'UNSELECTED')),
  version integer NOT NULL CHECK (version > 0),
  selected_by text,
  selected_at timestamptz,
  unselected_by text,
  unselected_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS fusion_engine.provider_model_selection_commands (
  command_id text PRIMARY KEY CHECK (length(command_id) BETWEEN 8 AND 200),
  actor_id text NOT NULL,
  action text NOT NULL CHECK (action IN ('SELECT', 'UNSELECT')),
  request_hash char(64) NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  reference_model_id text NOT NULL,
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS fusion_engine.provider_model_selection_audit (
  sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  command_id text NOT NULL UNIQUE REFERENCES fusion_engine.provider_model_selection_commands(command_id),
  actor_id text NOT NULL,
  action text NOT NULL,
  reference_model_id text NOT NULL,
  before_state text,
  after_state text NOT NULL CHECK (after_state IN ('SELECTED', 'UNSELECTED')),
  evidence_hash char(64) NOT NULL CHECK (evidence_hash ~ '^[a-f0-9]{64}$'),
  occurred_at timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS provider_model_selection_commands_immutable ON fusion_engine.provider_model_selection_commands;
CREATE TRIGGER provider_model_selection_commands_immutable
BEFORE UPDATE OR DELETE ON fusion_engine.provider_model_selection_commands
FOR EACH ROW EXECUTE FUNCTION fusion_engine.reject_immutable_mutation();

DROP TRIGGER IF EXISTS provider_model_selection_audit_immutable ON fusion_engine.provider_model_selection_audit;
CREATE TRIGGER provider_model_selection_audit_immutable
BEFORE UPDATE OR DELETE ON fusion_engine.provider_model_selection_audit
FOR EACH ROW EXECUTE FUNCTION fusion_engine.reject_immutable_mutation();

ALTER TABLE fusion_engine.provider_model_selections ENABLE ROW LEVEL SECURITY;
ALTER TABLE fusion_engine.provider_model_selection_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE fusion_engine.provider_model_selection_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS engine_runtime_access ON fusion_engine.provider_model_selections;
CREATE POLICY engine_runtime_access ON fusion_engine.provider_model_selections
FOR ALL TO PUBLIC USING (current_user = 'fusion_engine_runtime') WITH CHECK (current_user = 'fusion_engine_runtime');
DROP POLICY IF EXISTS engine_runtime_access ON fusion_engine.provider_model_selection_commands;
CREATE POLICY engine_runtime_access ON fusion_engine.provider_model_selection_commands
FOR ALL TO PUBLIC USING (current_user = 'fusion_engine_runtime') WITH CHECK (current_user = 'fusion_engine_runtime');
DROP POLICY IF EXISTS engine_runtime_access ON fusion_engine.provider_model_selection_audit;
CREATE POLICY engine_runtime_access ON fusion_engine.provider_model_selection_audit
FOR ALL TO PUBLIC USING (current_user = 'fusion_engine_runtime') WITH CHECK (current_user = 'fusion_engine_runtime');

REVOKE ALL ON TABLE fusion_engine.provider_model_selections FROM anon, authenticated;
REVOKE ALL ON TABLE fusion_engine.provider_model_selection_commands FROM anon, authenticated;
REVOKE ALL ON TABLE fusion_engine.provider_model_selection_audit FROM anon, authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fusion_engine_runtime') THEN
    GRANT SELECT, INSERT, UPDATE ON fusion_engine.provider_model_selections TO fusion_engine_runtime;
    GRANT SELECT, INSERT ON fusion_engine.provider_model_selection_commands TO fusion_engine_runtime;
    GRANT SELECT, INSERT ON fusion_engine.provider_model_selection_audit TO fusion_engine_runtime;
    GRANT USAGE, SELECT ON SEQUENCE fusion_engine.provider_model_selection_audit_sequence_seq TO fusion_engine_runtime;
  END IF;
END
$$;
