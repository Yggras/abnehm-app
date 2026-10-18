CREATE TABLE "account" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"account_id" uuid NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"account_id" uuid NOT NULL,
	CONSTRAINT "session_token_uq" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean NOT NULL,
	"image" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "user_email_uq" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
-- Konto- und Sitzungs-IDs sind jetzt Better-Auth-UUIDs. `text` lässt sich nur ausdrücklich in `uuid`
-- umwandeln, und eine Spalte im WHEN eines Triggers nicht ändern; der Trigger aus 0003 kommt danach
-- unverändert zurück.
DROP TRIGGER person_account_immutable ON person;--> statement-breakpoint
ALTER TABLE "person" ALTER COLUMN "account_id" SET DATA TYPE uuid USING "account_id"::uuid;--> statement-breakpoint
CREATE TRIGGER person_account_immutable BEFORE UPDATE OF account_id ON person FOR EACH ROW
  WHEN (OLD.account_id IS DISTINCT FROM NEW.account_id) EXECUTE FUNCTION abnehm_reject_mutation();--> statement-breakpoint
ALTER TABLE "push_installation" ALTER COLUMN "session_id" SET DATA TYPE uuid USING "session_id"::uuid;--> statement-breakpoint
ALTER TABLE "security_log" ALTER COLUMN "account_id" SET DATA TYPE uuid USING "account_id"::uuid;--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_account_id_user_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_account_id_user_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_account_idx" ON "account" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "session_account_idx" ON "session" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");--> statement-breakpoint
ALTER TABLE "person" ADD CONSTRAINT "person_account_id_user_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "security_log_occurred_at_idx" ON "security_log" USING btree ("occurred_at");--> statement-breakpoint
ALTER TABLE "security_log" ADD CONSTRAINT "security_log_event_type_check" CHECK ("security_log"."event_type" in ('anmeldung', 'anmeldung_fehlgeschlagen', 'abmeldung', 'sitzungswiderruf', 'passwortaenderung', 'passwort_reset', 'kopplung', 'entkopplung', 'freigabeaenderung', 'fotozugriff_verweigert', 'administrativer_zugriff'));