import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { EntityId, LocalDate, type AreaKey } from '@abnehm/contracts/base';
import { partnerSummaryPeriod, type PartnerSummaryContent } from '@abnehm/contracts/partner';

import type { DbExecutor } from '../src/database.ts';
import { sportEntry, waterEntry, weightEntry } from '../src/db/schema/index.ts';
import type { PartnerSummaryProjector } from '../src/partner-projections/projector.ts';
import { trackerPartnerSummaryProjectors } from '../src/trackers/partner-summaries.ts';
import { createTestBackend } from './support/app.ts';
import { personWithSession } from './support/authorization.ts';
import { conformanceToday, partnerProjectorConformanceCases } from './support/partner-projector-conformance.ts';
import { testPlans, testRecorders, type TestPlan } from './support/partner-projectors.ts';

// Die Partner-Projectors für Wasser, Sport und Gewicht (#181; Spezifikation 3, Abschnitt 7;
// Spezifikation 0, Abschnitt 5). Das Konformitäts-Testkit aus #106 prüft Zähl-, Rundungs-, Deckelungs-
// und Keine-Daten-Regeln samt „keine zusätzlichen Partnerwerte“. Die Fälle darunter decken ab, was nur
// die Tracker-Regeln kennen: ersetzte, reaktivierte und wieder zählende Einheiten, den Trend samt
// Vorgeschichte vor dem 14-Tage-Zeitraum und das Ziel aus der Zielversion von heute.


describe('Konformitäts-Testkit mit den Tracker-Projectors', () => {
  const harnesses = [
    partnerProjectorConformanceCases('wasser', { projector: (ports) => trackerPartnerSummaryProjectors(ports).wasser, record: testRecorders.wasser }),
    partnerProjectorConformanceCases('sport', { projector: (ports) => trackerPartnerSummaryProjectors(ports).sport, record: testRecorders.sport }),
    partnerProjectorConformanceCases('gewicht', { projector: (ports) => trackerPartnerSummaryProjectors(ports).gewicht, record: testRecorders.gewicht }),
  ];
  for (const { name, run } of harnesses.flat()) it(name, run);
});

const day = (offset: number) => LocalDate.parse(new Date(Date.parse(`${conformanceToday}T00:00:00.000Z`) + offset * 86_400_000).toISOString().slice(0, 10));
const at = (localDate: string, time = '06:00') => new Date(`${localDate}T${time}:00.000Z`);
const stamps = { createdAt: at(conformanceToday), updatedAt: at(conformanceToday), serverVersion: 1n };
const dayOf = (localDate: string) => ({ localDate, timeZone: 'Europe/Berlin', utcOffsetMinutes: 120 });

type Rows = Readonly<{
  sport(row: { localDate: string; minutes: number; imported?: boolean; hidden?: boolean; deleted?: boolean; replacedBy?: string; reactivated?: boolean }): Promise<string>;
  weight(row: { localDate: string; weightG: number; time?: string; imported?: boolean; hidden?: boolean; deleted?: boolean }): Promise<void>;
  water(row: { localDate: string; amountMl: number; deleted?: boolean }): Promise<void>;
}>;

/** Rechnet die Zusammenfassung eines Bereichs für eine frische Eigentümerin mit dem Plan `plan`. */
async function project<A extends 'wasser' | 'sport' | 'gewicht'>(
  area: A,
  arrange: (rows: Rows) => Promise<void>,
  { plans: planVersions = [{ validFrom: '2026-01-01', waterTargetMl: 2000, weeklySportTargetMinutes: 150 }] }: { plans?: readonly TestPlan[] } = {},
): Promise<PartnerSummaryContent<A> | null> {
  const backend = await createTestBackend();
  const owner = await personWithSession(backend, `eigentuemerin-${randomUUID()}@example.test`, 'Anna');
  const plans = testPlans();
  for (const plan of planVersions) plans.set(owner.personId, plan);
  return backend.database.db.transaction(async (tx) => {
    await arrange(rowsOf(tx, owner.personId));
    // Zeitraum und Inhalt passen je Bereich zusammen; über die Union verfolgt TypeScript das nicht.
    const projector: PartnerSummaryProjector<A> = trackerPartnerSummaryProjectors({ planReader: plans.planReader })[area];
    return projector.project(tx, { ownerPersonId: EntityId.parse(owner.personId), period: partnerSummaryPeriod(area, conformanceToday), today: conformanceToday });
  });
}

