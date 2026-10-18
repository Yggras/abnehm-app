import { z } from 'zod';

import { EntityId, Instant, LocalDate } from './base.ts';
import { DailyGoalSlot } from './daily-goals.ts';

// Energiebuchungen (Spezifikation 0, Abschnitt 4): unveränderlich, Bestand = Summe aller Buchungen.
// Jede Variante legt Vorzeichen, Betrag und Buchungsschlüssel fest; andere Kombinationen sind ungültig.

const debit = z.int().negative();

const base = { id: EntityId, personId: EntityId, localDate: LocalDate, bookingKey: z.string(), createdAt: Instant };

const DailyGoalCredit = z
  .strictObject({
    type: z.literal('daily_goal_credit'),
    ...base,
    amount: z.literal(1),
    trigger: z.strictObject({ dailyGoalCompletionId: EntityId, slot: DailyGoalSlot }),
  })
  .refine((b) => b.bookingKey === `tagesziel:${b.personId}:${b.localDate}:${b.trigger.slot}`, {
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
  .refine((b) => b.bookingKey === `tagesbonus:${b.personId}:${b.localDate}`, {
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
      originalType: z.enum(['daily_goal_credit', 'daily_bonus_credit', 'build_debit', 'upgrade_debit', 'project_contribution_debit']),
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
