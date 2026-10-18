CREATE TABLE "coupling" (
	"id" uuid PRIMARY KEY NOT NULL,
	"person_low_id" uuid NOT NULL,
	"person_high_id" uuid NOT NULL,
	"status" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"reactivated_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	"server_version" bigint NOT NULL,
	CONSTRAINT "coupling_pair_uq" UNIQUE("person_low_id","person_high_id"),
	CONSTRAINT "coupling_id_status_uq" UNIQUE("id","status"),
	CONSTRAINT "coupling_status_check" CHECK ("coupling"."status" in ('aktiv', 'archiviert')),
	CONSTRAINT "coupling_pair_order_check" CHECK ("coupling"."person_low_id" < "coupling"."person_high_id"),
	CONSTRAINT "coupling_ended_check" CHECK (("coupling"."status" = 'archiviert') = ("coupling"."ended_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "coupling_member" (
	"id" uuid PRIMARY KEY NOT NULL,
	"coupling_id" uuid NOT NULL,
	"coupling_status" text NOT NULL,
	"person_id" uuid NOT NULL,
	"role" text,
	"display_name" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	"server_version" bigint NOT NULL,
	CONSTRAINT "coupling_member_person_uq" UNIQUE("coupling_id","person_id"),
	CONSTRAINT "coupling_member_role_check" CHECK ("coupling_member"."role" in ('bauen', 'natur'))
);
--> statement-breakpoint
CREATE TABLE "invitation" (
	"id" uuid PRIMARY KEY NOT NULL,
	"inviter_person_id" uuid NOT NULL,
	"code_hmac" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"consumed_by_person_id" uuid,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "invitation_consumed_check" CHECK (("invitation"."consumed_at" is null) = ("invitation"."consumed_by_person_id" is null))
);
--> statement-breakpoint
CREATE TABLE "partner_sharing" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_person_id" uuid NOT NULL,
	"coupling_id" uuid NOT NULL,
	"area" text NOT NULL,
	"level" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	"server_version" bigint NOT NULL,
	CONSTRAINT "partner_sharing_area_uq" UNIQUE("owner_person_id","coupling_id","area"),
	CONSTRAINT "partner_sharing_area_check" CHECK ("partner_sharing"."area" in ('ernaehrung', 'wasser', 'sport', 'gewicht')),
	CONSTRAINT "partner_sharing_level_check" CHECK ("partner_sharing"."level" in ('privat', 'zusammengefasst'))
);
--> statement-breakpoint
CREATE TABLE "person" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"display_name" text NOT NULL,
	"calculation_sex" text,
	"birth_date" date,
	"height_cm" smallint,
	"activity_level" text,
	"pregnant_or_breastfeeding" boolean,
	"known_eating_disorder" boolean,
	"disclaimer_accepted_at" timestamp with time zone,
	"onboarding_status" text NOT NULL,
	"onboarding_completed_at" timestamp with time zone,
	"goal_weight_reached_g" integer,
	"goal_weight_reached_at" timestamp with time zone,
	"time_zone" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	"server_version" bigint NOT NULL,
	CONSTRAINT "person_account_uq" UNIQUE("account_id"),
	CONSTRAINT "person_calculation_sex_check" CHECK ("person"."calculation_sex" in ('maennlich', 'weiblich')),
	CONSTRAINT "person_activity_level_check" CHECK ("person"."activity_level" in ('wenig_aktiv', 'maessig_aktiv', 'aktiv')),
	CONSTRAINT "person_height_check" CHECK ("person"."height_cm" between 120 and 230),
	CONSTRAINT "person_onboarding_status_check" CHECK ("person"."onboarding_status" in ('begonnen', 'abgeschlossen')),
	CONSTRAINT "person_onboarding_completed_check" CHECK (("person"."onboarding_status" = 'abgeschlossen') = ("person"."onboarding_completed_at" is not null)),
	CONSTRAINT "person_onboarding_fields_check" CHECK ("person"."onboarding_status" = 'begonnen' or ("person"."calculation_sex" is not null and "person"."birth_date" is not null and "person"."height_cm" is not null and "person"."activity_level" is not null and "person"."pregnant_or_breastfeeding" is not null and "person"."known_eating_disorder" is not null and "person"."disclaimer_accepted_at" is not null)),
	CONSTRAINT "person_goal_weight_reached_check" CHECK (("person"."goal_weight_reached_g" is null) = ("person"."goal_weight_reached_at" is null))
);
--> statement-breakpoint
CREATE TABLE "photo_sharing" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_person_id" uuid NOT NULL,
	"coupling_id" uuid NOT NULL,
	"level" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	"server_version" bigint NOT NULL,
	CONSTRAINT "photo_sharing_owner_uq" UNIQUE("owner_person_id","coupling_id"),
	CONSTRAINT "photo_sharing_level_check" CHECK ("photo_sharing"."level" in ('privat', 'geteilt'))
);
--> statement-breakpoint
CREATE TABLE "shared_action" (
	"id" uuid PRIMARY KEY NOT NULL,
	"coupling_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"requester_person_id" uuid NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text NOT NULL,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	"server_version" bigint NOT NULL,
	CONSTRAINT "shared_action_kind_check" CHECK ("shared_action"."kind" in ('rollenwahl', 'rollentausch', 'entkoppeln', 'deko_schenken')),
	CONSTRAINT "shared_action_status_check" CHECK ("shared_action"."status" in ('offen', 'angenommen', 'abgelehnt', 'zurueckgezogen')),
	CONSTRAINT "shared_action_decided_check" CHECK (("shared_action"."status" = 'offen') = ("shared_action"."decided_at" is null))
);
--> statement-breakpoint
CREATE TABLE "budget_suggestion" (
	"id" uuid PRIMARY KEY NOT NULL,
	"person_id" uuid NOT NULL,
	"period_from" date NOT NULL,
	"period_to" date NOT NULL,
	"previous_budget_milli_kcal" integer NOT NULL,
	"suggested_budget_milli_kcal" integer NOT NULL,
	"direction" text NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	"server_version" bigint NOT NULL,
	CONSTRAINT "budget_suggestion_period_uq" UNIQUE("person_id","period_to"),
	CONSTRAINT "budget_suggestion_direction_check" CHECK ("budget_suggestion"."direction" in ('senken', 'anheben')),
	CONSTRAINT "budget_suggestion_status_check" CHECK ("budget_suggestion"."status" in ('offen', 'angenommen', 'abgelehnt', 'ueberholt')),
	CONSTRAINT "budget_suggestion_amount_check" CHECK ("budget_suggestion"."suggested_budget_milli_kcal" > 0 and ("budget_suggestion"."direction" = 'senken') = ("budget_suggestion"."suggested_budget_milli_kcal" < "budget_suggestion"."previous_budget_milli_kcal") and "budget_suggestion"."suggested_budget_milli_kcal" <> "budget_suggestion"."previous_budget_milli_kcal"),
	CONSTRAINT "budget_suggestion_period_check" CHECK ("budget_suggestion"."period_from" <= "budget_suggestion"."period_to")
);
--> statement-breakpoint
CREATE TABLE "daily_goal" (
	"id" uuid PRIMARY KEY NOT NULL,
	"person_id" uuid NOT NULL,
	"local_date" date NOT NULL,
	"time_zone" text NOT NULL,
	"utc_offset_minutes" smallint NOT NULL,
	"slot" smallint NOT NULL,
	"baustein" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"day_ends_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"server_version" bigint NOT NULL,
	CONSTRAINT "daily_goal_slot_uq" UNIQUE("person_id","local_date","slot"),
	CONSTRAINT "daily_goal_baustein_uq" UNIQUE("person_id","local_date","baustein"),
	CONSTRAINT "daily_goal_identity_uq" UNIQUE("id","person_id","local_date","slot","baustein"),
	CONSTRAINT "daily_goal_slot_check" CHECK ("daily_goal"."slot" between 1 and 3),
	CONSTRAINT "daily_goal_baustein_check" CHECK ("daily_goal"."baustein" in ('ernaehrung_erfasst', 'im_kalorienbudget', 'wasserziel', 'sporteinheit', 'gewogen'))
);
--> statement-breakpoint
CREATE TABLE "daily_goal_completion" (
	"id" uuid PRIMARY KEY NOT NULL,
	"daily_goal_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"local_date" date NOT NULL,
	"slot" smallint NOT NULL,
	"baustein" text NOT NULL,
	"first_completed_at" timestamp with time zone NOT NULL,
	"completion_key" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"server_version" bigint NOT NULL,
	CONSTRAINT "daily_goal_completion_goal_uq" UNIQUE("daily_goal_id"),
	CONSTRAINT "daily_goal_completion_key_uq" UNIQUE("completion_key")
);
--> statement-breakpoint
CREATE TABLE "goal_version" (
	"id" uuid PRIMARY KEY NOT NULL,
	"person_id" uuid NOT NULL,
	"valid_from" date NOT NULL,
	"calorie_budget_milli_kcal" integer NOT NULL,
	"basal_metabolic_rate_milli_kcal" integer NOT NULL,
	"total_energy_expenditure_milli_kcal" integer NOT NULL,
	"lower_bound_milli_kcal" integer NOT NULL,
	"deficit_milli_kcal" integer,
	"budget_source" text NOT NULL,
	"calculation_sex" text NOT NULL,
	"age_years" smallint NOT NULL,
	"height_cm" smallint NOT NULL,
	"weight_g" integer NOT NULL,
	"activity_level" text NOT NULL,
	"maintenance_reason" text,
	"pace" text,
	"goal_weight_g" integer NOT NULL,
	"water_target_ml" integer NOT NULL,
	"weekly_sport_target_minutes" integer NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	"server_version" bigint NOT NULL,
	CONSTRAINT "goal_version_valid_from_uq" UNIQUE("person_id","valid_from"),
	CONSTRAINT "goal_version_budget_source_check" CHECK ("goal_version"."budget_source" in ('berechnet', 'manuell', 'budgetvorschlag')),
	CONSTRAINT "goal_version_calculation_sex_check" CHECK ("goal_version"."calculation_sex" in ('maennlich', 'weiblich')),
	CONSTRAINT "goal_version_activity_level_check" CHECK ("goal_version"."activity_level" in ('wenig_aktiv', 'maessig_aktiv', 'aktiv')),
	CONSTRAINT "goal_version_maintenance_reason_check" CHECK ("goal_version"."maintenance_reason" in ('sicherheits_check', 'gewaehlt')),
	CONSTRAINT "goal_version_pace_check" CHECK ("goal_version"."pace" in ('entspannt', 'zuegiger')),
	CONSTRAINT "goal_version_maintenance_check" CHECK (("goal_version"."maintenance_reason" is null) = ("goal_version"."pace" is not null)),
	CONSTRAINT "goal_version_deficit_check" CHECK (("goal_version"."deficit_milli_kcal" is null) = ("goal_version"."pace" is null)),
	CONSTRAINT "goal_version_energy_check" CHECK ("goal_version"."lower_bound_milli_kcal" > 0 and "goal_version"."calorie_budget_milli_kcal" >= "goal_version"."lower_bound_milli_kcal" and "goal_version"."basal_metabolic_rate_milli_kcal" > 0 and "goal_version"."total_energy_expenditure_milli_kcal" > 0),
	CONSTRAINT "goal_version_targets_check" CHECK ("goal_version"."goal_weight_g" > 0 and "goal_version"."weight_g" > 0 and "goal_version"."water_target_ml" > 0 and "goal_version"."weekly_sport_target_minutes" > 0)
);
--> statement-breakpoint
CREATE TABLE "weekly_plan_day" (
	"weekly_plan_version_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"weekday" text NOT NULL,
	"baustein_1" text NOT NULL,
	"baustein_2" text NOT NULL,
	"baustein_3" text NOT NULL,
	CONSTRAINT "weekly_plan_day_pk" PRIMARY KEY("weekly_plan_version_id","weekday"),
	CONSTRAINT "weekly_plan_day_weekday_check" CHECK ("weekly_plan_day"."weekday" in ('montag', 'dienstag', 'mittwoch', 'donnerstag', 'freitag', 'samstag', 'sonntag')),
	CONSTRAINT "weekly_plan_day_bausteine_check" CHECK ("weekly_plan_day"."baustein_1" in ('ernaehrung_erfasst', 'im_kalorienbudget', 'wasserziel', 'sporteinheit', 'gewogen') and "weekly_plan_day"."baustein_2" in ('ernaehrung_erfasst', 'im_kalorienbudget', 'wasserziel', 'sporteinheit', 'gewogen') and "weekly_plan_day"."baustein_3" in ('ernaehrung_erfasst', 'im_kalorienbudget', 'wasserziel', 'sporteinheit', 'gewogen') and "weekly_plan_day"."baustein_1" <> "weekly_plan_day"."baustein_2" and "weekly_plan_day"."baustein_1" <> "weekly_plan_day"."baustein_3" and "weekly_plan_day"."baustein_2" <> "weekly_plan_day"."baustein_3")
);
--> statement-breakpoint
CREATE TABLE "weekly_plan_version" (
	"id" uuid PRIMARY KEY NOT NULL,
	"person_id" uuid NOT NULL,
	"valid_from" date NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	"server_version" bigint NOT NULL,
	CONSTRAINT "weekly_plan_version_valid_from_uq" UNIQUE("person_id","valid_from"),
	CONSTRAINT "weekly_plan_version_owner_uq" UNIQUE("id","person_id")
);
--> statement-breakpoint
CREATE TABLE "food_favorite" (
	"id" uuid PRIMARY KEY NOT NULL,
	"person_id" uuid NOT NULL,
	"food_ref_type" text NOT NULL,
	"food_ref_key" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	"server_version" bigint NOT NULL,
	CONSTRAINT "food_favorite_ref_uq" UNIQUE("person_id","food_ref_type","food_ref_key"),
	CONSTRAINT "food_favorite_ref_type_check" CHECK ("food_favorite"."food_ref_type" in ('bls', 'off', 'eigen'))
);
--> statement-breakpoint
CREATE TABLE "meal_favorite" (
	"id" uuid PRIMARY KEY NOT NULL,
	"person_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	"server_version" bigint NOT NULL,
	CONSTRAINT "meal_favorite_owner_uq" UNIQUE("id","person_id")
);
--> statement-breakpoint
CREATE TABLE "meal_favorite_item" (
	"meal_favorite_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"food_ref_type" text NOT NULL,
	"food_ref_key" text NOT NULL,
	"base_amount" integer NOT NULL,
	"display_unit" text NOT NULL,
	"display_amount_milli" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	CONSTRAINT "meal_favorite_item_pk" PRIMARY KEY("meal_favorite_id","position"),
	CONSTRAINT "meal_favorite_item_ref_type_check" CHECK ("meal_favorite_item"."food_ref_type" in ('bls', 'off', 'eigen')),
	CONSTRAINT "meal_favorite_item_display_unit_check" CHECK ("meal_favorite_item"."display_unit" in ('g', 'ml', 'stueck', 'portion')),
	CONSTRAINT "meal_favorite_item_amount_check" CHECK ("meal_favorite_item"."position" >= 0 and "meal_favorite_item"."base_amount" > 0 and "meal_favorite_item"."display_amount_milli" > 0)
);
--> statement-breakpoint
CREATE TABLE "meal_photo" (
	"id" uuid PRIMARY KEY NOT NULL,
	"person_id" uuid NOT NULL,
	"image_key" text NOT NULL,
	"captured_at" timestamp with time zone NOT NULL,
	"shared_with_partner" boolean NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	"server_version" bigint NOT NULL,
	CONSTRAINT "meal_photo_owner_uq" UNIQUE("id","person_id")
);
--> statement-breakpoint
CREATE TABLE "nutrition_entry" (
	"id" uuid PRIMARY KEY NOT NULL,
	"person_id" uuid NOT NULL,
	"consumed_at" timestamp with time zone NOT NULL,
	"local_date" date NOT NULL,
	"time_zone" text NOT NULL,
	"utc_offset_minutes" smallint NOT NULL,
	"meal" text NOT NULL,
	"capture_method" text NOT NULL,
	"food_ref_type" text,
	"food_ref_key" text,
	"base_amount" integer NOT NULL,
	"display_unit" text NOT NULL,
	"display_amount_milli" integer NOT NULL,
	"snapshot_name" text NOT NULL,
	"snapshot_base_unit" text NOT NULL,
	"snapshot_reference_amount" integer NOT NULL,
	"snapshot_milli_kcal" integer NOT NULL,
	"snapshot_protein_mg" integer NOT NULL,
	"snapshot_carbs_mg" integer NOT NULL,
	"snapshot_fat_mg" integer NOT NULL,
	"snapshot_portions" jsonb NOT NULL,
	"snapshot_source" text NOT NULL,
	"snapshot_attribution" text,
	"total_milli_kcal" integer NOT NULL,
	"total_protein_mg" integer NOT NULL,
	"total_carbs_mg" integer NOT NULL,
	"total_fat_mg" integer NOT NULL,
	"meal_photo_id" uuid,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	"server_version" bigint NOT NULL,
	CONSTRAINT "nutrition_entry_meal_check" CHECK ("nutrition_entry"."meal" in ('fruehstueck', 'mittagessen', 'abendessen', 'snacks')),
	CONSTRAINT "nutrition_entry_capture_method_check" CHECK ("nutrition_entry"."capture_method" in ('suche', 'barcode', 'foto', 'lebensmittelfavorit', 'mahlzeitenfavorit', 'zuletzt', 'eigenes_lebensmittel')),
	CONSTRAINT "nutrition_entry_display_unit_check" CHECK ("nutrition_entry"."display_unit" in ('g', 'ml', 'stueck', 'portion')),
	CONSTRAINT "nutrition_entry_base_unit_check" CHECK ("nutrition_entry"."snapshot_base_unit" in ('g', 'ml')),
	CONSTRAINT "nutrition_entry_source_check" CHECK ("nutrition_entry"."snapshot_source" in ('bls', 'off', 'eigen', 'ki')),
	CONSTRAINT "nutrition_entry_ref_check" CHECK (("nutrition_entry"."food_ref_type" is null) = ("nutrition_entry"."food_ref_key" is null) and ("nutrition_entry"."food_ref_type" is null) = ("nutrition_entry"."snapshot_source" = 'ki') and ("nutrition_entry"."food_ref_type" is null or "nutrition_entry"."food_ref_type" = "nutrition_entry"."snapshot_source")),
	CONSTRAINT "nutrition_entry_ai_capture_check" CHECK ("nutrition_entry"."snapshot_source" <> 'ki' or "nutrition_entry"."capture_method" = 'foto'),
	CONSTRAINT "nutrition_entry_amount_check" CHECK ("nutrition_entry"."base_amount" > 0 and "nutrition_entry"."base_amount" <= (case "nutrition_entry"."snapshot_base_unit" when 'g' then 5000000 else 5000 end) and "nutrition_entry"."display_amount_milli" > 0),
	CONSTRAINT "nutrition_entry_values_check" CHECK ("nutrition_entry"."snapshot_reference_amount" > 0 and "nutrition_entry"."snapshot_milli_kcal" >= 0 and "nutrition_entry"."snapshot_protein_mg" >= 0 and "nutrition_entry"."snapshot_carbs_mg" >= 0 and "nutrition_entry"."snapshot_fat_mg" >= 0 and "nutrition_entry"."total_milli_kcal" >= 0 and "nutrition_entry"."total_protein_mg" >= 0 and "nutrition_entry"."total_carbs_mg" >= 0 and "nutrition_entry"."total_fat_mg" >= 0),
	CONSTRAINT "nutrition_entry_macros_check" CHECK ("nutrition_entry"."snapshot_base_unit" <> 'g' or "nutrition_entry"."snapshot_protein_mg" + "nutrition_entry"."snapshot_carbs_mg" + "nutrition_entry"."snapshot_fat_mg" <= "nutrition_entry"."snapshot_reference_amount")
);
--> statement-breakpoint
CREATE TABLE "own_food" (
	"id" uuid PRIMARY KEY NOT NULL,
	"person_id" uuid NOT NULL,
	"name" text NOT NULL,
	"base_unit" text NOT NULL,
	"reference_amount" integer NOT NULL,
	"milli_kcal" integer NOT NULL,
	"protein_mg" integer NOT NULL,
	"carbs_mg" integer NOT NULL,
	"fat_mg" integer NOT NULL,
	"portions" jsonb NOT NULL,
	"origin_type" text,
	"origin_key" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	"server_version" bigint NOT NULL,
	CONSTRAINT "own_food_base_unit_check" CHECK ("own_food"."base_unit" in ('g', 'ml')),
	CONSTRAINT "own_food_origin_type_check" CHECK ("own_food"."origin_type" in ('bls', 'off')),
	CONSTRAINT "own_food_origin_check" CHECK (("own_food"."origin_type" is null) = ("own_food"."origin_key" is null)),
	CONSTRAINT "own_food_values_check" CHECK ("own_food"."reference_amount" > 0 and "own_food"."milli_kcal" >= 0 and "own_food"."protein_mg" >= 0 and "own_food"."carbs_mg" >= 0 and "own_food"."fat_mg" >= 0),
	CONSTRAINT "own_food_macros_check" CHECK ("own_food"."base_unit" <> 'g' or "own_food"."protein_mg" + "own_food"."carbs_mg" + "own_food"."fat_mg" <= "own_food"."reference_amount")
);
--> statement-breakpoint
CREATE TABLE "photo_draft" (
	"id" uuid PRIMARY KEY NOT NULL,
	"person_id" uuid NOT NULL,
	"image_key" text NOT NULL,
	"analysis_state" text NOT NULL,
	"components" jsonb,
	"error_code" text,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "photo_draft_analysis_state_check" CHECK ("photo_draft"."analysis_state" in ('analysiert', 'fehlgeschlagen')),
	CONSTRAINT "photo_draft_result_check" CHECK (("photo_draft"."analysis_state" = 'analysiert') = ("photo_draft"."components" is not null) and ("photo_draft"."analysis_state" = 'fehlgeschlagen') = ("photo_draft"."error_code" is not null))
);
--> statement-breakpoint
CREATE TABLE "sport_entry" (
	"id" uuid PRIMARY KEY NOT NULL,
	"person_id" uuid NOT NULL,
	"activity_type" text NOT NULL,
	"override_activity_type" text,
	"started_at" timestamp with time zone NOT NULL,
	"duration_minutes" integer NOT NULL,
	"active_milli_kcal" integer,
	"origin" text NOT NULL,
	"external_key" text,
	"source_app_id" text,
	"source_app_name" text,
	"hidden_at" timestamp with time zone,
	"replaced_by_entry_id" uuid,
	"reactivated_at" timestamp with time zone,
	"local_date" date NOT NULL,
	"time_zone" text NOT NULL,
	"utc_offset_minutes" smallint NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	"server_version" bigint NOT NULL,
	CONSTRAINT "sport_entry_owner_uq" UNIQUE("id","person_id"),
	CONSTRAINT "sport_entry_external_uq" UNIQUE("person_id","origin","external_key"),
	CONSTRAINT "sport_entry_activity_type_check" CHECK ("sport_entry"."activity_type" in ('gehen', 'laufen', 'radfahren', 'schwimmen', 'krafttraining', 'yoga_dehnen', 'mannschaftssport', 'sonstiges')),
	CONSTRAINT "sport_entry_override_activity_type_check" CHECK ("sport_entry"."override_activity_type" in ('gehen', 'laufen', 'radfahren', 'schwimmen', 'krafttraining', 'yoga_dehnen', 'mannschaftssport', 'sonstiges')),
	CONSTRAINT "sport_entry_duration_check" CHECK ("sport_entry"."duration_minutes" between 1 and 1440),
	CONSTRAINT "sport_entry_active_energy_check" CHECK ("sport_entry"."active_milli_kcal" >= 0),
	CONSTRAINT "sport_entry_origin_check" CHECK ("sport_entry"."origin" in ('manuell', 'apple_health', 'health_connect')),
	CONSTRAINT "sport_entry_origin_fields_check" CHECK (("sport_entry"."origin" = 'manuell' and "sport_entry"."external_key" is null and "sport_entry"."source_app_id" is null and "sport_entry"."source_app_name" is null and "sport_entry"."hidden_at" is null) or ("sport_entry"."origin" <> 'manuell' and "sport_entry"."external_key" is not null and "sport_entry"."replaced_by_entry_id" is null and "sport_entry"."reactivated_at" is null))
);
--> statement-breakpoint
CREATE TABLE "water_entry" (
	"id" uuid PRIMARY KEY NOT NULL,
	"person_id" uuid NOT NULL,
	"amount_ml" integer NOT NULL,
	"origin" text NOT NULL,
	"logged_at" timestamp with time zone NOT NULL,
	"local_date" date NOT NULL,
	"time_zone" text NOT NULL,
	"utc_offset_minutes" smallint NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	"server_version" bigint NOT NULL,
	CONSTRAINT "water_entry_amount_check" CHECK ("water_entry"."amount_ml" between 1 and 3000),
	CONSTRAINT "water_entry_origin_check" CHECK ("water_entry"."origin" in ('manuell'))
);
--> statement-breakpoint
CREATE TABLE "weight_entry" (
	"id" uuid PRIMARY KEY NOT NULL,
	"person_id" uuid NOT NULL,
	"weight_g" integer NOT NULL,
	"measured_at" timestamp with time zone NOT NULL,
	"origin" text NOT NULL,
	"external_key" text,
	"source_app_id" text,
	"source_app_name" text,
	"hidden_at" timestamp with time zone,
	"local_date" date NOT NULL,
	"time_zone" text NOT NULL,
	"utc_offset_minutes" smallint NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	"server_version" bigint NOT NULL,
	CONSTRAINT "weight_entry_external_uq" UNIQUE("person_id","origin","external_key"),
	CONSTRAINT "weight_entry_weight_check" CHECK ("weight_entry"."weight_g" between 20000 and 350000),
	CONSTRAINT "weight_entry_origin_check" CHECK ("weight_entry"."origin" in ('manuell', 'apple_health', 'health_connect')),
	CONSTRAINT "weight_entry_origin_fields_check" CHECK (("weight_entry"."origin" = 'manuell' and "weight_entry"."external_key" is null and "weight_entry"."source_app_id" is null and "weight_entry"."source_app_name" is null and "weight_entry"."hidden_at" is null) or ("weight_entry"."origin" <> 'manuell' and "weight_entry"."external_key" is not null))
);
--> statement-breakpoint
CREATE TABLE "area_unlock" (
	"id" uuid PRIMARY KEY NOT NULL,
	"island_id" uuid NOT NULL,
	"coupling_id" uuid NOT NULL,
	"area_key" text NOT NULL,
	"level" smallint NOT NULL,
	"unlocked_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"server_version" bigint NOT NULL,
	CONSTRAINT "area_unlock_key_uq" UNIQUE("island_id","area_key"),
	CONSTRAINT "area_unlock_level_check" CHECK ("area_unlock"."level" >= 4)
);
--> statement-breakpoint
CREATE TABLE "blueprint_unlock" (
	"id" uuid PRIMARY KEY NOT NULL,
	"island_id" uuid NOT NULL,
	"coupling_id" uuid NOT NULL,
	"catalog_key" text NOT NULL,
	"reason" text NOT NULL,
	"unlocked_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"server_version" bigint NOT NULL,
	CONSTRAINT "blueprint_unlock_key_uq" UNIQUE("island_id","catalog_key"),
	CONSTRAINT "blueprint_unlock_reason_check" CHECK ("blueprint_unlock"."reason" in ('start', 'level', 'entdeckung', 'besucher'))
);
--> statement-breakpoint
CREATE TABLE "challenge" (
	"id" uuid PRIMARY KEY NOT NULL,
	"coupling_id" uuid NOT NULL,
	"template_key" text NOT NULL,
	"proposer_person_id" uuid NOT NULL,
	"status" text NOT NULL,
	"proposed_at" timestamp with time zone NOT NULL,
	"proposal_expires_at" timestamp with time zone NOT NULL,
	"started_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"common_stage" text,
	"challenge_deco_key" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	"server_version" bigint NOT NULL,
	CONSTRAINT "challenge_owner_uq" UNIQUE("id","coupling_id"),
	CONSTRAINT "challenge_status_check" CHECK ("challenge"."status" in ('vorgeschlagen', 'aktiv', 'geschafft', 'abgelaufen', 'beendet', 'abgelehnt', 'zurueckgezogen', 'verfallen')),
	CONSTRAINT "challenge_common_stage_check" CHECK ("challenge"."common_stage" in ('gestartet', 'gut_unterwegs', 'fast_geschafft', 'geschafft')),
	CONSTRAINT "challenge_started_check" CHECK (("challenge"."started_at" is not null) = ("challenge"."status" in ('aktiv', 'geschafft', 'abgelaufen', 'beendet')) and ("challenge"."started_at" is null) = ("challenge"."ends_at" is null)),
	CONSTRAINT "challenge_ended_check" CHECK (("challenge"."ended_at" is not null) = ("challenge"."status" not in ('vorgeschlagen', 'aktiv')))
);
--> statement-breakpoint
CREATE TABLE "challenge_requirement" (
	"id" uuid PRIMARY KEY NOT NULL,
	"challenge_id" uuid NOT NULL,
	"coupling_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"required_count" integer,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	"server_version" bigint NOT NULL,
	CONSTRAINT "challenge_requirement_person_uq" UNIQUE("challenge_id","person_id"),
	CONSTRAINT "challenge_requirement_payload_check" CHECK (("challenge_requirement"."deleted_at" is null) = ("challenge_requirement"."required_count" is not null) and "challenge_requirement"."required_count" > 0)
);
--> statement-breakpoint
CREATE TABLE "community_project" (
	"id" uuid PRIMARY KEY NOT NULL,
	"island_id" uuid NOT NULL,
	"coupling_id" uuid NOT NULL,
	"sequence_number" integer NOT NULL,
	"template_key" text NOT NULL,
	"build_need" integer NOT NULL,
	"nature_need" integer NOT NULL,
	"status" text NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	"server_version" bigint NOT NULL,
	CONSTRAINT "community_project_sequence_uq" UNIQUE("island_id","sequence_number"),
	CONSTRAINT "community_project_status_check" CHECK ("community_project"."status" in ('aktiv', 'fertig')),
	CONSTRAINT "community_project_completed_check" CHECK (("community_project"."status" = 'fertig') = ("community_project"."completed_at" is not null)),
	CONSTRAINT "community_project_need_check" CHECK ("community_project"."sequence_number" > 0 and "community_project"."build_need" > 0 and "community_project"."nature_need" > 0)
);
--> statement-breakpoint
CREATE TABLE "energy_booking" (
	"id" uuid PRIMARY KEY NOT NULL,
	"person_id" uuid NOT NULL,
	"type" text NOT NULL,
	"amount" integer NOT NULL,
	"local_date" date NOT NULL,
	"booking_key" text NOT NULL,
	"trigger" jsonb NOT NULL,
	"daily_goal_completion_id" uuid,
	"island_object_id" uuid,
	"community_project_id" uuid,
	"original_booking_id" uuid,
	"created_at" timestamp with time zone NOT NULL,
	"server_version" bigint NOT NULL,
	CONSTRAINT "energy_booking_key_uq" UNIQUE("booking_key"),
	CONSTRAINT "energy_booking_type_check" CHECK ("energy_booking"."type" in ('daily_goal_credit', 'daily_bonus_credit', 'build_debit', 'upgrade_debit', 'project_contribution_debit', 'counter_booking')),
	CONSTRAINT "energy_booking_amount_check" CHECK (case when "energy_booking"."type" in ('daily_goal_credit', 'daily_bonus_credit') then "energy_booking"."amount" = 1 when "energy_booking"."type" = 'counter_booking' then "energy_booking"."amount" <> 0 else "energy_booking"."amount" < 0 end),
	CONSTRAINT "energy_booking_reference_check" CHECK (("energy_booking"."daily_goal_completion_id" is not null) = ("energy_booking"."type" = 'daily_goal_credit') and ("energy_booking"."island_object_id" is not null) = ("energy_booking"."type" in ('build_debit', 'upgrade_debit')) and ("energy_booking"."community_project_id" is not null) = ("energy_booking"."type" = 'project_contribution_debit') and ("energy_booking"."original_booking_id" is not null) = ("energy_booking"."type" = 'counter_booking'))
);
--> statement-breakpoint
CREATE TABLE "island" (
	"id" uuid PRIMARY KEY NOT NULL,
	"coupling_id" uuid NOT NULL,
	"state" text NOT NULL,
	"hatched_at" timestamp with time zone,
	"time_zone" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	"server_version" bigint NOT NULL,
	CONSTRAINT "island_coupling_uq" UNIQUE("coupling_id"),
	CONSTRAINT "island_owner_uq" UNIQUE("id","coupling_id"),
	CONSTRAINT "island_state_check" CHECK ("island"."state" in ('wartet_auf_rollen', 'aktiv', 'archiviert')),
	CONSTRAINT "island_hatched_check" CHECK (("island"."state" <> 'aktiv' or "island"."hatched_at" is not null) and ("island"."state" <> 'wartet_auf_rollen' or "island"."hatched_at" is null) and ("island"."hatched_at" is null) = ("island"."time_zone" is null))
);
--> statement-breakpoint
CREATE TABLE "island_event" (
	"id" uuid PRIMARY KEY NOT NULL,
	"island_id" uuid NOT NULL,
	"coupling_id" uuid NOT NULL,
	"type" text NOT NULL,
	"template_key" text,
	"responsible_person_id" uuid,
	"occasion_key" text NOT NULL,
	"status" text NOT NULL,
	"reward" jsonb,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	"server_version" bigint NOT NULL,
	CONSTRAINT "island_event_occasion_uq" UNIQUE("island_id","occasion_key"),
	CONSTRAINT "island_event_type_check" CHECK ("island_event"."type" in ('besuch', 'momos_wunsch', 'inselwetter', 'entdeckung', 'momo_geschluepft', 'levelaufstieg', 'gebiet', 'projektabschluss', 'accessoire', 'deko_geschenkt', 'challenge_gestartet', 'challenge_geschafft', 'challenge_abgelaufen', 'challenge_beendet')),
	CONSTRAINT "island_event_status_check" CHECK ("island_event"."status" in ('offen', 'erfuellbar', 'abgeschlossen'))
);
--> statement-breakpoint
CREATE TABLE "island_event_state" (
	"id" uuid PRIMARY KEY NOT NULL,
	"island_event_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"seen_at" timestamp with time zone,
	"claimed_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	"server_version" bigint NOT NULL,
	CONSTRAINT "island_event_state_person_uq" UNIQUE("island_event_id","person_id")
);
--> statement-breakpoint
CREATE TABLE "island_field" (
	"id" uuid PRIMARY KEY NOT NULL,
	"island_id" uuid NOT NULL,
	"coupling_id" uuid NOT NULL,
	"field_key" text NOT NULL,
	"owner_person_id" uuid,
	"created_at" timestamp with time zone NOT NULL,
	"server_version" bigint NOT NULL,
	CONSTRAINT "island_field_key_uq" UNIQUE("island_id","field_key"),
	CONSTRAINT "island_field_island_uq" UNIQUE("id","island_id")
);
--> statement-breakpoint
CREATE TABLE "island_object" (
	"id" uuid PRIMARY KEY NOT NULL,
	"island_id" uuid NOT NULL,
	"coupling_id" uuid NOT NULL,
	"owner_person_id" uuid NOT NULL,
	"catalog_key" text NOT NULL,
	"origin" text NOT NULL,
	"level" smallint NOT NULL,
	"field_id" uuid,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	"server_version" bigint NOT NULL,
	CONSTRAINT "island_object_origin_check" CHECK ("island_object"."origin" in ('gebaut', 'besucher', 'entdeckung', 'jahreszeit', 'challenge')),
	CONSTRAINT "island_object_level_check" CHECK ("island_object"."level" between 1 and 3)
);
--> statement-breakpoint
CREATE TABLE "momo_accessory" (
	"id" uuid PRIMARY KEY NOT NULL,
	"island_id" uuid NOT NULL,
	"coupling_id" uuid NOT NULL,
	"catalog_key" text NOT NULL,
	"source_event_id" uuid NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"server_version" bigint NOT NULL,
	CONSTRAINT "momo_accessory_key_uq" UNIQUE("island_id","catalog_key")
);
--> statement-breakpoint
CREATE TABLE "momo_outfit" (
	"id" uuid PRIMARY KEY NOT NULL,
	"island_id" uuid NOT NULL,
	"coupling_id" uuid NOT NULL,
	"slot" text NOT NULL,
	"accessory_key" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	"server_version" bigint NOT NULL,
	CONSTRAINT "momo_outfit_slot_uq" UNIQUE("island_id","slot"),
	CONSTRAINT "momo_outfit_slot_check" CHECK ("momo_outfit"."slot" in ('kopf', 'hals'))
);
--> statement-breakpoint
CREATE TABLE "project_contribution" (
	"id" uuid PRIMARY KEY NOT NULL,
	"community_project_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"role" text NOT NULL,
	"amount" integer NOT NULL,
	"energy_booking_id" uuid NOT NULL,
	"command_id" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"server_version" bigint NOT NULL,
	CONSTRAINT "project_contribution_booking_uq" UNIQUE("energy_booking_id"),
	CONSTRAINT "project_contribution_command_uq" UNIQUE("command_id"),
	CONSTRAINT "project_contribution_role_check" CHECK ("project_contribution"."role" in ('bauen', 'natur')),
	CONSTRAINT "project_contribution_amount_check" CHECK ("project_contribution"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "delivery_attempt" (
	"id" uuid PRIMARY KEY NOT NULL,
	"intent_id" text NOT NULL,
	"installation_id" uuid NOT NULL,
	"recipient_person_id" uuid NOT NULL,
	"status" text NOT NULL,
	"expo_ticket_id" text,
	"error_code" text,
	"attempt_count" integer NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"receipt_checked_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "delivery_attempt_installation_uq" UNIQUE("intent_id","installation_id"),
	CONSTRAINT "delivery_attempt_status_check" CHECK ("delivery_attempt"."status" in ('geplant', 'gesendet', 'ticket_fehler', 'quittiert', 'quittung_fehler', 'aufgegeben')),
	CONSTRAINT "delivery_attempt_count_check" CHECK ("delivery_attempt"."attempt_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "encouragement" (
	"id" uuid PRIMARY KEY NOT NULL,
	"coupling_id" uuid NOT NULL,
	"sender_person_id" uuid NOT NULL,
	"recipient_person_id" uuid NOT NULL,
	"message_key" text NOT NULL,
	"sent_at" timestamp with time zone NOT NULL,
	"local_date" date NOT NULL,
	"time_zone" text NOT NULL,
	"utc_offset_minutes" smallint NOT NULL,
	"push_status" text NOT NULL,
	"thanked_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	"server_version" bigint NOT NULL,
	CONSTRAINT "encouragement_message_key_check" CHECK ("encouragement"."message_key" in ('du_schaffst_das', 'ich_denk_an_dich', 'stark_heute', 'gemeinsam_fuer_momo', 'stolz_auf_dich')),
	CONSTRAINT "encouragement_push_status_check" CHECK ("encouragement"."push_status" in ('ohne_push', 'ausstehend', 'zugestellt', 'unterdrueckt', 'fehlgeschlagen')),
	CONSTRAINT "encouragement_recipient_check" CHECK ("encouragement"."sender_person_id" <> "encouragement"."recipient_person_id")
);
--> statement-breakpoint
CREATE TABLE "notification_intent" (
	"intent_id" text PRIMARY KEY NOT NULL,
	"source_event_id" uuid NOT NULL,
	"recipient_person_id" uuid NOT NULL,
	"type" text NOT NULL,
	"message_key" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"status_changed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "notification_intent_type_check" CHECK ("notification_intent"."type" in ('anfeuern', 'levelaufstieg', 'gebiet', 'projektabschluss', 'challenge_vorschlag', 'challenge_erfolg', 'rollen_anfrage', 'deko_geschenk', 'entkopplung')),
	CONSTRAINT "notification_intent_status_check" CHECK ("notification_intent"."status" in ('offen', 'unterdrueckt', 'keine_installation', 'zugestellt', 'fehlgeschlagen')),
	CONSTRAINT "notification_intent_id_check" CHECK ("notification_intent"."intent_id" = "notification_intent"."source_event_id"::text || ':' || "notification_intent"."recipient_person_id"::text || ':' || "notification_intent"."type")
);
--> statement-breakpoint
CREATE TABLE "notification_setting" (
	"id" uuid PRIMARY KEY NOT NULL,
	"person_id" uuid NOT NULL,
	"midday_enabled" boolean NOT NULL,
	"midday_time" text NOT NULL,
	"evening_enabled" boolean NOT NULL,
	"evening_time" text NOT NULL,
	"tracker_ernaehrung" boolean NOT NULL,
	"tracker_wasser" boolean NOT NULL,
	"tracker_sport" boolean NOT NULL,
	"tracker_gewicht" boolean NOT NULL,
	"partner_push_enabled" boolean NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	"server_version" bigint NOT NULL,
	CONSTRAINT "notification_setting_person_uq" UNIQUE("person_id"),
	CONSTRAINT "notification_setting_time_format_check" CHECK ("notification_setting"."midday_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' and "notification_setting"."evening_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
	CONSTRAINT "notification_setting_time_order_check" CHECK ("notification_setting"."evening_time" > "notification_setting"."midday_time")
);
--> statement-breakpoint
CREATE TABLE "push_installation" (
	"id" uuid PRIMARY KEY NOT NULL,
	"person_id" uuid NOT NULL,
	"session_id" text NOT NULL,
	"installation_key" text NOT NULL,
	"expo_push_token" text NOT NULL,
	"platform" text NOT NULL,
	"permission_status" text NOT NULL,
	"active" boolean NOT NULL,
	"last_used_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "push_installation_key_uq" UNIQUE("installation_key"),
	CONSTRAINT "push_installation_platform_check" CHECK ("push_installation"."platform" in ('ios', 'android')),
	CONSTRAINT "push_installation_permission_check" CHECK ("push_installation"."permission_status" in ('erlaubt', 'verweigert', 'unentschieden'))
);
--> statement-breakpoint
CREATE TABLE "island_progress" (
	"id" uuid PRIMARY KEY NOT NULL,
	"island_id" uuid NOT NULL,
	"coupling_id" uuid NOT NULL,
	"level" integer NOT NULL,
	"level_need" integer NOT NULL,
	"content" jsonb NOT NULL,
	"data_as_of" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	"server_version" bigint NOT NULL,
	CONSTRAINT "island_progress_island_uq" UNIQUE("island_id"),
	CONSTRAINT "island_progress_level_check" CHECK ("island_progress"."level" > 0 and "island_progress"."level_need" > 0)
);
--> statement-breakpoint
CREATE TABLE "partner_daily_goal_status" (
	"id" uuid PRIMARY KEY NOT NULL,
	"coupling_id" uuid NOT NULL,
	"owner_person_id" uuid NOT NULL,
	"recipient_person_id" uuid NOT NULL,
	"local_date" date NOT NULL,
	"generation" integer NOT NULL,
	"stage" text NOT NULL,
	"data_as_of" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	"server_version" bigint NOT NULL,
	CONSTRAINT "partner_daily_goal_status_generation_uq" UNIQUE("coupling_id","owner_person_id","recipient_person_id","local_date","generation"),
	CONSTRAINT "partner_daily_goal_status_stage_check" CHECK ("partner_daily_goal_status"."stage" in ('noch_nichts', 'unterwegs', 'fast_geschafft', 'geschafft')),
	CONSTRAINT "partner_daily_goal_status_shape_check" CHECK ("partner_daily_goal_status"."owner_person_id" <> "partner_daily_goal_status"."recipient_person_id" and "partner_daily_goal_status"."generation" > 0)
);
--> statement-breakpoint
CREATE TABLE "partner_summary" (
	"id" uuid PRIMARY KEY NOT NULL,
	"coupling_id" uuid NOT NULL,
	"owner_person_id" uuid NOT NULL,
	"recipient_person_id" uuid NOT NULL,
	"area" text NOT NULL,
	"period_from" date NOT NULL,
	"period_to" date NOT NULL,
	"generation" integer NOT NULL,
	"content" jsonb NOT NULL,
	"data_as_of" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	"server_version" bigint NOT NULL,
	CONSTRAINT "partner_summary_generation_uq" UNIQUE("coupling_id","owner_person_id","recipient_person_id","area","period_from","generation"),
	CONSTRAINT "partner_summary_area_check" CHECK ("partner_summary"."area" in ('ernaehrung', 'wasser', 'sport', 'gewicht')),
	CONSTRAINT "partner_summary_shape_check" CHECK ("partner_summary"."owner_person_id" <> "partner_summary"."recipient_person_id" and "partner_summary"."generation" > 0 and "partner_summary"."period_from" <= "partner_summary"."period_to")
);
--> statement-breakpoint
CREATE TABLE "projection_invalidation" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_person_id" uuid NOT NULL,
	"area" text,
	"from_date" date NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"processed_at" timestamp with time zone,
	CONSTRAINT "projection_invalidation_area_check" CHECK ("projection_invalidation"."area" in ('ernaehrung', 'wasser', 'sport', 'gewicht'))
);
--> statement-breakpoint
CREATE TABLE "revocation_notice" (
	"id" uuid PRIMARY KEY NOT NULL,
	"recipient_person_id" uuid NOT NULL,
	"coupling_id" uuid NOT NULL,
	"target_type" text NOT NULL,
	"projection_id" uuid,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"server_version" bigint NOT NULL,
	CONSTRAINT "revocation_notice_target_type_check" CHECK ("revocation_notice"."target_type" in ('partner_summary', 'partner_daily_goal_status', 'kopplung')),
	CONSTRAINT "revocation_notice_reason_check" CHECK ("revocation_notice"."reason" in ('freigabe_entzogen', 'entkopplung')),
	CONSTRAINT "revocation_notice_target_check" CHECK (("revocation_notice"."target_type" = 'kopplung') = ("revocation_notice"."projection_id" is null) and ("revocation_notice"."reason" = 'entkopplung' or "revocation_notice"."target_type" = 'partner_summary'))
);
--> statement-breakpoint
CREATE TABLE "change_log" (
	"position" bigint PRIMARY KEY NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"operation" text NOT NULL,
	"owner_person_id" uuid,
	"coupling_id" uuid,
	"recipient_person_id" uuid,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "change_log_operation_check" CHECK ("change_log"."operation" in ('upsert', 'delete')),
	CONSTRAINT "change_log_scope_check" CHECK ("change_log"."owner_person_id" is not null or "change_log"."coupling_id" is not null or "change_log"."recipient_person_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "processed_operation" (
	"operation_id" uuid PRIMARY KEY NOT NULL,
	"person_id" uuid NOT NULL,
	"operation_type" text NOT NULL,
	"business_key" text,
	"payload_hash" text NOT NULL,
	"outcome" text NOT NULL,
	"result" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "processed_operation_outcome_check" CHECK ("processed_operation"."outcome" in ('applied', 'already_applied', 'permanently_rejected'))
);
--> statement-breakpoint
CREATE TABLE "security_log" (
	"id" uuid PRIMARY KEY NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"event_type" text NOT NULL,
	"account_id" text,
	"person_id" uuid,
	"details" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_clock" (
	"id" smallint PRIMARY KEY NOT NULL,
	"position" bigint NOT NULL,
	CONSTRAINT "sync_clock_single_row_check" CHECK ("sync_clock"."id" = 1),
	CONSTRAINT "sync_clock_position_check" CHECK ("sync_clock"."position" >= 0)
);
--> statement-breakpoint
ALTER TABLE "coupling" ADD CONSTRAINT "coupling_person_low_id_person_id_fk" FOREIGN KEY ("person_low_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupling" ADD CONSTRAINT "coupling_person_high_id_person_id_fk" FOREIGN KEY ("person_high_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupling_member" ADD CONSTRAINT "coupling_member_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupling_member" ADD CONSTRAINT "coupling_member_coupling_fk" FOREIGN KEY ("coupling_id","coupling_status") REFERENCES "public"."coupling"("id","status") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_inviter_person_id_person_id_fk" FOREIGN KEY ("inviter_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_consumed_by_person_id_person_id_fk" FOREIGN KEY ("consumed_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_sharing" ADD CONSTRAINT "partner_sharing_owner_person_id_person_id_fk" FOREIGN KEY ("owner_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_sharing" ADD CONSTRAINT "partner_sharing_coupling_id_coupling_id_fk" FOREIGN KEY ("coupling_id") REFERENCES "public"."coupling"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photo_sharing" ADD CONSTRAINT "photo_sharing_owner_person_id_person_id_fk" FOREIGN KEY ("owner_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photo_sharing" ADD CONSTRAINT "photo_sharing_coupling_id_coupling_id_fk" FOREIGN KEY ("coupling_id") REFERENCES "public"."coupling"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shared_action" ADD CONSTRAINT "shared_action_coupling_id_coupling_id_fk" FOREIGN KEY ("coupling_id") REFERENCES "public"."coupling"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shared_action" ADD CONSTRAINT "shared_action_requester_person_id_person_id_fk" FOREIGN KEY ("requester_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_suggestion" ADD CONSTRAINT "budget_suggestion_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_goal" ADD CONSTRAINT "daily_goal_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_goal_completion" ADD CONSTRAINT "daily_goal_completion_goal_fk" FOREIGN KEY ("daily_goal_id","person_id","local_date","slot","baustein") REFERENCES "public"."daily_goal"("id","person_id","local_date","slot","baustein") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_version" ADD CONSTRAINT "goal_version_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_plan_day" ADD CONSTRAINT "weekly_plan_day_version_fk" FOREIGN KEY ("weekly_plan_version_id","person_id") REFERENCES "public"."weekly_plan_version"("id","person_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_plan_version" ADD CONSTRAINT "weekly_plan_version_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "food_favorite" ADD CONSTRAINT "food_favorite_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_favorite" ADD CONSTRAINT "meal_favorite_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_favorite_item" ADD CONSTRAINT "meal_favorite_item_favorite_fk" FOREIGN KEY ("meal_favorite_id","person_id") REFERENCES "public"."meal_favorite"("id","person_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_photo" ADD CONSTRAINT "meal_photo_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nutrition_entry" ADD CONSTRAINT "nutrition_entry_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nutrition_entry" ADD CONSTRAINT "nutrition_entry_photo_fk" FOREIGN KEY ("meal_photo_id","person_id") REFERENCES "public"."meal_photo"("id","person_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "own_food" ADD CONSTRAINT "own_food_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photo_draft" ADD CONSTRAINT "photo_draft_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sport_entry" ADD CONSTRAINT "sport_entry_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sport_entry" ADD CONSTRAINT "sport_entry_replaced_by_fk" FOREIGN KEY ("replaced_by_entry_id","person_id") REFERENCES "public"."sport_entry"("id","person_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "water_entry" ADD CONSTRAINT "water_entry_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weight_entry" ADD CONSTRAINT "weight_entry_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "area_unlock" ADD CONSTRAINT "area_unlock_island_fk" FOREIGN KEY ("island_id","coupling_id") REFERENCES "public"."island"("id","coupling_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blueprint_unlock" ADD CONSTRAINT "blueprint_unlock_island_fk" FOREIGN KEY ("island_id","coupling_id") REFERENCES "public"."island"("id","coupling_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "challenge" ADD CONSTRAINT "challenge_coupling_id_coupling_id_fk" FOREIGN KEY ("coupling_id") REFERENCES "public"."coupling"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "challenge" ADD CONSTRAINT "challenge_proposer_person_id_person_id_fk" FOREIGN KEY ("proposer_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "challenge_requirement" ADD CONSTRAINT "challenge_requirement_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "challenge_requirement" ADD CONSTRAINT "challenge_requirement_challenge_fk" FOREIGN KEY ("challenge_id","coupling_id") REFERENCES "public"."challenge"("id","coupling_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_project" ADD CONSTRAINT "community_project_island_fk" FOREIGN KEY ("island_id","coupling_id") REFERENCES "public"."island"("id","coupling_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "energy_booking" ADD CONSTRAINT "energy_booking_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "energy_booking" ADD CONSTRAINT "energy_booking_daily_goal_completion_id_daily_goal_completion_id_fk" FOREIGN KEY ("daily_goal_completion_id") REFERENCES "public"."daily_goal_completion"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "energy_booking" ADD CONSTRAINT "energy_booking_island_object_id_island_object_id_fk" FOREIGN KEY ("island_object_id") REFERENCES "public"."island_object"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "energy_booking" ADD CONSTRAINT "energy_booking_community_project_id_community_project_id_fk" FOREIGN KEY ("community_project_id") REFERENCES "public"."community_project"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "energy_booking" ADD CONSTRAINT "energy_booking_original_booking_id_energy_booking_id_fk" FOREIGN KEY ("original_booking_id") REFERENCES "public"."energy_booking"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "island" ADD CONSTRAINT "island_coupling_id_coupling_id_fk" FOREIGN KEY ("coupling_id") REFERENCES "public"."coupling"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "island_event" ADD CONSTRAINT "island_event_responsible_person_id_person_id_fk" FOREIGN KEY ("responsible_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "island_event" ADD CONSTRAINT "island_event_island_fk" FOREIGN KEY ("island_id","coupling_id") REFERENCES "public"."island"("id","coupling_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "island_event_state" ADD CONSTRAINT "island_event_state_island_event_id_island_event_id_fk" FOREIGN KEY ("island_event_id") REFERENCES "public"."island_event"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "island_event_state" ADD CONSTRAINT "island_event_state_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "island_field" ADD CONSTRAINT "island_field_owner_person_id_person_id_fk" FOREIGN KEY ("owner_person_id") REFERENCES "public"."person"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "island_field" ADD CONSTRAINT "island_field_island_fk" FOREIGN KEY ("island_id","coupling_id") REFERENCES "public"."island"("id","coupling_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "island_object" ADD CONSTRAINT "island_object_owner_person_id_person_id_fk" FOREIGN KEY ("owner_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "island_object" ADD CONSTRAINT "island_object_island_fk" FOREIGN KEY ("island_id","coupling_id") REFERENCES "public"."island"("id","coupling_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "island_object" ADD CONSTRAINT "island_object_field_fk" FOREIGN KEY ("field_id","island_id") REFERENCES "public"."island_field"("id","island_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "momo_accessory" ADD CONSTRAINT "momo_accessory_source_event_id_island_event_id_fk" FOREIGN KEY ("source_event_id") REFERENCES "public"."island_event"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "momo_accessory" ADD CONSTRAINT "momo_accessory_island_fk" FOREIGN KEY ("island_id","coupling_id") REFERENCES "public"."island"("id","coupling_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "momo_outfit" ADD CONSTRAINT "momo_outfit_island_fk" FOREIGN KEY ("island_id","coupling_id") REFERENCES "public"."island"("id","coupling_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "momo_outfit" ADD CONSTRAINT "momo_outfit_accessory_fk" FOREIGN KEY ("island_id","accessory_key") REFERENCES "public"."momo_accessory"("island_id","catalog_key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_contribution" ADD CONSTRAINT "project_contribution_community_project_id_community_project_id_fk" FOREIGN KEY ("community_project_id") REFERENCES "public"."community_project"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_contribution" ADD CONSTRAINT "project_contribution_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_contribution" ADD CONSTRAINT "project_contribution_energy_booking_id_energy_booking_id_fk" FOREIGN KEY ("energy_booking_id") REFERENCES "public"."energy_booking"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_attempt" ADD CONSTRAINT "delivery_attempt_intent_id_notification_intent_intent_id_fk" FOREIGN KEY ("intent_id") REFERENCES "public"."notification_intent"("intent_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_attempt" ADD CONSTRAINT "delivery_attempt_installation_id_push_installation_id_fk" FOREIGN KEY ("installation_id") REFERENCES "public"."push_installation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_attempt" ADD CONSTRAINT "delivery_attempt_recipient_person_id_person_id_fk" FOREIGN KEY ("recipient_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "encouragement" ADD CONSTRAINT "encouragement_coupling_id_coupling_id_fk" FOREIGN KEY ("coupling_id") REFERENCES "public"."coupling"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "encouragement" ADD CONSTRAINT "encouragement_sender_person_id_person_id_fk" FOREIGN KEY ("sender_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "encouragement" ADD CONSTRAINT "encouragement_recipient_person_id_person_id_fk" FOREIGN KEY ("recipient_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_intent" ADD CONSTRAINT "notification_intent_recipient_person_id_person_id_fk" FOREIGN KEY ("recipient_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_setting" ADD CONSTRAINT "notification_setting_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_installation" ADD CONSTRAINT "push_installation_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "island_progress" ADD CONSTRAINT "island_progress_island_id_island_id_fk" FOREIGN KEY ("island_id") REFERENCES "public"."island"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "island_progress" ADD CONSTRAINT "island_progress_coupling_id_coupling_id_fk" FOREIGN KEY ("coupling_id") REFERENCES "public"."coupling"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_daily_goal_status" ADD CONSTRAINT "partner_daily_goal_status_coupling_id_coupling_id_fk" FOREIGN KEY ("coupling_id") REFERENCES "public"."coupling"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_daily_goal_status" ADD CONSTRAINT "partner_daily_goal_status_owner_person_id_person_id_fk" FOREIGN KEY ("owner_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_daily_goal_status" ADD CONSTRAINT "partner_daily_goal_status_recipient_person_id_person_id_fk" FOREIGN KEY ("recipient_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_summary" ADD CONSTRAINT "partner_summary_coupling_id_coupling_id_fk" FOREIGN KEY ("coupling_id") REFERENCES "public"."coupling"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_summary" ADD CONSTRAINT "partner_summary_owner_person_id_person_id_fk" FOREIGN KEY ("owner_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_summary" ADD CONSTRAINT "partner_summary_recipient_person_id_person_id_fk" FOREIGN KEY ("recipient_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projection_invalidation" ADD CONSTRAINT "projection_invalidation_owner_person_id_person_id_fk" FOREIGN KEY ("owner_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revocation_notice" ADD CONSTRAINT "revocation_notice_recipient_person_id_person_id_fk" FOREIGN KEY ("recipient_person_id") REFERENCES "public"."person"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revocation_notice" ADD CONSTRAINT "revocation_notice_coupling_id_coupling_id_fk" FOREIGN KEY ("coupling_id") REFERENCES "public"."coupling"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_log" ADD CONSTRAINT "change_log_owner_person_id_person_id_fk" FOREIGN KEY ("owner_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_log" ADD CONSTRAINT "change_log_coupling_id_coupling_id_fk" FOREIGN KEY ("coupling_id") REFERENCES "public"."coupling"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_log" ADD CONSTRAINT "change_log_recipient_person_id_person_id_fk" FOREIGN KEY ("recipient_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "processed_operation" ADD CONSTRAINT "processed_operation_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "coupling_member_active_person_uq" ON "coupling_member" USING btree ("person_id") WHERE "coupling_member"."coupling_status" = 'aktiv';--> statement-breakpoint
CREATE UNIQUE INDEX "coupling_member_role_uq" ON "coupling_member" USING btree ("coupling_id","role") WHERE "coupling_member"."role" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "invitation_open_code_uq" ON "invitation" USING btree ("code_hmac") WHERE "invitation"."consumed_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "shared_action_open_role_choice_uq" ON "shared_action" USING btree ("coupling_id") WHERE "shared_action"."kind" = 'rollenwahl' and "shared_action"."status" = 'offen';--> statement-breakpoint
CREATE UNIQUE INDEX "own_food_barcode_uq" ON "own_food" USING btree ("person_id","origin_key") WHERE "own_food"."origin_type" = 'off';--> statement-breakpoint
CREATE UNIQUE INDEX "challenge_open_uq" ON "challenge" USING btree ("coupling_id") WHERE "challenge"."status" in ('vorgeschlagen', 'aktiv');--> statement-breakpoint
CREATE UNIQUE INDEX "community_project_active_uq" ON "community_project" USING btree ("island_id") WHERE "community_project"."status" = 'aktiv';--> statement-breakpoint
CREATE UNIQUE INDEX "island_object_field_uq" ON "island_object" USING btree ("field_id") WHERE "island_object"."field_id" is not null and "island_object"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "partner_daily_goal_status_live_uq" ON "partner_daily_goal_status" USING btree ("coupling_id","owner_person_id","recipient_person_id","local_date") WHERE "partner_daily_goal_status"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "partner_summary_live_uq" ON "partner_summary" USING btree ("coupling_id","owner_person_id","recipient_person_id","area","period_from") WHERE "partner_summary"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "processed_operation_business_key_uq" ON "processed_operation" USING btree ("operation_type","business_key") WHERE "processed_operation"."outcome" <> 'permanently_rejected';