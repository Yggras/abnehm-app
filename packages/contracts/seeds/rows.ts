import type { SeedEntity } from './build.ts';
import { seedClock, seedUtcOffsetMinutes } from './ids.ts';
import type { BausteinKey } from '../src/base.ts';

// Zeilenhelfer der Bereichsbeiträge: wiederkehrende Zeilenformen der Spezifikationen 1–3 in der
// kanonischen Form des Manifests. Der Baukasten (`build.ts`) kennt sie nicht; er setzt nur zusammen.

/** Tagesbezug einer Zeile: lokaler Tag in der Zone der festen Uhr samt Offset. */
export const seedDay = (localDate: string) => ({ local_date: localDate, time_zone: seedClock.timeZone, utc_offset_minutes: seedUtcOffsetMinutes });

/** Zeitstempel einer veränderlichen Zeile, die seit ihrer Anlage unverändert und nicht gelöscht ist. */
export const seedCreated = (at: string) => ({ created_at: at, updated_at: at, deleted_at: null });

/** Herkunft eines manuell erfassten Sport- oder Gewichtseintrags (Spezifikation 3). */
export const seedManualOrigin = { origin: 'manuell', external_key: null, source_app_id: null, source_app_name: null, hidden_at: null } as const;

export type SeedWeeklyPlan = Readonly<Record<string, readonly [BausteinKey, BausteinKey, BausteinKey]>>;

/** Wochenplanversion einer Person samt ihrer sieben Tage (Spezifikation 1). */
export function seedWeeklyPlan(options: { id: string; personId: string; validFrom: string; createdAt: string; plan: SeedWeeklyPlan }): SeedEntity {
  return {
    table: 'weekly_plan_version',
    // Seit #128 beim Sync angemeldet: Die Fassung steht im Änderungsprotokoll.
    entityType: 'weekly_plan_version',
    ownerPersonId: options.personId,
    row: { id: options.id, person_id: options.personId, valid_from: options.validFrom, ...seedCreated(options.createdAt) },
    children: {
      weekly_plan_day: Object.entries(options.plan).map(([weekday, [baustein1, baustein2, baustein3]]) => ({
        weekly_plan_version_id: options.id,
        person_id: options.personId,
        weekday,
        baustein_1: baustein1,
        baustein_2: baustein2,
        baustein_3: baustein3,
      })),
    },
  };
}

/** Die drei Tagesziele eines Tags nach dem Wochenplantag, mit den Schwellen aus der Zielversion (Spezifikation 1). */
export function seedDailyGoals(options: {
  personId: string;
  ids: readonly [string, string, string];
  localDate: string;
  dayEndsAt: string;
  createdAt: string;
  bausteine: readonly [BausteinKey, BausteinKey, BausteinKey];
  thresholds: Readonly<Partial<Record<BausteinKey, Readonly<Record<string, number>>>>>;
}): SeedEntity[] {
  return options.bausteine.map((baustein, index) => {
    const slot = index + 1;
    return {
      table: 'daily_goal',
      ownerPersonId: options.personId,
      row: {
        id: options.ids[index] as string,
        person_id: options.personId,
        ...seedDay(options.localDate),
        slot,
        baustein,
        snapshot: {
          type: baustein,
          personId: options.personId,
          localDate: options.localDate,
          slot,
          timeZone: seedClock.timeZone,
          dayEndsAt: options.dayEndsAt,
          ...options.thresholds[baustein],
        },
        day_ends_at: options.dayEndsAt,
        created_at: options.createdAt,
      },
    };
  });
}
