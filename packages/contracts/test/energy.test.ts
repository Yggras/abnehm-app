import { describe, expect, it } from 'vitest';

import { dailyGoalCompletionId, dailyGoalKey } from '../src/daily-goals.ts';
import { dailyBonusKey, energyBookingId, EnergyBooking, shownEnergy, summarizeEnergy } from '../src/energy.ts';
import { energyFixtures } from '../fixtures/energy.ts';
import { booking, command, completion, completion2, completion3, islandObject, now, philipp, project, today } from '../fixtures/ids.ts';

// Nachweis für #105: Buchungsschlüssel, deterministische IDs und die Summenbildung (Spezifikation 0, Abschnitt 4).

describe('fachliche Schlüssel und IDs', () => {
  it('bildet die Schlüssel aus Person, Tag und Platz', () => {
    expect(dailyGoalKey(philipp as never, today as never, 2)).toBe(`tagesziel:${philipp}:${today}:2`);
    expect(dailyBonusKey(philipp as never, today as never)).toBe(`tagesbonus:${philipp}:${today}`);
  });

  it('leitet stabile, verschiedene UUIDs ab: Erfüllung und Gutschrift desselben Platzes kollidieren nicht', () => {
    const key = dailyGoalKey(philipp as never, today as never, 2);
    const ids = [dailyGoalCompletionId(key), energyBookingId(key), energyBookingId(dailyBonusKey(philipp as never, today as never))];
    expect(new Set(ids).size).toBe(3);
    expect(dailyGoalCompletionId(key)).toBe(dailyGoalCompletionId(`tagesziel:${philipp}:${today}:2`));
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

const base = { personId: philipp, localDate: today, createdAt: now };
const credit = (slot: 1 | 2 | 3) =>
  EnergyBooking.parse({
    type: 'daily_goal_credit', ...base, id: [completion, completion2, completion3][slot - 1], amount: 1,
    bookingKey: `tagesziel:${philipp}:${today}:${slot}`, trigger: { dailyGoalCompletionId: completion, slot },
  });
const bonus = EnergyBooking.parse(energyFixtures.EnergyBooking.valid['Tagesbonus']);
const build = EnergyBooking.parse({ type: 'build_debit', ...base, id: booking, amount: -3, bookingKey: command,
  trigger: { commandId: command, islandObjectId: islandObject } });
const contribution = EnergyBooking.parse({ type: 'project_contribution_debit', ...base, id: project, amount: -2,
  bookingKey: project, trigger: { commandId: project, projectId: project } });
const counterOf = (original: EnergyBooking) => EnergyBooking.parse({ type: 'counter_booking', ...base, id: islandObject,
  amount: -original.amount, bookingKey: `gegenbuchung:${original.id}`,
  trigger: { originalBookingId: original.id, originalType: original.type, originalAmount: original.amount } });

describe('summarizeEnergy', () => {
  it('ohne Buchungen ist alles 0', () => {
    expect(summarizeEnergy([])).toEqual({ balance: 0, levelHalf: 0 });
  });

  it('Bestand ist die Summe aller Buchungen; nur Ausgaben zählen für die Levelhälfte', () => {
    expect(summarizeEnergy([credit(1), credit(2), credit(3), bonus, build, contribution])).toEqual({ balance: -1, levelHalf: 5 });
  });

  it('eine Gegenbuchung wirkt mit Gegenzeichen auf Bestand und Levelhälfte', () => {
    expect(summarizeEnergy([credit(1), credit(2), credit(3), bonus, build, counterOf(build)])).toEqual({ balance: 4, levelHalf: 0 });
    expect(summarizeEnergy([credit(1), counterOf(credit(1))])).toEqual({ balance: 0, levelHalf: 0 });
  });
});

describe('shownEnergy', () => {
  it('zeigt einen negativen Mehrgeräte-Zwischenstand als 0, sonst den Bestand', () => {
    expect(shownEnergy(-2)).toBe(0);
    expect(shownEnergy(0)).toBe(0);
    expect(shownEnergy(7)).toBe(7);
  });
});
