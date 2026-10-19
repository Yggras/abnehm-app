CREATE TABLE "online_request" (
	"request_id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"flow" text NOT NULL,
	"request_hash" text NOT NULL,
	"result" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "online_request_flow_check" CHECK ("online_request"."flow" in ('einladung_erzeugen', 'einladung_annehmen'))
);
--> statement-breakpoint
ALTER TABLE "online_request" ADD CONSTRAINT "online_request_account_id_user_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;