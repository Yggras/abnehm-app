ALTER TABLE "processed_operation" ADD COLUMN "entity_type" text;--> statement-breakpoint
ALTER TABLE "processed_operation" ADD COLUMN "entity_id" uuid;--> statement-breakpoint
ALTER TABLE "processed_operation" ADD CONSTRAINT "processed_operation_entity_check" CHECK (("processed_operation"."entity_type" is null) = ("processed_operation"."entity_id" is null));