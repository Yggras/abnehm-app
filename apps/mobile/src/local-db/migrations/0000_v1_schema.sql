CREATE TABLE `coupling` (
	`id` text PRIMARY KEY NOT NULL,
	`person_low_id` text NOT NULL,
	`person_high_id` text NOT NULL,
	`status` text NOT NULL,
	`started_at` text NOT NULL,
	`ended_at` text,
	`reactivated_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`server_version` text,
	CONSTRAINT "coupling_status_check" CHECK("coupling"."status" in ('aktiv', 'archiviert')),
	CONSTRAINT "coupling_pair_order_check" CHECK("coupling"."person_low_id" < "coupling"."person_high_id"),
	CONSTRAINT "coupling_ended_check" CHECK(("coupling"."status" = 'archiviert') = ("coupling"."ended_at" is not null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `coupling_pair_uq` ON `coupling` (`person_low_id`,`person_high_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `coupling_id_status_uq` ON `coupling` (`id`,`status`);--> statement-breakpoint
CREATE TABLE `coupling_member` (
	`id` text PRIMARY KEY NOT NULL,
	`coupling_id` text NOT NULL,
	`coupling_status` text NOT NULL,
	`person_id` text NOT NULL,
	`role` text,
	`display_name` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`server_version` text,
	FOREIGN KEY (`coupling_id`,`coupling_status`) REFERENCES `coupling`(`id`,`status`) ON UPDATE cascade ON DELETE no action,
	CONSTRAINT "coupling_member_role_check" CHECK("coupling_member"."role" in ('bauen', 'natur'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `coupling_member_active_person_uq` ON `coupling_member` (`person_id`) WHERE "coupling_member"."coupling_status" = 'aktiv';--> statement-breakpoint
CREATE UNIQUE INDEX `coupling_member_role_uq` ON `coupling_member` (`coupling_id`,`role`) WHERE "coupling_member"."role" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX `coupling_member_person_uq` ON `coupling_member` (`coupling_id`,`person_id`);--> statement-breakpoint
CREATE TABLE `partner_sharing` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_person_id` text NOT NULL,
	`coupling_id` text NOT NULL,
	`area` text NOT NULL,
	`level` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`server_version` text,
	FOREIGN KEY (`owner_person_id`) REFERENCES `person`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`coupling_id`) REFERENCES `coupling`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "partner_sharing_area_check" CHECK("partner_sharing"."area" in ('ernaehrung', 'wasser', 'sport', 'gewicht')),
	CONSTRAINT "partner_sharing_level_check" CHECK("partner_sharing"."level" in ('privat', 'zusammengefasst'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `partner_sharing_area_uq` ON `partner_sharing` (`owner_person_id`,`coupling_id`,`area`);--> statement-breakpoint
CREATE TABLE `person` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`display_name` text NOT NULL,
	`calculation_sex` text,
	`birth_date` text,
	`height_cm` integer,
	`activity_level` text,
	`pregnant_or_breastfeeding` integer,
	`known_eating_disorder` integer,
	`disclaimer_accepted_at` text,
	`onboarding_status` text NOT NULL,
	`onboarding_completed_at` text,
	`goal_weight_reached_g` integer,
	`goal_weight_reached_at` text,
	`time_zone` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`server_version` text,
	CONSTRAINT "person_calculation_sex_check" CHECK("person"."calculation_sex" in ('maennlich', 'weiblich')),
	CONSTRAINT "person_activity_level_check" CHECK("person"."activity_level" in ('wenig_aktiv', 'maessig_aktiv', 'aktiv')),
	CONSTRAINT "person_height_check" CHECK("person"."height_cm" between 120 and 230),
	CONSTRAINT "person_onboarding_status_check" CHECK("person"."onboarding_status" in ('begonnen', 'abgeschlossen')),
	CONSTRAINT "person_onboarding_completed_check" CHECK(("person"."onboarding_status" = 'abgeschlossen') = ("person"."onboarding_completed_at" is not null)),
	CONSTRAINT "person_onboarding_fields_check" CHECK("person"."onboarding_status" = 'begonnen' or ("person"."calculation_sex" is not null and "person"."birth_date" is not null and "person"."height_cm" is not null and "person"."activity_level" is not null and "person"."pregnant_or_breastfeeding" is not null and "person"."known_eating_disorder" is not null and "person"."disclaimer_accepted_at" is not null)),
	CONSTRAINT "person_goal_weight_reached_check" CHECK(("person"."goal_weight_reached_g" is null) = ("person"."goal_weight_reached_at" is null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `person_account_uq` ON `person` (`account_id`);--> statement-breakpoint
CREATE TABLE `photo_sharing` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_person_id` text NOT NULL,
	`coupling_id` text NOT NULL,
	`level` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`server_version` text,
	FOREIGN KEY (`owner_person_id`) REFERENCES `person`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`coupling_id`) REFERENCES `coupling`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "photo_sharing_level_check" CHECK("photo_sharing"."level" in ('privat', 'geteilt'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `photo_sharing_owner_uq` ON `photo_sharing` (`owner_person_id`,`coupling_id`);--> statement-breakpoint
CREATE TABLE `shared_action` (
	`id` text PRIMARY KEY NOT NULL,
	`coupling_id` text NOT NULL,
	`kind` text NOT NULL,
	`requester_person_id` text NOT NULL,
	`payload` text NOT NULL,
	`status` text NOT NULL,
	`decided_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`server_version` text,
	FOREIGN KEY (`coupling_id`) REFERENCES `coupling`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "shared_action_kind_check" CHECK("shared_action"."kind" in ('rollenwahl', 'rollentausch', 'entkoppeln', 'deko_schenken')),
	CONSTRAINT "shared_action_status_check" CHECK("shared_action"."status" in ('offen', 'angenommen', 'abgelehnt', 'zurueckgezogen')),
	CONSTRAINT "shared_action_decided_check" CHECK(("shared_action"."status" = 'offen') = ("shared_action"."decided_at" is null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `shared_action_open_role_choice_uq` ON `shared_action` (`coupling_id`) WHERE "shared_action"."kind" = 'rollenwahl' and "shared_action"."status" = 'offen';--> statement-breakpoint
CREATE TABLE `budget_suggestion` (
	`id` text PRIMARY KEY NOT NULL,
	`person_id` text NOT NULL,
	`period_from` text NOT NULL,
	`period_to` text NOT NULL,
	`previous_budget_milli_kcal` integer NOT NULL,
	`suggested_budget_milli_kcal` integer NOT NULL,
	`direction` text NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`server_version` text,
	FOREIGN KEY (`person_id`) REFERENCES `person`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "budget_suggestion_direction_check" CHECK("budget_suggestion"."direction" in ('senken', 'anheben')),
	CONSTRAINT "budget_suggestion_status_check" CHECK("budget_suggestion"."status" in ('offen', 'angenommen', 'abgelehnt', 'ueberholt')),
	CONSTRAINT "budget_suggestion_amount_check" CHECK("budget_suggestion"."suggested_budget_milli_kcal" > 0 and ("budget_suggestion"."direction" = 'senken') = ("budget_suggestion"."suggested_budget_milli_kcal" < "budget_suggestion"."previous_budget_milli_kcal") and "budget_suggestion"."suggested_budget_milli_kcal" <> "budget_suggestion"."previous_budget_milli_kcal"),
	CONSTRAINT "budget_suggestion_period_check" CHECK("budget_suggestion"."period_from" <= "budget_suggestion"."period_to")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `budget_suggestion_period_uq` ON `budget_suggestion` (`person_id`,`period_to`);--> statement-breakpoint
CREATE TABLE `daily_goal` (
	`id` text PRIMARY KEY NOT NULL,
	`person_id` text NOT NULL,
	`local_date` text NOT NULL,
	`time_zone` text NOT NULL,
	`utc_offset_minutes` integer NOT NULL,
	`slot` integer NOT NULL,
	`baustein` text NOT NULL,
	`snapshot` text NOT NULL,
	`day_ends_at` text NOT NULL,
	`created_at` text NOT NULL,
	`server_version` text,
	FOREIGN KEY (`person_id`) REFERENCES `person`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "daily_goal_slot_check" CHECK("daily_goal"."slot" between 1 and 3),
	CONSTRAINT "daily_goal_baustein_check" CHECK("daily_goal"."baustein" in ('ernaehrung_erfasst', 'im_kalorienbudget', 'wasserziel', 'sporteinheit', 'gewogen'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `daily_goal_slot_uq` ON `daily_goal` (`person_id`,`local_date`,`slot`);--> statement-breakpoint
CREATE UNIQUE INDEX `daily_goal_baustein_uq` ON `daily_goal` (`person_id`,`local_date`,`baustein`);--> statement-breakpoint
CREATE UNIQUE INDEX `daily_goal_identity_uq` ON `daily_goal` (`id`,`person_id`,`local_date`,`slot`,`baustein`);--> statement-breakpoint
CREATE TABLE `daily_goal_completion` (
	`id` text PRIMARY KEY NOT NULL,
	`daily_goal_id` text NOT NULL,
	`person_id` text NOT NULL,
	`local_date` text NOT NULL,
	`slot` integer NOT NULL,
	`baustein` text NOT NULL,
	`first_completed_at` text NOT NULL,
	`completion_key` text NOT NULL,
	`created_at` text NOT NULL,
	`server_version` text,
	FOREIGN KEY (`daily_goal_id`,`person_id`,`local_date`,`slot`,`baustein`) REFERENCES `daily_goal`(`id`,`person_id`,`local_date`,`slot`,`baustein`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `daily_goal_completion_goal_uq` ON `daily_goal_completion` (`daily_goal_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `daily_goal_completion_key_uq` ON `daily_goal_completion` (`completion_key`);--> statement-breakpoint
CREATE TABLE `goal_version` (
	`id` text PRIMARY KEY NOT NULL,
	`person_id` text NOT NULL,
	`valid_from` text NOT NULL,
	`calorie_budget_milli_kcal` integer NOT NULL,
	`basal_metabolic_rate_milli_kcal` integer NOT NULL,
	`total_energy_expenditure_milli_kcal` integer NOT NULL,
	`lower_bound_milli_kcal` integer NOT NULL,
	`deficit_milli_kcal` integer,
	`budget_source` text NOT NULL,
	`calculation_sex` text NOT NULL,
	`age_years` integer NOT NULL,
	`height_cm` integer NOT NULL,
	`weight_g` integer NOT NULL,
	`activity_level` text NOT NULL,
	`maintenance_reason` text,
	`pace` text,
	`goal_weight_g` integer NOT NULL,
	`water_target_ml` integer NOT NULL,
	`weekly_sport_target_minutes` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`server_version` text,
	FOREIGN KEY (`person_id`) REFERENCES `person`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "goal_version_budget_source_check" CHECK("goal_version"."budget_source" in ('berechnet', 'manuell', 'budgetvorschlag')),
	CONSTRAINT "goal_version_calculation_sex_check" CHECK("goal_version"."calculation_sex" in ('maennlich', 'weiblich')),
	CONSTRAINT "goal_version_activity_level_check" CHECK("goal_version"."activity_level" in ('wenig_aktiv', 'maessig_aktiv', 'aktiv')),
	CONSTRAINT "goal_version_maintenance_reason_check" CHECK("goal_version"."maintenance_reason" in ('sicherheits_check', 'gewaehlt')),
	CONSTRAINT "goal_version_pace_check" CHECK("goal_version"."pace" in ('entspannt', 'zuegiger')),
	CONSTRAINT "goal_version_maintenance_check" CHECK(("goal_version"."maintenance_reason" is null) = ("goal_version"."pace" is not null)),
	CONSTRAINT "goal_version_deficit_check" CHECK(("goal_version"."deficit_milli_kcal" is null) = ("goal_version"."pace" is null)),
	CONSTRAINT "goal_version_energy_check" CHECK("goal_version"."lower_bound_milli_kcal" > 0 and "goal_version"."calorie_budget_milli_kcal" >= "goal_version"."lower_bound_milli_kcal" and "goal_version"."basal_metabolic_rate_milli_kcal" > 0 and "goal_version"."total_energy_expenditure_milli_kcal" > 0),
	CONSTRAINT "goal_version_targets_check" CHECK("goal_version"."goal_weight_g" > 0 and "goal_version"."weight_g" > 0 and "goal_version"."water_target_ml" > 0 and "goal_version"."weekly_sport_target_minutes" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `goal_version_valid_from_uq` ON `goal_version` (`person_id`,`valid_from`);--> statement-breakpoint
CREATE TABLE `weekly_plan_day` (
	`weekly_plan_version_id` text NOT NULL,
	`person_id` text NOT NULL,
	`weekday` text NOT NULL,
	`baustein_1` text NOT NULL,
	`baustein_2` text NOT NULL,
	`baustein_3` text NOT NULL,
	PRIMARY KEY(`weekly_plan_version_id`, `weekday`),
	FOREIGN KEY (`weekly_plan_version_id`,`person_id`) REFERENCES `weekly_plan_version`(`id`,`person_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "weekly_plan_day_weekday_check" CHECK("weekly_plan_day"."weekday" in ('montag', 'dienstag', 'mittwoch', 'donnerstag', 'freitag', 'samstag', 'sonntag')),
	CONSTRAINT "weekly_plan_day_bausteine_check" CHECK("weekly_plan_day"."baustein_1" in ('ernaehrung_erfasst', 'im_kalorienbudget', 'wasserziel', 'sporteinheit', 'gewogen') and "weekly_plan_day"."baustein_2" in ('ernaehrung_erfasst', 'im_kalorienbudget', 'wasserziel', 'sporteinheit', 'gewogen') and "weekly_plan_day"."baustein_3" in ('ernaehrung_erfasst', 'im_kalorienbudget', 'wasserziel', 'sporteinheit', 'gewogen') and "weekly_plan_day"."baustein_1" <> "weekly_plan_day"."baustein_2" and "weekly_plan_day"."baustein_1" <> "weekly_plan_day"."baustein_3" and "weekly_plan_day"."baustein_2" <> "weekly_plan_day"."baustein_3")
);
--> statement-breakpoint
CREATE TABLE `weekly_plan_version` (
	`id` text PRIMARY KEY NOT NULL,
	`person_id` text NOT NULL,
	`valid_from` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`server_version` text,
	FOREIGN KEY (`person_id`) REFERENCES `person`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `weekly_plan_version_valid_from_uq` ON `weekly_plan_version` (`person_id`,`valid_from`);--> statement-breakpoint
CREATE UNIQUE INDEX `weekly_plan_version_owner_uq` ON `weekly_plan_version` (`id`,`person_id`);--> statement-breakpoint
CREATE TABLE `food_favorite` (
	`id` text PRIMARY KEY NOT NULL,
	`person_id` text NOT NULL,
	`food_ref_type` text NOT NULL,
	`food_ref_key` text NOT NULL,
	`snapshot` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`server_version` text,
	FOREIGN KEY (`person_id`) REFERENCES `person`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "food_favorite_ref_type_check" CHECK("food_favorite"."food_ref_type" in ('bls', 'off', 'eigen'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `food_favorite_ref_uq` ON `food_favorite` (`person_id`,`food_ref_type`,`food_ref_key`);--> statement-breakpoint
CREATE TABLE `meal_favorite` (
	`id` text PRIMARY KEY NOT NULL,
	`person_id` text NOT NULL,
	`name` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`server_version` text,
	FOREIGN KEY (`person_id`) REFERENCES `person`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `meal_favorite_owner_uq` ON `meal_favorite` (`id`,`person_id`);--> statement-breakpoint
CREATE TABLE `meal_favorite_item` (
	`meal_favorite_id` text NOT NULL,
	`person_id` text NOT NULL,
	`position` integer NOT NULL,
	`food_ref_type` text NOT NULL,
	`food_ref_key` text NOT NULL,
	`base_amount` integer NOT NULL,
	`display_unit` text NOT NULL,
	`display_amount_milli` integer NOT NULL,
	`snapshot` text NOT NULL,
	PRIMARY KEY(`meal_favorite_id`, `position`),
	FOREIGN KEY (`meal_favorite_id`,`person_id`) REFERENCES `meal_favorite`(`id`,`person_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "meal_favorite_item_ref_type_check" CHECK("meal_favorite_item"."food_ref_type" in ('bls', 'off', 'eigen')),
	CONSTRAINT "meal_favorite_item_display_unit_check" CHECK("meal_favorite_item"."display_unit" in ('g', 'ml', 'stueck', 'portion')),
	CONSTRAINT "meal_favorite_item_amount_check" CHECK("meal_favorite_item"."position" >= 0 and "meal_favorite_item"."base_amount" > 0 and "meal_favorite_item"."display_amount_milli" > 0)
);
--> statement-breakpoint
CREATE TABLE `meal_photo` (
	`id` text PRIMARY KEY NOT NULL,
	`person_id` text NOT NULL,
	`image_key` text NOT NULL,
	`captured_at` text NOT NULL,
	`shared_with_partner` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`server_version` text,
	FOREIGN KEY (`person_id`) REFERENCES `person`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `meal_photo_owner_uq` ON `meal_photo` (`id`,`person_id`);--> statement-breakpoint
CREATE TABLE `nutrition_entry` (
	`id` text PRIMARY KEY NOT NULL,
	`person_id` text NOT NULL,
	`consumed_at` text NOT NULL,
	`local_date` text NOT NULL,
	`time_zone` text NOT NULL,
	`utc_offset_minutes` integer NOT NULL,
	`meal` text NOT NULL,
	`capture_method` text NOT NULL,
	`food_ref_type` text,
	`food_ref_key` text,
	`base_amount` integer NOT NULL,
	`display_unit` text NOT NULL,
	`display_amount_milli` integer NOT NULL,
	`snapshot_name` text NOT NULL,
	`snapshot_base_unit` text NOT NULL,
	`snapshot_reference_amount` integer NOT NULL,
	`snapshot_milli_kcal` integer NOT NULL,
	`snapshot_protein_mg` integer NOT NULL,
	`snapshot_carbs_mg` integer NOT NULL,
	`snapshot_fat_mg` integer NOT NULL,
	`snapshot_portions` text NOT NULL,
	`snapshot_source` text NOT NULL,
	`snapshot_attribution` text,
	`total_milli_kcal` integer NOT NULL,
	`total_protein_mg` integer NOT NULL,
	`total_carbs_mg` integer NOT NULL,
	`total_fat_mg` integer NOT NULL,
	`meal_photo_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`server_version` text,
	FOREIGN KEY (`person_id`) REFERENCES `person`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`meal_photo_id`,`person_id`) REFERENCES `meal_photo`(`id`,`person_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "nutrition_entry_meal_check" CHECK("nutrition_entry"."meal" in ('fruehstueck', 'mittagessen', 'abendessen', 'snacks')),
	CONSTRAINT "nutrition_entry_capture_method_check" CHECK("nutrition_entry"."capture_method" in ('suche', 'barcode', 'foto', 'lebensmittelfavorit', 'mahlzeitenfavorit', 'zuletzt', 'eigenes_lebensmittel')),
	CONSTRAINT "nutrition_entry_display_unit_check" CHECK("nutrition_entry"."display_unit" in ('g', 'ml', 'stueck', 'portion')),
	CONSTRAINT "nutrition_entry_base_unit_check" CHECK("nutrition_entry"."snapshot_base_unit" in ('g', 'ml')),
	CONSTRAINT "nutrition_entry_source_check" CHECK("nutrition_entry"."snapshot_source" in ('bls', 'off', 'eigen', 'ki')),
	CONSTRAINT "nutrition_entry_ref_check" CHECK(("nutrition_entry"."food_ref_type" is null) = ("nutrition_entry"."food_ref_key" is null) and ("nutrition_entry"."food_ref_type" is null) = ("nutrition_entry"."snapshot_source" = 'ki') and ("nutrition_entry"."food_ref_type" is null or "nutrition_entry"."food_ref_type" = "nutrition_entry"."snapshot_source")),
	CONSTRAINT "nutrition_entry_ai_capture_check" CHECK("nutrition_entry"."snapshot_source" <> 'ki' or "nutrition_entry"."capture_method" = 'foto'),
	CONSTRAINT "nutrition_entry_amount_check" CHECK("nutrition_entry"."base_amount" > 0 and "nutrition_entry"."base_amount" <= (case "nutrition_entry"."snapshot_base_unit" when 'g' then 5000000 else 5000 end) and "nutrition_entry"."display_amount_milli" > 0),
	CONSTRAINT "nutrition_entry_values_check" CHECK("nutrition_entry"."snapshot_reference_amount" > 0 and "nutrition_entry"."snapshot_milli_kcal" >= 0 and "nutrition_entry"."snapshot_protein_mg" >= 0 and "nutrition_entry"."snapshot_carbs_mg" >= 0 and "nutrition_entry"."snapshot_fat_mg" >= 0 and "nutrition_entry"."total_milli_kcal" >= 0 and "nutrition_entry"."total_protein_mg" >= 0 and "nutrition_entry"."total_carbs_mg" >= 0 and "nutrition_entry"."total_fat_mg" >= 0),
	CONSTRAINT "nutrition_entry_macros_check" CHECK("nutrition_entry"."snapshot_base_unit" <> 'g' or "nutrition_entry"."snapshot_protein_mg" + "nutrition_entry"."snapshot_carbs_mg" + "nutrition_entry"."snapshot_fat_mg" <= "nutrition_entry"."snapshot_reference_amount")
);
--> statement-breakpoint
CREATE TABLE `off_cache` (
	`barcode` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`brand` text,
	`base_unit` text NOT NULL,
	`milli_kcal_per_100` integer,
	`protein_mg_per_100` integer,
	`carbs_mg_per_100` integer,
	`fat_mg_per_100` integer,
	`portions` text NOT NULL,
	`fetched_at` text NOT NULL,
	CONSTRAINT "off_cache_base_unit_check" CHECK("off_cache"."base_unit" in ('g', 'ml')),
	CONSTRAINT "off_cache_values_check" CHECK("off_cache"."milli_kcal_per_100" >= 0 and "off_cache"."protein_mg_per_100" >= 0 and "off_cache"."carbs_mg_per_100" >= 0 and "off_cache"."fat_mg_per_100" >= 0)
);
--> statement-breakpoint
CREATE TABLE `own_food` (
	`id` text PRIMARY KEY NOT NULL,
	`person_id` text NOT NULL,
	`name` text NOT NULL,
	`base_unit` text NOT NULL,
	`reference_amount` integer NOT NULL,
	`milli_kcal` integer NOT NULL,
	`protein_mg` integer NOT NULL,
	`carbs_mg` integer NOT NULL,
	`fat_mg` integer NOT NULL,
	`portions` text NOT NULL,
	`origin_type` text,
	`origin_key` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`server_version` text,
	FOREIGN KEY (`person_id`) REFERENCES `person`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "own_food_base_unit_check" CHECK("own_food"."base_unit" in ('g', 'ml')),
	CONSTRAINT "own_food_origin_type_check" CHECK("own_food"."origin_type" in ('bls', 'off')),
	CONSTRAINT "own_food_origin_check" CHECK(("own_food"."origin_type" is null) = ("own_food"."origin_key" is null)),
	CONSTRAINT "own_food_values_check" CHECK("own_food"."reference_amount" > 0 and "own_food"."milli_kcal" >= 0 and "own_food"."protein_mg" >= 0 and "own_food"."carbs_mg" >= 0 and "own_food"."fat_mg" >= 0),
	CONSTRAINT "own_food_macros_check" CHECK("own_food"."base_unit" <> 'g' or "own_food"."protein_mg" + "own_food"."carbs_mg" + "own_food"."fat_mg" <= "own_food"."reference_amount")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `own_food_barcode_uq` ON `own_food` (`person_id`,`origin_key`) WHERE "own_food"."origin_type" = 'off';--> statement-breakpoint
CREATE TABLE `sport_entry` (
	`id` text PRIMARY KEY NOT NULL,
	`person_id` text NOT NULL,
	`activity_type` text NOT NULL,
	`override_activity_type` text,
	`started_at` text NOT NULL,
	`duration_minutes` integer NOT NULL,
	`active_milli_kcal` integer,
	`origin` text NOT NULL,
	`external_key` text,
	`source_app_id` text,
	`source_app_name` text,
	`hidden_at` text,
	`replaced_by_entry_id` text,
	`reactivated_at` text,
	`local_date` text NOT NULL,
	`time_zone` text NOT NULL,
	`utc_offset_minutes` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`server_version` text,
	FOREIGN KEY (`person_id`) REFERENCES `person`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`replaced_by_entry_id`,`person_id`) REFERENCES `sport_entry`(`id`,`person_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "sport_entry_activity_type_check" CHECK("sport_entry"."activity_type" in ('gehen', 'laufen', 'radfahren', 'schwimmen', 'krafttraining', 'yoga_dehnen', 'mannschaftssport', 'sonstiges')),
	CONSTRAINT "sport_entry_override_activity_type_check" CHECK("sport_entry"."override_activity_type" in ('gehen', 'laufen', 'radfahren', 'schwimmen', 'krafttraining', 'yoga_dehnen', 'mannschaftssport', 'sonstiges')),
	CONSTRAINT "sport_entry_duration_check" CHECK("sport_entry"."duration_minutes" between 1 and 1440),
	CONSTRAINT "sport_entry_active_energy_check" CHECK("sport_entry"."active_milli_kcal" >= 0),
	CONSTRAINT "sport_entry_origin_check" CHECK("sport_entry"."origin" in ('manuell', 'apple_health', 'health_connect')),
	CONSTRAINT "sport_entry_origin_fields_check" CHECK(("sport_entry"."origin" = 'manuell' and "sport_entry"."external_key" is null and "sport_entry"."source_app_id" is null and "sport_entry"."source_app_name" is null and "sport_entry"."hidden_at" is null) or ("sport_entry"."origin" <> 'manuell' and "sport_entry"."external_key" is not null and "sport_entry"."replaced_by_entry_id" is null and "sport_entry"."reactivated_at" is null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sport_entry_owner_uq` ON `sport_entry` (`id`,`person_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `sport_entry_external_uq` ON `sport_entry` (`person_id`,`origin`,`external_key`);--> statement-breakpoint
CREATE TABLE `water_entry` (
	`id` text PRIMARY KEY NOT NULL,
	`person_id` text NOT NULL,
	`amount_ml` integer NOT NULL,
	`origin` text NOT NULL,
	`logged_at` text NOT NULL,
	`local_date` text NOT NULL,
	`time_zone` text NOT NULL,
	`utc_offset_minutes` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`server_version` text,
	FOREIGN KEY (`person_id`) REFERENCES `person`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "water_entry_amount_check" CHECK("water_entry"."amount_ml" between 1 and 3000),
	CONSTRAINT "water_entry_origin_check" CHECK("water_entry"."origin" in ('manuell'))
);
--> statement-breakpoint
CREATE TABLE `weight_entry` (
	`id` text PRIMARY KEY NOT NULL,
	`person_id` text NOT NULL,
	`weight_g` integer NOT NULL,
	`measured_at` text NOT NULL,
	`origin` text NOT NULL,
	`external_key` text,
	`source_app_id` text,
	`source_app_name` text,
	`hidden_at` text,
	`local_date` text NOT NULL,
	`time_zone` text NOT NULL,
	`utc_offset_minutes` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`server_version` text,
	FOREIGN KEY (`person_id`) REFERENCES `person`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "weight_entry_weight_check" CHECK("weight_entry"."weight_g" between 20000 and 350000),
	CONSTRAINT "weight_entry_origin_check" CHECK("weight_entry"."origin" in ('manuell', 'apple_health', 'health_connect')),
	CONSTRAINT "weight_entry_origin_fields_check" CHECK(("weight_entry"."origin" = 'manuell' and "weight_entry"."external_key" is null and "weight_entry"."source_app_id" is null and "weight_entry"."source_app_name" is null and "weight_entry"."hidden_at" is null) or ("weight_entry"."origin" <> 'manuell' and "weight_entry"."external_key" is not null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `weight_entry_external_uq` ON `weight_entry` (`person_id`,`origin`,`external_key`);--> statement-breakpoint
CREATE TABLE `area_unlock` (
	`id` text PRIMARY KEY NOT NULL,
	`island_id` text NOT NULL,
	`coupling_id` text NOT NULL,
	`area_key` text NOT NULL,
	`level` integer NOT NULL,
	`unlocked_at` text NOT NULL,
	`created_at` text NOT NULL,
	`server_version` text,
	FOREIGN KEY (`island_id`,`coupling_id`) REFERENCES `island`(`id`,`coupling_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "area_unlock_level_check" CHECK("area_unlock"."level" >= 4)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `area_unlock_key_uq` ON `area_unlock` (`island_id`,`area_key`);--> statement-breakpoint
CREATE TABLE `blueprint_unlock` (
	`id` text PRIMARY KEY NOT NULL,
	`island_id` text NOT NULL,
	`coupling_id` text NOT NULL,
	`catalog_key` text NOT NULL,
	`reason` text NOT NULL,
	`unlocked_at` text NOT NULL,
	`created_at` text NOT NULL,
	`server_version` text,
	FOREIGN KEY (`island_id`,`coupling_id`) REFERENCES `island`(`id`,`coupling_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "blueprint_unlock_reason_check" CHECK("blueprint_unlock"."reason" in ('start', 'level', 'entdeckung', 'besucher'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `blueprint_unlock_key_uq` ON `blueprint_unlock` (`island_id`,`catalog_key`);--> statement-breakpoint
CREATE TABLE `challenge` (
	`id` text PRIMARY KEY NOT NULL,
	`coupling_id` text NOT NULL,
	`template_key` text NOT NULL,
	`proposer_person_id` text NOT NULL,
	`status` text NOT NULL,
	`proposed_at` text NOT NULL,
	`proposal_expires_at` text NOT NULL,
	`started_at` text,
	`ends_at` text,
	`ended_at` text,
	`common_stage` text,
	`challenge_deco_key` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`server_version` text,
	FOREIGN KEY (`coupling_id`) REFERENCES `coupling`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "challenge_status_check" CHECK("challenge"."status" in ('vorgeschlagen', 'aktiv', 'geschafft', 'abgelaufen', 'beendet', 'abgelehnt', 'zurueckgezogen', 'verfallen')),
	CONSTRAINT "challenge_common_stage_check" CHECK("challenge"."common_stage" in ('gestartet', 'gut_unterwegs', 'fast_geschafft', 'geschafft')),
	CONSTRAINT "challenge_started_check" CHECK(("challenge"."started_at" is not null) = ("challenge"."status" in ('aktiv', 'geschafft', 'abgelaufen', 'beendet')) and ("challenge"."started_at" is null) = ("challenge"."ends_at" is null)),
	CONSTRAINT "challenge_ended_check" CHECK(("challenge"."ended_at" is not null) = ("challenge"."status" not in ('vorgeschlagen', 'aktiv')))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `challenge_open_uq` ON `challenge` (`coupling_id`) WHERE "challenge"."status" in ('vorgeschlagen', 'aktiv');--> statement-breakpoint
CREATE UNIQUE INDEX `challenge_owner_uq` ON `challenge` (`id`,`coupling_id`);--> statement-breakpoint
CREATE TABLE `challenge_requirement` (
	`id` text PRIMARY KEY NOT NULL,
	`challenge_id` text NOT NULL,
	`coupling_id` text NOT NULL,
	`person_id` text NOT NULL,
	`required_count` integer,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`server_version` text,
	FOREIGN KEY (`person_id`) REFERENCES `person`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`challenge_id`,`coupling_id`) REFERENCES `challenge`(`id`,`coupling_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "challenge_requirement_payload_check" CHECK(("challenge_requirement"."deleted_at" is null) = ("challenge_requirement"."required_count" is not null) and "challenge_requirement"."required_count" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `challenge_requirement_person_uq` ON `challenge_requirement` (`challenge_id`,`person_id`);--> statement-breakpoint
CREATE TABLE `community_project` (
	`id` text PRIMARY KEY NOT NULL,
	`island_id` text NOT NULL,
	`coupling_id` text NOT NULL,
	`sequence_number` integer NOT NULL,
	`template_key` text NOT NULL,
	`build_need` integer NOT NULL,
	`nature_need` integer NOT NULL,
	`status` text NOT NULL,
	`completed_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`server_version` text,
	FOREIGN KEY (`island_id`,`coupling_id`) REFERENCES `island`(`id`,`coupling_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "community_project_status_check" CHECK("community_project"."status" in ('aktiv', 'fertig')),
	CONSTRAINT "community_project_completed_check" CHECK(("community_project"."status" = 'fertig') = ("community_project"."completed_at" is not null)),
	CONSTRAINT "community_project_need_check" CHECK("community_project"."sequence_number" > 0 and "community_project"."build_need" > 0 and "community_project"."nature_need" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `community_project_active_uq` ON `community_project` (`island_id`) WHERE "community_project"."status" = 'aktiv';--> statement-breakpoint
CREATE UNIQUE INDEX `community_project_sequence_uq` ON `community_project` (`island_id`,`sequence_number`);--> statement-breakpoint
CREATE TABLE `energy_booking` (
	`id` text PRIMARY KEY NOT NULL,
	`person_id` text NOT NULL,
	`type` text NOT NULL,
	`amount` integer NOT NULL,
	`local_date` text NOT NULL,
	`booking_key` text NOT NULL,
	`trigger` text NOT NULL,
	`daily_goal_completion_id` text,
	`island_object_id` text,
	`community_project_id` text,
	`original_booking_id` text,
	`created_at` text NOT NULL,
	`server_version` text,
	FOREIGN KEY (`person_id`) REFERENCES `person`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`daily_goal_completion_id`) REFERENCES `daily_goal_completion`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`island_object_id`) REFERENCES `island_object`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`community_project_id`) REFERENCES `community_project`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`original_booking_id`) REFERENCES `energy_booking`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "energy_booking_type_check" CHECK("energy_booking"."type" in ('daily_goal_credit', 'daily_bonus_credit', 'build_debit', 'upgrade_debit', 'project_contribution_debit', 'counter_booking')),
	CONSTRAINT "energy_booking_amount_check" CHECK(case when "energy_booking"."type" in ('daily_goal_credit', 'daily_bonus_credit') then "energy_booking"."amount" = 1 when "energy_booking"."type" = 'counter_booking' then "energy_booking"."amount" <> 0 else "energy_booking"."amount" < 0 end),
	CONSTRAINT "energy_booking_reference_check" CHECK(("energy_booking"."daily_goal_completion_id" is not null) = ("energy_booking"."type" = 'daily_goal_credit') and ("energy_booking"."island_object_id" is not null) = ("energy_booking"."type" in ('build_debit', 'upgrade_debit')) and ("energy_booking"."community_project_id" is not null) = ("energy_booking"."type" = 'project_contribution_debit') and ("energy_booking"."original_booking_id" is not null) = ("energy_booking"."type" = 'counter_booking'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `energy_booking_key_uq` ON `energy_booking` (`booking_key`);--> statement-breakpoint
CREATE TABLE `island` (
	`id` text PRIMARY KEY NOT NULL,
	`coupling_id` text NOT NULL,
	`state` text NOT NULL,
	`hatched_at` text,
	`time_zone` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`server_version` text,
	FOREIGN KEY (`coupling_id`) REFERENCES `coupling`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "island_state_check" CHECK("island"."state" in ('wartet_auf_rollen', 'aktiv', 'archiviert')),
	CONSTRAINT "island_hatched_check" CHECK(("island"."state" <> 'aktiv' or "island"."hatched_at" is not null) and ("island"."state" <> 'wartet_auf_rollen' or "island"."hatched_at" is null) and ("island"."hatched_at" is null) = ("island"."time_zone" is null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `island_coupling_uq` ON `island` (`coupling_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `island_owner_uq` ON `island` (`id`,`coupling_id`);--> statement-breakpoint
CREATE TABLE `island_event` (
	`id` text PRIMARY KEY NOT NULL,
	`island_id` text NOT NULL,
	`coupling_id` text NOT NULL,
	`type` text NOT NULL,
	`template_key` text,
	`responsible_person_id` text,
	`occasion_key` text NOT NULL,
	`status` text NOT NULL,
	`reward` text,
	`occurred_at` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`server_version` text,
	FOREIGN KEY (`island_id`,`coupling_id`) REFERENCES `island`(`id`,`coupling_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "island_event_type_check" CHECK("island_event"."type" in ('besuch', 'momos_wunsch', 'inselwetter', 'entdeckung', 'momo_geschluepft', 'levelaufstieg', 'gebiet', 'projektabschluss', 'accessoire', 'deko_geschenkt', 'challenge_gestartet', 'challenge_geschafft', 'challenge_abgelaufen', 'challenge_beendet')),
	CONSTRAINT "island_event_status_check" CHECK("island_event"."status" in ('offen', 'erfuellbar', 'abgeschlossen'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `island_event_occasion_uq` ON `island_event` (`island_id`,`occasion_key`);--> statement-breakpoint
CREATE TABLE `island_event_state` (
	`id` text PRIMARY KEY NOT NULL,
	`island_event_id` text NOT NULL,
	`person_id` text NOT NULL,
	`seen_at` text,
	`claimed_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`server_version` text,
	FOREIGN KEY (`island_event_id`) REFERENCES `island_event`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`person_id`) REFERENCES `person`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `island_event_state_person_uq` ON `island_event_state` (`island_event_id`,`person_id`);--> statement-breakpoint
CREATE TABLE `island_field` (
	`id` text PRIMARY KEY NOT NULL,
	`island_id` text NOT NULL,
	`coupling_id` text NOT NULL,
	`field_key` text NOT NULL,
	`owner_person_id` text,
	`created_at` text NOT NULL,
	`server_version` text,
	FOREIGN KEY (`island_id`,`coupling_id`) REFERENCES `island`(`id`,`coupling_id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `island_field_key_uq` ON `island_field` (`island_id`,`field_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `island_field_island_uq` ON `island_field` (`id`,`island_id`);--> statement-breakpoint
CREATE TABLE `island_object` (
	`id` text PRIMARY KEY NOT NULL,
	`island_id` text NOT NULL,
	`coupling_id` text NOT NULL,
	`owner_person_id` text NOT NULL,
	`catalog_key` text NOT NULL,
	`origin` text NOT NULL,
	`level` integer NOT NULL,
	`field_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`server_version` text,
	FOREIGN KEY (`island_id`,`coupling_id`) REFERENCES `island`(`id`,`coupling_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`field_id`,`island_id`) REFERENCES `island_field`(`id`,`island_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "island_object_origin_check" CHECK("island_object"."origin" in ('gebaut', 'besucher', 'entdeckung', 'jahreszeit', 'challenge')),
	CONSTRAINT "island_object_level_check" CHECK("island_object"."level" between 1 and 3)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `island_object_field_uq` ON `island_object` (`field_id`) WHERE "island_object"."field_id" is not null and "island_object"."deleted_at" is null;--> statement-breakpoint
CREATE TABLE `momo_accessory` (
	`id` text PRIMARY KEY NOT NULL,
	`island_id` text NOT NULL,
	`coupling_id` text NOT NULL,
	`catalog_key` text NOT NULL,
	`source_event_id` text NOT NULL,
	`received_at` text NOT NULL,
	`created_at` text NOT NULL,
	`server_version` text,
	FOREIGN KEY (`source_event_id`) REFERENCES `island_event`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`island_id`,`coupling_id`) REFERENCES `island`(`id`,`coupling_id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `momo_accessory_key_uq` ON `momo_accessory` (`island_id`,`catalog_key`);--> statement-breakpoint
CREATE TABLE `momo_outfit` (
	`id` text PRIMARY KEY NOT NULL,
	`island_id` text NOT NULL,
	`coupling_id` text NOT NULL,
	`slot` text NOT NULL,
	`accessory_key` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`server_version` text,
	FOREIGN KEY (`island_id`,`coupling_id`) REFERENCES `island`(`id`,`coupling_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`island_id`,`accessory_key`) REFERENCES `momo_accessory`(`island_id`,`catalog_key`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "momo_outfit_slot_check" CHECK("momo_outfit"."slot" in ('kopf', 'hals'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `momo_outfit_slot_uq` ON `momo_outfit` (`island_id`,`slot`);--> statement-breakpoint
CREATE TABLE `project_contribution` (
	`id` text PRIMARY KEY NOT NULL,
	`community_project_id` text NOT NULL,
	`person_id` text NOT NULL,
	`role` text NOT NULL,
	`amount` integer NOT NULL,
	`energy_booking_id` text NOT NULL,
	`command_id` text NOT NULL,
	`created_at` text NOT NULL,
	`server_version` text,
	FOREIGN KEY (`community_project_id`) REFERENCES `community_project`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`person_id`) REFERENCES `person`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`energy_booking_id`) REFERENCES `energy_booking`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "project_contribution_role_check" CHECK("project_contribution"."role" in ('bauen', 'natur')),
	CONSTRAINT "project_contribution_amount_check" CHECK("project_contribution"."amount" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_contribution_booking_uq` ON `project_contribution` (`energy_booking_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `project_contribution_command_uq` ON `project_contribution` (`command_id`);--> statement-breakpoint
CREATE TABLE `encouragement` (
	`id` text PRIMARY KEY NOT NULL,
	`coupling_id` text NOT NULL,
	`sender_person_id` text NOT NULL,
	`recipient_person_id` text NOT NULL,
	`message_key` text NOT NULL,
	`sent_at` text NOT NULL,
	`local_date` text NOT NULL,
	`time_zone` text NOT NULL,
	`utc_offset_minutes` integer NOT NULL,
	`push_status` text NOT NULL,
	`thanked_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`server_version` text,
	FOREIGN KEY (`coupling_id`) REFERENCES `coupling`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "encouragement_message_key_check" CHECK("encouragement"."message_key" in ('du_schaffst_das', 'ich_denk_an_dich', 'stark_heute', 'gemeinsam_fuer_momo', 'stolz_auf_dich')),
	CONSTRAINT "encouragement_push_status_check" CHECK("encouragement"."push_status" in ('ohne_push', 'ausstehend', 'zugestellt', 'unterdrueckt', 'fehlgeschlagen')),
	CONSTRAINT "encouragement_recipient_check" CHECK("encouragement"."sender_person_id" <> "encouragement"."recipient_person_id")
);
--> statement-breakpoint
CREATE TABLE `notification_setting` (
	`id` text PRIMARY KEY NOT NULL,
	`person_id` text NOT NULL,
	`midday_enabled` integer NOT NULL,
	`midday_time` text NOT NULL,
	`evening_enabled` integer NOT NULL,
	`evening_time` text NOT NULL,
	`tracker_ernaehrung` integer NOT NULL,
	`tracker_wasser` integer NOT NULL,
	`tracker_sport` integer NOT NULL,
	`tracker_gewicht` integer NOT NULL,
	`partner_push_enabled` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`server_version` text,
	FOREIGN KEY (`person_id`) REFERENCES `person`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "notification_setting_time_format_check" CHECK(("notification_setting"."midday_time" glob '[0-2][0-9]:[0-5][0-9]' and "notification_setting"."midday_time" <= '23:59') and ("notification_setting"."evening_time" glob '[0-2][0-9]:[0-5][0-9]' and "notification_setting"."evening_time" <= '23:59')),
	CONSTRAINT "notification_setting_time_order_check" CHECK("notification_setting"."evening_time" > "notification_setting"."midday_time")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notification_setting_person_uq` ON `notification_setting` (`person_id`);--> statement-breakpoint
CREATE TABLE `island_progress` (
	`id` text PRIMARY KEY NOT NULL,
	`island_id` text NOT NULL,
	`coupling_id` text NOT NULL,
	`level` integer NOT NULL,
	`level_need` integer NOT NULL,
	`content` text NOT NULL,
	`data_as_of` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`server_version` text,
	FOREIGN KEY (`island_id`) REFERENCES `island`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`coupling_id`) REFERENCES `coupling`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "island_progress_level_check" CHECK("island_progress"."level" > 0 and "island_progress"."level_need" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `island_progress_island_uq` ON `island_progress` (`island_id`);--> statement-breakpoint
CREATE TABLE `partner_daily_goal_status` (
	`id` text PRIMARY KEY NOT NULL,
	`coupling_id` text NOT NULL,
	`owner_person_id` text NOT NULL,
	`recipient_person_id` text NOT NULL,
	`local_date` text NOT NULL,
	`generation` integer NOT NULL,
	`stage` text NOT NULL,
	`data_as_of` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`server_version` text,
	FOREIGN KEY (`coupling_id`) REFERENCES `coupling`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`recipient_person_id`) REFERENCES `person`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "partner_daily_goal_status_stage_check" CHECK("partner_daily_goal_status"."stage" in ('noch_nichts', 'unterwegs', 'fast_geschafft', 'geschafft')),
	CONSTRAINT "partner_daily_goal_status_shape_check" CHECK("partner_daily_goal_status"."owner_person_id" <> "partner_daily_goal_status"."recipient_person_id" and "partner_daily_goal_status"."generation" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `partner_daily_goal_status_live_uq` ON `partner_daily_goal_status` (`coupling_id`,`owner_person_id`,`recipient_person_id`,`local_date`) WHERE "partner_daily_goal_status"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX `partner_daily_goal_status_generation_uq` ON `partner_daily_goal_status` (`coupling_id`,`owner_person_id`,`recipient_person_id`,`local_date`,`generation`);--> statement-breakpoint
CREATE TABLE `partner_summary` (
	`id` text PRIMARY KEY NOT NULL,
	`coupling_id` text NOT NULL,
	`owner_person_id` text NOT NULL,
	`recipient_person_id` text NOT NULL,
	`area` text NOT NULL,
	`period_from` text NOT NULL,
	`period_to` text NOT NULL,
	`generation` integer NOT NULL,
	`content` text NOT NULL,
	`data_as_of` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`server_version` text,
	FOREIGN KEY (`coupling_id`) REFERENCES `coupling`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`recipient_person_id`) REFERENCES `person`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "partner_summary_area_check" CHECK("partner_summary"."area" in ('ernaehrung', 'wasser', 'sport', 'gewicht')),
	CONSTRAINT "partner_summary_shape_check" CHECK("partner_summary"."owner_person_id" <> "partner_summary"."recipient_person_id" and "partner_summary"."generation" > 0 and "partner_summary"."period_from" <= "partner_summary"."period_to")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `partner_summary_live_uq` ON `partner_summary` (`coupling_id`,`owner_person_id`,`recipient_person_id`,`area`,`period_from`) WHERE "partner_summary"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX `partner_summary_generation_uq` ON `partner_summary` (`coupling_id`,`owner_person_id`,`recipient_person_id`,`area`,`period_from`,`generation`);--> statement-breakpoint
CREATE TABLE `device_state` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `dirty_day` (
	`person_id` text NOT NULL,
	`local_date` text NOT NULL,
	`cause` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`person_id`, `local_date`, `cause`),
	FOREIGN KEY (`person_id`) REFERENCES `person`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "dirty_day_cause_check" CHECK("dirty_day"."cause" in ('eingabe', 'rueckgaengig', 'health_import', 'pull', 'app_oeffnung', 'tagesabschluss', 'planaenderung'))
);
--> statement-breakpoint
CREATE TABLE `outbox` (
	`operation_id` text PRIMARY KEY NOT NULL,
	`sequence` integer NOT NULL,
	`type` text NOT NULL,
	`entity_type` text,
	`entity_id` text,
	`business_key` text,
	`payload` text NOT NULL,
	`known_server_version` text,
	`schema_version` integer NOT NULL,
	`created_at` text NOT NULL,
	`attempt_count` integer NOT NULL,
	`last_attempt_at` text,
	`last_error_code` text,
	CONSTRAINT "outbox_sequence_check" CHECK("outbox"."sequence" > 0),
	CONSTRAINT "outbox_attempt_check" CHECK("outbox"."attempt_count" >= 0 and "outbox"."schema_version" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `outbox_sequence_uq` ON `outbox` (`sequence`);--> statement-breakpoint
CREATE TABLE `sync_cursor` (
	`scope` text PRIMARY KEY NOT NULL,
	`cursor` text,
	`page_token` text,
	`updated_at` text NOT NULL
);
