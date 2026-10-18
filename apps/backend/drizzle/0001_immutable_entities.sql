-- Unveränderliche Entitäten (Spezifikation 0, Abschnitt 8): kein Update, kein Delete. Der Server
-- vergibt `server_version` schon beim Anlegen, deshalb gibt es auch dafür kein Update. Fremdschlüssel
-- auf diese Tabellen verwenden zusätzlich `ON DELETE RESTRICT` (Migration 0000).
CREATE FUNCTION abnehm_reject_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Unveränderliche Entität: % auf % ist nicht erlaubt', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER daily_goal_immutable BEFORE UPDATE OR DELETE ON daily_goal FOR EACH ROW EXECUTE FUNCTION abnehm_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER daily_goal_completion_immutable BEFORE UPDATE OR DELETE ON daily_goal_completion FOR EACH ROW EXECUTE FUNCTION abnehm_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER energy_booking_immutable BEFORE UPDATE OR DELETE ON energy_booking FOR EACH ROW EXECUTE FUNCTION abnehm_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER project_contribution_immutable BEFORE UPDATE OR DELETE ON project_contribution FOR EACH ROW EXECUTE FUNCTION abnehm_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER blueprint_unlock_immutable BEFORE UPDATE OR DELETE ON blueprint_unlock FOR EACH ROW EXECUTE FUNCTION abnehm_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER area_unlock_immutable BEFORE UPDATE OR DELETE ON area_unlock FOR EACH ROW EXECUTE FUNCTION abnehm_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER island_field_immutable BEFORE UPDATE OR DELETE ON island_field FOR EACH ROW EXECUTE FUNCTION abnehm_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER momo_accessory_immutable BEFORE UPDATE OR DELETE ON momo_accessory FOR EACH ROW EXECUTE FUNCTION abnehm_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER revocation_notice_immutable BEFORE UPDATE OR DELETE ON revocation_notice FOR EACH ROW EXECUTE FUNCTION abnehm_reject_mutation();
