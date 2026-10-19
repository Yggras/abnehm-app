import { z } from 'zod';

import { BausteinKey, EntityId, Instant, LocalDate } from './base.ts';
import { DailyGoalSlot, dailyGoalKey } from './daily-goals.ts';
import { uuidV5 } from './ids.ts';

// Energiebuchungen (Spezifikation 0, Abschnitt 4): unveränderlich, Bestand = Summe aller Buchungen.
// Jede Variante legt Vorzeichen, Betrag und Buchungsschlüssel fest; andere Kombinationen sind ungültig.

const debit = z.int().negative();

/** Buchungsschlüssel des Tagesbonus: `tagesbonus:<person>:<tag>`. Die Tagesziel-Gutschrift trägt `dailyGoalKey`. */
export function dailyBonusKey(personId: EntityId, localDate: LocalDate): string {
  return `tagesbonus:${personId}:${localDate}`;
}

const bookingNamespace = 'a3c1f0e2-5b7d-4e9a-8c6f-1d2e3f4a5b61';

/**
 * Deterministische ID einer Gutschrift aus ihrem Buchungsschlüssel. Erzeugen zwei Geräte dieselbe
 * Gutschrift offline, tragen beide dieselbe ID; der Server behält genau einen Datensatz.
 */
export function energyBookingId(bookingKey: string): EntityId {
  return EntityId.parse(uuidV5(bookingNamespace, bookingKey));
}

const base = { id: EntityId, personId: EntityId, localDate: LocalDate, bookingKey: z.string(), createdAt: Instant };

const DailyGoalCredit = z
  .strictObject({
    type: z.literal('daily_goal_credit'),
    ...base,
    amount: z.literal(1),
    trigger: z.strictObject({ dailyGoalCompletionId: EntityId, slot: DailyGoalSlot }),
  })
  .refine((b) => b.bookingKey === dailyGoalKey(b.personId, b.localDate, b.trigger.slot), {
    message: 'Buchungsschlüssel muss tagesziel:<person>:<tag>:<platz> sein',
    path: ['bookingKey'],
  });

const DailyBonusCredit = z
  .strictObject({
    type: z.literal('daily_bonus_credit'),
    ...base,
    amount: z.literal(1),
    trigger: z.strictObject({
      /** Die drei Tageszielerfüllungen desselben Tags. */
      dailyGoalCompletionIds: z.tuple([EntityId, EntityId, EntityId]),
    }),
  })
  .refine((b) => b.bookingKey === dailyBonusKey(b.personId, b.localDate), {
    message: 'Buchungsschlüssel muss tagesbonus:<person>:<tag> sein',
    path: ['bookingKey'],
  })
  .refine((b) => new Set(b.trigger.dailyGoalCompletionIds).size === 3, {
    message: 'Drei verschiedene Tageszielerfüllungen',
    path: ['trigger', 'dailyGoalCompletionIds'],
  });

/** Ausgaben tragen die ID ihres fachlichen Spielbefehls als Buchungsschlüssel. */
const bookedUnderCommand = (b: { bookingKey: string; trigger: { commandId: string } }) =>
  b.bookingKey === b.trigger.commandId;
const commandKeyRule = { message: 'Buchungsschlüssel muss die ID des Spielbefehls sein', path: ['bookingKey'] };

const BuildDebit = z
  .strictObject({
    type: z.literal('build_debit'),
    ...base,
    amount: debit,
    trigger: z.strictObject({ commandId: EntityId, islandObjectId: EntityId }),
  })
  .refine(bookedUnderCommand, commandKeyRule);

const UpgradeDebit = z
  .strictObject({
    type: z.literal('upgrade_debit'),
    ...base,
    amount: debit,
    trigger: z.strictObject({
      commandId: EntityId,
      islandObjectId: EntityId,
      toLevel: z.union([z.literal(2), z.literal(3)]),
    }),
  })
  .refine(bookedUnderCommand, commandKeyRule);

const ProjectContributionDebit = z
  .strictObject({
    type: z.literal('project_contribution_debit'),
    ...base,
    amount: debit,
    trigger: z.strictObject({ commandId: EntityId, projectId: EntityId }),
  })
  .refine(bookedUnderCommand, commandKeyRule);

