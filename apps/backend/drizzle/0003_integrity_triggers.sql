-- Invarianten aus Spezifikation 0, Abschnitt 8, die sich nicht als CHECK oder Fremdschlüssel ausdrücken
-- lassen. Nur Postgres ist autoritativ; die lokale SQLite-Datenbank ist eine Kopie der Serverzeilen.

-- `person.account_id` ist servergesetzt und unveränderlich.
CREATE TRIGGER person_account_immutable BEFORE UPDATE OF account_id ON person FOR EACH ROW
  WHEN (OLD.account_id IS DISTINCT FROM NEW.account_id) EXECUTE FUNCTION abnehm_reject_mutation();
--> statement-breakpoint
-- Der Inhalt eines Notification-Intents ist unveränderlich; nur der Zustellstatus ändert sich.
CREATE TRIGGER notification_intent_content_immutable BEFORE UPDATE ON notification_intent FOR EACH ROW
  WHEN ((OLD.intent_id, OLD.source_event_id, OLD.recipient_person_id, OLD.type, OLD.message_key, OLD.payload, OLD.created_at)
    IS DISTINCT FROM (NEW.intent_id, NEW.source_event_id, NEW.recipient_person_id, NEW.type, NEW.message_key, NEW.payload, NEW.created_at))
  EXECUTE FUNCTION abnehm_reject_mutation();
--> statement-breakpoint
-- Ein manueller Sporteintrag wird nur durch einen Import ersetzt (Spezifikation 3, Abschnitt 8); dieselbe
-- Person sichert der zusammengesetzte Fremdschlüssel `sport_entry_replaced_by_fk`.
CREATE FUNCTION abnehm_check_sport_replacement() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.replaced_by_entry_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM sport_entry WHERE id = NEW.replaced_by_entry_id AND origin <> 'manuell') THEN
    RAISE EXCEPTION 'Ein manueller Sporteintrag wird nur durch einen Import ersetzt'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'sport_entry_replaced_by_import_check';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER sport_entry_replaced_by_import_check BEFORE INSERT OR UPDATE OF replaced_by_entry_id ON sport_entry
  FOR EACH ROW EXECUTE FUNCTION abnehm_check_sport_replacement();
--> statement-breakpoint
-- Eine Kopplung hat genau zwei Mitglieder, und das sind die beiden Personen ihres Paars. Geprüft wird am
-- Ende der Transaktion, weil Kopplung und Mitglieder nacheinander entstehen. Zusammen mit
-- `coupling_member_active_person_uq` folgt daraus: höchstens eine aktive Kopplung je Person.
CREATE FUNCTION abnehm_check_coupling_members() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  targets uuid[];
  target uuid;
  pair uuid[];
  members uuid[];
BEGIN
  -- Getrennte Zweige: PL/pgSQL prüft Feldzugriffe auf NEW/OLD je Ausdruck gegen die auslösende Tabelle.
  IF TG_TABLE_NAME = 'coupling' THEN
    targets := ARRAY[NEW.id];
  ELSIF TG_OP = 'INSERT' THEN
    targets := ARRAY[NEW.coupling_id];
  ELSIF TG_OP = 'DELETE' THEN
    targets := ARRAY[OLD.coupling_id];
  ELSE
    targets := ARRAY[OLD.coupling_id, NEW.coupling_id];
  END IF;
  FOREACH target IN ARRAY targets
  LOOP
    SELECT ARRAY[person_low_id, person_high_id] INTO pair FROM coupling WHERE id = target;
    CONTINUE WHEN pair IS NULL;
    SELECT array_agg(person_id ORDER BY person_id) INTO members FROM coupling_member WHERE coupling_id = target;
    IF members IS DISTINCT FROM pair THEN
      RAISE EXCEPTION 'Kopplung % braucht genau die beiden Personen ihres Paars als Mitglieder', target
        USING ERRCODE = 'check_violation', CONSTRAINT = 'coupling_members_check';
    END IF;
  END LOOP;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER coupling_members_check AFTER INSERT OR UPDATE ON coupling
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION abnehm_check_coupling_members();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER coupling_member_members_check AFTER INSERT OR UPDATE OR DELETE ON coupling_member
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION abnehm_check_coupling_members();
