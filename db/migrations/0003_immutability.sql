-- Brief versions and activations are immutable.
SET search_path = strata, public;

CREATE TRIGGER brief_version_no_update BEFORE UPDATE OR DELETE ON monitoring_brief_version
  FOR EACH ROW EXECUTE FUNCTION reject_change();
CREATE TRIGGER brief_version_no_truncate BEFORE TRUNCATE ON monitoring_brief_version
  FOR EACH STATEMENT EXECUTE FUNCTION reject_change();
CREATE TRIGGER brief_activation_no_update BEFORE UPDATE OR DELETE ON brief_activation
  FOR EACH ROW EXECUTE FUNCTION reject_change();
CREATE TRIGGER brief_activation_no_truncate BEFORE TRUNCATE ON brief_activation
  FOR EACH STATEMENT EXECUTE FUNCTION reject_change();
