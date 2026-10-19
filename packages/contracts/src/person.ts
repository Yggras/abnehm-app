import { z } from 'zod';

import { DisplayName, EntityId, Instant, LocalDate, ServerVersion, TimeZone } from './base.ts';

// Person (Spezifikation 0, Abschnitt 8; Felder aus Spezifikation 1, Abschnitt 2). Konto-Verweis,
// Serverfelder und `time_zone` sind nie Teil des allgemeinen Upserts: Die Zeitzone ändert
// ausschließlich `updatePersonTimeZone`, damit ein veralteter Datensatz sie nie zurücksetzt.

const bodyFields = {
  calculationSex: z.enum(['maennlich', 'weiblich']),
  birthDate: LocalDate,
  /** Eingabegrenzen 120–230 cm (Designwert aus Spezifikation 1, Abschnitt 3). */
  heightCm: z.int().min(120).max(230),
  activityLevel: z.enum(['wenig_aktiv', 'maessig_aktiv', 'aktiv']),
  pregnantOrBreastfeeding: z.boolean(),
  knownEatingDisorder: z.boolean(),
  disclaimerAcceptedAt: Instant,
};

const nullable = <S extends Record<string, z.ZodType>>(shape: S) =>
  Object.fromEntries(Object.entries(shape).map(([key, schema]) => [key, schema.nullable()])) as {
    [K in keyof S]: z.ZodNullable<S[K]>;
  };

const upsertFields = {
  id: EntityId,
  displayName: DisplayName,
  ...nullable(bodyFields),
  onboardingStatus: z.enum(['begonnen', 'abgeschlossen']),
  onboardingCompletedAt: Instant.nullable(),
  /** Zielgewicht, dessen Erreichen bereits erkannt wurde; beide Felder gemeinsam gesetzt. */
  goalWeightReachedG: z.int().positive().nullable(),
  goalWeightReachedAt: Instant.nullable(),
};

type PersonFields = { [K in keyof typeof upsertFields]: z.output<(typeof upsertFields)[K]> };

/** Die Regeln zwischen den Personenfeldern, gleich für Upsert und kanonischen Datensatz. */
function withPersonRules<S extends z.ZodType<PersonFields>>(schema: S) {
  return schema
    .refine((person) => (person.onboardingStatus === 'abgeschlossen') === (person.onboardingCompletedAt !== null), {
      message: 'Abschlusszeitpunkt genau bei abgeschlossenem Onboarding',
      path: ['onboardingCompletedAt'],
    })
    .refine(
      (person) =>
        person.onboardingStatus === 'begonnen' || Object.keys(bodyFields).every((key) => person[key as keyof typeof bodyFields] !== null),
      { message: 'Abgeschlossenes Onboarding verlangt alle Körper- und Sicherheitsangaben' },
    )
    .refine((person) => (person.goalWeightReachedG === null) === (person.goalWeightReachedAt === null), {
      message: 'Erreichtes Zielgewicht und Zeitpunkt nur gemeinsam',
      path: ['goalWeightReachedAt'],
    });
}

/**
 * Vollständige Nutzlast des Person-Upserts. Bis zum Abschluss von Onboarding-Schritt 8 dürfen die
 * Körper- und Sicherheitsangaben fehlen; ein abgeschlossenes Onboarding verlangt alle.
 */
export const PersonUpsert = withPersonRules(z.strictObject(upsertFields));
export type PersonUpsert = z.infer<typeof PersonUpsert>;

/** Nutzlast des Fachbefehls `updatePersonTimeZone`: ausschließlich die aktuelle IANA-Zone. */
export const UpdatePersonTimeZone = z.strictObject({ timeZone: TimeZone });
export type UpdatePersonTimeZone = z.infer<typeof UpdatePersonTimeZone>;

/** Kanonisches Ergebnis von `updatePersonTimeZone`; die Person stammt aus der Sitzung. */
export const UpdatePersonTimeZoneResult = z.strictObject({
  personId: EntityId,
  timeZone: TimeZone,
  serverVersion: ServerVersion,
});
export type UpdatePersonTimeZoneResult = z.infer<typeof UpdatePersonTimeZoneResult>;

/**
 * Kanonischer Datensatz der Person im Sync (`data` eines `CanonicalRecord` vom Typ `person`): die
 * Upsert-Felder samt Konto-Verweis, aktueller Zeitzone und Zeitpunkten, wie sie der Server führt.
 */
export const PersonRecord = withPersonRules(
  z.strictObject({ ...upsertFields, accountId: EntityId, timeZone: TimeZone, createdAt: Instant, updatedAt: Instant }),
);
export type PersonRecord = z.infer<typeof PersonRecord>;
