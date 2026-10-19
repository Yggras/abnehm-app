import { CompleteDailyGoalPayload, EnergyBooking, GrantDailyBonusPayload } from '../src/energy.ts';
import { fixtures } from './define.ts';
import { booking, command, completion, completion2, completion3, islandObject, now, philipp, project, today, weeklyPlanVersion } from './ids.ts';

const base = { id: booking, personId: philipp, localDate: today, createdAt: now } as const;

const dailyGoalCredit = {
  type: 'daily_goal_credit',
  ...base,
  amount: 1,
  bookingKey: `tagesziel:${philipp}:${today}:2`,
  trigger: { dailyGoalCompletionId: completion, slot: 2 },
} as const;

const buildDebit = {
  type: 'build_debit',
  ...base,
  amount: -3,
  bookingKey: command,
  trigger: { commandId: command, islandObjectId: islandObject },
} as const;

export const energyFixtures = {
  EnergyBooking: fixtures(EnergyBooking, {
    valid: {
      'Tagesziel-Gutschrift': dailyGoalCredit,
      'Tagesbonus': {
        type: 'daily_bonus_credit',
        ...base,
        amount: 1,
        bookingKey: `tagesbonus:${philipp}:${today}`,
        trigger: { dailyGoalCompletionIds: [completion, completion2, completion3] },
      },
      'Bauen': buildDebit,
      'Aufwerten auf Stufe 3': {
        type: 'upgrade_debit',
        ...base,
        amount: -9,
        bookingKey: command,
        trigger: { commandId: command, islandObjectId: islandObject, toLevel: 3 },
      },
      'Projekteinzahlung': {
        type: 'project_contribution_debit',
        ...base,
        amount: -5,
        bookingKey: command,
        trigger: { commandId: command, projectId: project },
      },
      'Gegenbuchung einer Ausgabe': {
        type: 'counter_booking',
        ...base,
        id: completion,
        amount: 3,
        bookingKey: `gegenbuchung:${booking}`,
        trigger: { originalBookingId: booking, originalType: 'build_debit', originalAmount: -3 },
      },
    },
    invalid: {
      'Gutschrift über 2': { ...dailyGoalCredit, amount: 2 },
      'Ausgabe mit positivem Betrag': { ...buildDebit, amount: 3 },
      'Ausgabe mit Betrag 0': { ...buildDebit, amount: 0 },
      'Bruchteil': { ...buildDebit, amount: -2.5 },
      'Buchungsschlüssel eines anderen Platzes': { ...dailyGoalCredit, bookingKey: `tagesziel:${philipp}:${today}:1` },
      'Ausgabe mit fremdem Buchungsschlüssel': { ...buildDebit, bookingKey: booking },
      'Gegenbuchung mit gleichem Vorzeichen': {
        type: 'counter_booking',
        ...base,
        amount: -3,
        bookingKey: `gegenbuchung:${booking}`,
        trigger: { originalBookingId: booking, originalType: 'build_debit', originalAmount: -3 },
      },
      'Gegenbuchung einer Gutschrift über 1': {
        type: 'counter_booking',
        ...base,
        amount: -2,
        bookingKey: `gegenbuchung:${booking}`,
        trigger: { originalBookingId: booking, originalType: 'daily_goal_credit', originalAmount: 2 },
      },
      'Tagesbonus aus zweimal derselben Erfüllung': {
        type: 'daily_bonus_credit',
        ...base,
        amount: 1,
        bookingKey: `tagesbonus:${philipp}:${today}`,
        trigger: { dailyGoalCompletionIds: [completion, completion, completion3] },
      },
      'unbekannte Art': { ...buildDebit, type: 'transfer' },
    },
  }),
  CompleteDailyGoalPayload: fixtures(CompleteDailyGoalPayload, {
    valid: {
      'Wasserziel erfüllt': { dailyGoalId: weeklyPlanVersion, localDate: today, slot: 2, baustein: 'wasserziel', completedAt: now },
    },
    invalid: {
      'mit Person aus dem Client': { dailyGoalId: weeklyPlanVersion, personId: philipp, localDate: today, slot: 2, baustein: 'wasserziel', completedAt: now },
      'Platz 0': { dailyGoalId: weeklyPlanVersion, localDate: today, slot: 0, baustein: 'wasserziel', completedAt: now },
      'ohne Zeitpunkt': { dailyGoalId: weeklyPlanVersion, localDate: today, slot: 2, baustein: 'wasserziel' },
    },
  }),
  GrantDailyBonusPayload: fixtures(GrantDailyBonusPayload, {
    valid: { 'Tagesbonus': { localDate: today } },
    invalid: { 'mit Betrag': { localDate: today, amount: 2 }, 'mit Gerätezeit': { localDate: today, grantedAt: now }, 'ohne Tag': {} },
  }),
};
