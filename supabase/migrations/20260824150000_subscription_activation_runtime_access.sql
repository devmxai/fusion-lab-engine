-- The Vercel gateway connects as the dedicated runtime role. Keep browser
-- roles denied while allowing that server-only role to administer and redeem
-- one-time subscription activation keys.

DROP POLICY IF EXISTS engine_runtime_access ON fusion_engine.subscription_activation_keys;
DROP POLICY IF EXISTS engine_runtime_access ON fusion_engine.subscription_activation_admin_commands;
DROP POLICY IF EXISTS engine_runtime_access ON fusion_engine.subscription_activation_redemptions;
DROP POLICY IF EXISTS engine_runtime_access ON fusion_engine.subscription_activation_audit;

CREATE POLICY engine_runtime_access ON fusion_engine.subscription_activation_keys
FOR ALL TO PUBLIC
USING (current_user = 'fusion_engine_runtime')
WITH CHECK (current_user = 'fusion_engine_runtime');

CREATE POLICY engine_runtime_access ON fusion_engine.subscription_activation_admin_commands
FOR ALL TO PUBLIC
USING (current_user = 'fusion_engine_runtime')
WITH CHECK (current_user = 'fusion_engine_runtime');

CREATE POLICY engine_runtime_access ON fusion_engine.subscription_activation_redemptions
FOR ALL TO PUBLIC
USING (current_user = 'fusion_engine_runtime')
WITH CHECK (current_user = 'fusion_engine_runtime');

CREATE POLICY engine_runtime_access ON fusion_engine.subscription_activation_audit
FOR ALL TO PUBLIC
USING (current_user = 'fusion_engine_runtime')
WITH CHECK (current_user = 'fusion_engine_runtime');

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fusion_engine_runtime') THEN
    GRANT SELECT, INSERT, UPDATE ON fusion_engine.subscription_activation_keys TO fusion_engine_runtime;
    GRANT SELECT, INSERT ON fusion_engine.subscription_activation_admin_commands TO fusion_engine_runtime;
    GRANT SELECT, INSERT ON fusion_engine.subscription_activation_redemptions TO fusion_engine_runtime;
    GRANT SELECT, INSERT ON fusion_engine.subscription_activation_audit TO fusion_engine_runtime;
    GRANT USAGE, SELECT ON SEQUENCE fusion_engine.subscription_activation_audit_sequence_seq TO fusion_engine_runtime;
  END IF;
END
$$;

