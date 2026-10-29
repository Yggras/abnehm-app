import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { EntityId, type Instant, LocalDate, Weekday } from '@abnehm/contracts/base';
import { ActivityLevel, CalculationSex } from '@abnehm/contracts/person';
import { Pace } from '@abnehm/contracts/ports';

import type { ReadContext, TransactionContext } from '../local-db';
import { deviceState } from '../local-db/schema';
import { sqliteOf } from '../local-db/sqlite';

// Lokaler Onboarding-Entwurf (Spezifikation 1, Abschnitt 9): die Eingaben der Schritte 3–8, bis
// Schritt 8 den Plan speichert. Er ist Gerätezustand der Kontodatenbank (`device_state`) und wird nicht
// synchronisiert. Die Schritte prüfen ihre Eingaben mit den Grenzen des Zielrechners, bevor sie sie
// ablegen; der Entwurf prüft nur Form und Einheit.

const amount = z.int().positive();

export const onboardingDraftSchema = z.strictObject({
  // Schritt 3: Körperdaten
  calculationSex: CalculationSex.optional(),
  birthDate: LocalDate.optional(),
  heightCm: amount.optional(),
  weightG: amount.optional(),
  /** Einmal in Schritt 3 erzeugt; mit ihr speichert Schritt 8 das Startgewicht ohne Dublette. */
  startWeightEntryId: EntityId.optional(),
  // Schritt 4: Sicherheits-Check
  pregnantOrBreastfeeding: z.boolean().optional(),
  knownEatingDisorder: z.boolean().optional(),
  // Schritt 5: Aktivitätsstufe
  activityLevel: ActivityLevel.optional(),
  // Schritt 6: Zielgewicht und Tempo
  goalWeightG: amount.optional(),
  pace: Pace.optional(),
  // Schritt 7: Ergebnis
  manualBudgetKcal: amount.optional(),
  waterTargetMl: amount.optional(),
  weeklySportTargetMinutes: amount.optional(),
  // Schritt 8: Wochenplan
  sportDays: z.array(Weekday).optional(),
  weighDay: Weekday.optional(),
});
export type OnboardingDraft = z.infer<typeof onboardingDraftSchema>;

/** Ein Feld mit `undefined` löscht seinen Wert im Entwurf. */
export type OnboardingDraftChange = Partial<{ [K in keyof OnboardingDraft]: OnboardingDraft[K] | undefined }>;

const draftKey = 'onboarding_draft';

/** Der Entwurf des Geräts; leer, wenn es keinen gibt oder ein gespeicherter nicht mehr passt. */
export function readOnboardingDraft(tx: ReadContext): OnboardingDraft {
  const row = sqliteOf(tx).select({ value: deviceState.value }).from(deviceState).where(eq(deviceState.key, draftKey)).get();
  return onboardingDraftSchema.safeParse(row?.value ?? {}).data ?? {};
}

/** Übernimmt die Änderung in den Entwurf und gibt ihn zurück; ungültige Werte werfen, bevor etwas geschrieben wird. */
export function updateOnboardingDraft(tx: TransactionContext, change: OnboardingDraftChange, at: Instant): OnboardingDraft {
  const draft = onboardingDraftSchema.parse({ ...readOnboardingDraft(tx), ...change });
  // JSON kennt kein `undefined`: Gelöschte Felder fehlen danach ganz.
  const value = JSON.parse(JSON.stringify(draft)) as OnboardingDraft;
  sqliteOf(tx)
    .insert(deviceState)
    .values({ key: draftKey, value, updatedAt: at })
    .onConflictDoUpdate({ target: deviceState.key, set: { value, updatedAt: at } })
    .run();
  return value;
}