const correctableTypes = [
  'daily_goal_credit',
  'daily_bonus_credit',
  'build_debit',
  'upgrade_debit',
  'project_contribution_debit',
] as const;

/**
 * Korrigiert eine technisch oder fachlich irrtümlich erzeugte Buchung mit exaktem Gegenzeichen.
 * Der Buchungsschlüssel `gegenbuchung:<buchung>` lässt je Buchung höchstens eine Gegenbuchung zu.
 */
const CounterBooking = z
  .strictObject({
    type: z.literal('counter_booking'),
    ...base,
    amount: z.int().refine((amount) => amount !== 0),
    trigger: z.strictObject({
      originalBookingId: EntityId,
      originalType: z.enum(correctableTypes),
      originalAmount: z.int().refine((amount) => amount !== 0),
    }),
  })
  .refine((b) => b.amount === -b.trigger.originalAmount, {
    message: 'Gegenbuchung braucht das exakte Gegenzeichen',
    path: ['amount'],
  })
  .refine((b) => (b.trigger.originalType.endsWith('_credit') ? b.trigger.originalAmount === 1 : b.trigger.originalAmount < 0), {
    message: 'Betrag der ursprünglichen Buchung passt nicht zu ihrer Art',
    path: ['trigger', 'originalAmount'],
  })
  .refine((b) => b.bookingKey === `gegenbuchung:${b.trigger.originalBookingId}`, {
    message: 'Buchungsschlüssel muss gegenbuchung:<buchung> sein',
    path: ['bookingKey'],
  });

/** Unveränderliche Energiebuchung; Art im Feld `type`. */
export const EnergyBooking = z.discriminatedUnion('type', [
  DailyGoalCredit,
  DailyBonusCredit,
  BuildDebit,
  UpgradeDebit,
  ProjectContributionDebit,
  CounterBooking,
]);
export type EnergyBooking = z.infer<typeof EnergyBooking>;

const spendingTypes: ReadonlySet<EnergyBooking['type']> = new Set(['build_debit', 'upgrade_debit', 'project_contribution_debit']);

/** Was eine Buchung zur eigenen Levelhälfte beiträgt: nur Ausgaben, Gegenbuchungen mit Gegenzeichen. */
function levelHalfAmount(booking: EnergyBooking): number {
  const spending = booking.type === 'counter_booking' ? spendingTypes.has(booking.trigger.originalType) : spendingTypes.has(booking.type);
  return spending ? -booking.amount : 0;
}

/**
 * Energiebestand (Summe aller Buchungen) und Beitrag zur eigenen Levelhälfte (Summe der Ausgaben,
 * Gegenbuchungen mit Gegenzeichen). Der Bestand kann mit mehreren Geräten kurz negativ sein.
 */
export function summarizeEnergy(bookings: readonly EnergyBooking[]): { balance: number; levelHalf: number } {
  return bookings.reduce(
    (sum, booking) => ({ balance: sum.balance + booking.amount, levelHalf: sum.levelHalf + levelHalfAmount(booking) }),
    { balance: 0, levelHalf: 0 },
  );
}

/** Angezeigter Bestand: Einen negativen Zwischenstand zeigt die Oberfläche als 0. */
export function shownEnergy(balance: number): number {
  return Math.max(0, balance);
}

/**
 * Nutzlast von `completeDailyGoal`: Tageszielerfüllung plus `+1`-Gutschrift als ein Fachbefehl. Person
 * kommt aus der Sitzung, IDs und Schlüssel leiten App und Server aus Person, Tag und Platz ab.
 */
export const CompleteDailyGoalPayload = z.strictObject({
  dailyGoalId: EntityId,
  localDate: LocalDate,
  slot: DailyGoalSlot,
  baustein: BausteinKey,
  /** Erstmaliger Erfüllungszeitpunkt auf dem Gerät. */
  completedAt: Instant,
});
export type CompleteDailyGoalPayload = z.infer<typeof CompleteDailyGoalPayload>;

/** Nutzlast von `grantDailyBonus`: `+1`-Tagesbonus, sobald alle drei Tagesziele des Tags erfüllt sind. */
export const GrantDailyBonusPayload = z.strictObject({ localDate: LocalDate, grantedAt: Instant });
export type GrantDailyBonusPayload = z.infer<typeof GrantDailyBonusPayload>;