function rowsOf(tx: DbExecutor, personId: string): Rows {
  const deletedAt = (deleted?: boolean) => (deleted === true ? at(conformanceToday, '09:00') : null);
  return {
    async sport({ localDate, minutes, imported = false, hidden = false, deleted, replacedBy, reactivated = false }) {
      const id = randomUUID();
      const origin = imported
        ? { origin: 'apple_health', externalKey: `workout-${id}`, sourceAppId: 'com.fitbit.FitbitMobile', sourceAppName: 'Fitbit', hiddenAt: hidden ? at(conformanceToday, '08:00') : null }
        : { origin: 'manuell', replacedByEntryId: replacedBy ?? null, reactivatedAt: reactivated ? at(conformanceToday, '08:30') : null };
      await tx.insert(sportEntry).values({ id, personId, activityType: 'laufen', startedAt: at(localDate), durationMinutes: minutes, ...origin,
        ...dayOf(localDate), ...stamps, deletedAt: deletedAt(deleted) });
      return id;
    },
    async weight({ localDate, weightG, time = '06:00', imported = false, hidden = false, deleted }) {
      const id = randomUUID();
      const origin = imported
        ? { origin: 'health_connect', externalKey: `weight-${id}`, sourceAppId: 'com.fitbit.FitbitMobile', sourceAppName: 'Fitbit', hiddenAt: hidden ? at(conformanceToday, '08:00') : null }
        : { origin: 'manuell' };
      await tx.insert(weightEntry).values({ id, personId, weightG, measuredAt: at(localDate, time), ...origin, ...dayOf(localDate), ...stamps, deletedAt: deletedAt(deleted) });
    },
    async water({ localDate, amountMl, deleted }) {
      await tx.insert(waterEntry).values({ id: randomUUID(), personId, amountMl, origin: 'manuell', loggedAt: at(localDate), ...dayOf(localDate), ...stamps,
        deletedAt: deletedAt(deleted) });
    },
  };
}

describe('Wasser', () => {
  it('zählt gelöschte Einträge nicht und nimmt das Wasserziel des Tags', async () => {
    const content = await project('wasser', async (rows) => {
      await rows.water({ localDate: conformanceToday, amountMl: 600 });
      await rows.water({ localDate: conformanceToday, amountMl: 900, deleted: true });
    }, { plans: [{ validFrom: '2026-01-01', waterTargetMl: 2000, weeklySportTargetMinutes: 150 }, { validFrom: conformanceToday, waterTargetMl: 1200, weeklySportTargetMinutes: 150 }] });

    // 100 × 600 ÷ 1200 mit dem Ziel ab heute; mit dem alten Ziel wären es 30.
    expect(content).toEqual({ progressPercent: 50 });
  });

  it('hat ohne gültige Zielversion noch nichts zu zeigen', async () => {
    const content = await project('wasser', (rows) => rows.water({ localDate: conformanceToday, amountMl: 600 }), { plans: [] });

    expect(content).toBeNull();
  });
});

describe('Sport', () => {
  it('zählt weder ersetzte manuelle Einheiten noch ausgeblendete Importe oder gelöschte Einträge', async () => {
    const content = await project('sport', async (rows) => {
      await rows.sport({ localDate: day(-2), minutes: 30 });
      const workout = await rows.sport({ localDate: day(-1), minutes: 45, imported: true });
      await rows.sport({ localDate: day(-1), minutes: 40, replacedBy: workout });
      await rows.sport({ localDate: conformanceToday, minutes: 25, imported: true, hidden: true });
      await rows.sport({ localDate: conformanceToday, minutes: 50, deleted: true });
    });

    expect(content).toEqual({ countedMinutes: 75, weeklyTargetMinutes: 150 });
  });

  it('zählt eine reaktivierte Einheit und eine, deren ersetzender Import nicht mehr zählt', async () => {
    const content = await project('sport', async (rows) => {
      const kept = await rows.sport({ localDate: day(-1), minutes: 45, imported: true });
      await rows.sport({ localDate: day(-1), minutes: 40, replacedBy: kept, reactivated: true });
      const hidden = await rows.sport({ localDate: conformanceToday, minutes: 20, imported: true, hidden: true });
      await rows.sport({ localDate: conformanceToday, minutes: 15, replacedBy: hidden });
    });

    expect(content).toEqual({ countedMinutes: 45 + 40 + 15, weeklyTargetMinutes: 150 });
  });

  it('kennt den ersetzenden Import auch, wenn er im Nachbartag vor der Woche liegt', async () => {
    // Montag ist der 12.10.; der Import vom Sonntag davor ist ausgeblendet, also zählt die ersetzte Einheit wieder.
    const content = await project('sport', async (rows) => {
      const sunday = await rows.sport({ localDate: day(-3), minutes: 60, imported: true, hidden: true });
      await rows.sport({ localDate: day(-2), minutes: 35, replacedBy: sunday });
      const counting = await rows.sport({ localDate: day(-3), minutes: 30, imported: true });
      await rows.sport({ localDate: day(-2), minutes: 20, replacedBy: counting });
    });

    expect(content).toEqual({ countedMinutes: 35, weeklyTargetMinutes: 150 });
  });

  it('hat ohne gültige Zielversion noch nichts zu zeigen', async () => {
    const content = await project('sport', (rows) => rows.sport({ localDate: conformanceToday, minutes: 30 }).then(() => {}), { plans: [] });

    expect(content).toBeNull();
  });

  it('nimmt das Sportwochenziel aus der Zielversion von heute, nicht aus einer späteren dieser Woche', async () => {
    const content = await project('sport', (rows) => rows.sport({ localDate: conformanceToday, minutes: 30 }).then(() => {}), {
      plans: [
        { validFrom: '2026-01-01', waterTargetMl: 2000, weeklySportTargetMinutes: 150 },
        { validFrom: day(2), waterTargetMl: 2000, weeklySportTargetMinutes: 210 },
      ],
    });

    expect(content).toEqual({ countedMinutes: 30, weeklyTargetMinutes: 150 });
  });
});

describe('Gewicht', () => {
  it('rechnet den Trend samt Vorgeschichte vor dem Zeitraum; spätere Messungen eines Tags und ausgeblendete Importe zählen nicht', async () => {
    const content = await project('gewicht', async (rows) => {
      await rows.weight({ localDate: day(-16), weightG: 80_000 });
      await rows.weight({ localDate: day(-14), weightG: 80_000 });
      await rows.weight({ localDate: day(-7), weightG: 79_000 });
      await rows.weight({ localDate: day(-7), weightG: 60_000, imported: true, hidden: true });
      await rows.weight({ localDate: day(-5), weightG: 50_000, deleted: true });
      await rows.weight({ localDate: conformanceToday, weightG: 78_500, time: '05:00' });
      await rows.weight({ localDate: conformanceToday, weightG: 70_000, time: '18:00' });
    });

    // Trend: 80 000 → 80 000 (D−14) → 79 478,3 (D−7) → 78 967,9 (D); 78 968 − 80 000 = −1 032 g → −1,0 kg.
    // Ohne Vorgeschichte wäre der Bezug das erste Tagesgewicht im Zeitraum (79 000) und das Ergebnis −0,3 kg.
    expect(content).toEqual({ changeKg: -1, direction: 'sinkend' });
  });

  it('zählt importierte Waagenwerte wie manuelle', async () => {
    const content = await project('gewicht', async (rows) => {
      await rows.weight({ localDate: day(-10), weightG: 80_000, imported: true });
      await rows.weight({ localDate: day(-5), weightG: 80_000 });
      await rows.weight({ localDate: conformanceToday, weightG: 80_000, imported: true });
    });

    expect(content).toEqual({ changeKg: 0, direction: 'stabil' });
  });
});

// Dass die Projectors nur die Tabellen ihres Bereichs lesen und den `PlanReader` als Port bekommen, erzwingt
// `npm run lint` (Importgrenze in `eslint.config.js`, belegt in `test/lint-grenzen.test.ts`).
describe('Anmeldung', () => {
  it('meldet je Bereich genau einen Projector an', () => {
    const projectors = Object.entries(trackerPartnerSummaryProjectors({ planReader: testPlans().planReader }));

    expect(projectors.map(([key, projector]) => [key, projector.area])).toEqual([['wasser', 'wasser'], ['sport', 'sport'], ['gewicht', 'gewicht']]);
  });
});
