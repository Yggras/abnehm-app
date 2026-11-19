import { randomUUID } from 'node:crypto';

import { expect } from 'vitest';

import { EntityId, LocalDate, type AreaKey, type MealKey } from '@abnehm/contracts/base';
import { partnerSummaryPeriod, type PartnerSummaryContent } from '@abnehm/contracts/partner';
import type { PlanReader } from '@abnehm/contracts/ports';

import { partnerResponse } from '../../src/authorization/authorization.ts';
import type { DbExecutor } from '../../src/database.ts';
import type { PartnerSummaryProjector, ReaderPort } from '../../src/partner-projections/projector.ts';
import { createTestBackend } from './app.ts';
import { personWithSession } from './authorization.ts';
import { testPlans, type TestPlan } from './partner-projectors.ts';

// Konformitäts-Testkit für Partner-Projectors (Spezifikation 0, Abschnitt 5; #106). Ein Bereich
// übergibt seinen Projector und Schreiber für seine Daten; das Kit prüft die Zähl-, Rundungs-,
// Deckelungs- und Keine-Daten-Regeln seines Bereichs und schickt jedes Ergebnis durch dieselbe
// Prüfung der Partnerantworten wie die Autorisierung, sodass zusätzliche Partnerwerte auffallen.
// Registriert wird mit `it(case.name, case.run)`. Jeder Fall läuft in einer frischen Datenbank.

/** Der aktuelle lokale Tag aller Fälle, ein Mittwoch (Spezifikation 0, Abschnitt 12). */
export const conformanceToday = LocalDate.parse('2026-10-14');

/** Wie ein Bereich seine Daten anlegt; `counted: false` ist ein Eintrag, der nicht zählen darf. */
export type ConformanceRecorders = {
  ernaehrung: { meal(tx: DbExecutor, ownerPersonId: string, localDate: string, meal: MealKey, options?: { deleted?: boolean }): Promise<void> };
  wasser: { water(tx: DbExecutor, ownerPersonId: string, localDate: string, amountMl: number): Promise<void> };
  sport: { session(tx: DbExecutor, ownerPersonId: string, localDate: string, durationMinutes: number, options?: { counted?: boolean }): Promise<void> };
  gewicht: { weighIn(tx: DbExecutor, ownerPersonId: string, localDate: string, weightG: number): Promise<void> };
};

export type ProjectorHarness<A extends AreaKey> = Readonly<{
  /** Baut den Projector mit den Reader-Ports des Kits. */
  projector(ports: { planReader: ReaderPort<PlanReader> }): PartnerSummaryProjector<A>;
  record: ConformanceRecorders[A];
}>;

type Case<A extends AreaKey> = Readonly<{
  name: string;
  plan?: Partial<TestPlan>;
  arrange(record: ConformanceRecorders[A], tx: DbExecutor, owner: string): Promise<void>;
  expect(content: PartnerSummaryContent<A>): void;
}>;

const day = (offset: number) => LocalDate.parse(new Date(Date.parse(`${conformanceToday}T00:00:00.000Z`) + offset * 86_400_000).toISOString().slice(0, 10));
const nothing = async () => {};
const is = <T>(expected: T) => (content: T) => expect(content).toEqual(expected);

const cases: { [A in AreaKey]: readonly Case<A>[] } = {
  ernaehrung: [
    { name: 'ohne Einträge 0 Mahlzeiten', arrange: nothing, expect: is({ recordedMealCategories: 0 }) },
    {
      name: 'zählt verschiedene Mahlzeiten, nicht Einträge',
      arrange: async (record, tx, owner) => {
        await record.meal(tx, owner, conformanceToday, 'fruehstueck');
        await record.meal(tx, owner, conformanceToday, 'fruehstueck');
        await record.meal(tx, owner, conformanceToday, 'mittagessen');
      },
      expect: is({ recordedMealCategories: 2 }),
    },
    {
      name: 'zählt höchstens die vier Mahlzeiten',
      arrange: async (record, tx, owner) => {
        for (const meal of ['fruehstueck', 'mittagessen', 'abendessen', 'snacks', 'snacks'] as const) await record.meal(tx, owner, conformanceToday, meal);
      },
      expect: is({ recordedMealCategories: 4 }),
    },
    {
      name: 'zählt weder gelöschte Einträge noch andere Tage',
      arrange: async (record, tx, owner) => {
        await record.meal(tx, owner, conformanceToday, 'abendessen', { deleted: true });
        await record.meal(tx, owner, day(-1), 'mittagessen');
        await record.meal(tx, owner, day(1), 'snacks');
      },
      expect: is({ recordedMealCategories: 0 }),
    },
  ],
  wasser: [
    { name: 'ohne Einträge 0 Prozent', arrange: nothing, expect: is({ progressPercent: 0 }) },
    {
      name: 'rundet kaufmännisch auf ganze Prozent',
      plan: { waterTargetMl: 3000 },
      arrange: async (record, tx, owner) => {
        await record.water(tx, owner, conformanceToday, 1000);
        await record.water(tx, owner, conformanceToday, 1000);
        await record.water(tx, owner, conformanceToday, 15);
      },
      // 100 × 2015 ÷ 3000 = 67,17
      expect: is({ progressPercent: 67 }),
    },
    {
      name: 'rundet ,5 auf',
      plan: { waterTargetMl: 2000 },
      arrange: async (record, tx, owner) => record.water(tx, owner, conformanceToday, 1490),
      // 100 × 1490 ÷ 2000 = 74,5
      expect: is({ progressPercent: 75 }),
    },
    {
      name: 'deckelt bei 100 Prozent',
      plan: { waterTargetMl: 1500 },
      arrange: async (record, tx, owner) => {
        await record.water(tx, owner, conformanceToday, 1500);
        await record.water(tx, owner, conformanceToday, 750);
      },
      expect: is({ progressPercent: 100 }),
    },
    {
      name: 'zählt nur den Tag des Zeitraums',
      plan: { waterTargetMl: 1500 },
      arrange: async (record, tx, owner) => {
        await record.water(tx, owner, conformanceToday, 750);
        await record.water(tx, owner, day(-1), 1500);
      },
      expect: is({ progressPercent: 50 }),
    },
  ],
  sport: [
    { name: 'ohne Einträge 0 Minuten und das Wochenziel', plan: { weeklySportTargetMinutes: 150 }, arrange: nothing, expect: is({ countedMinutes: 0, weeklyTargetMinutes: 150 }) },
    {
      name: 'summiert die zählenden Einheiten von Montag bis Sonntag',
      plan: { weeklySportTargetMinutes: 120 },
      arrange: async (record, tx, owner) => {
        await record.session(tx, owner, day(-2), 30);
        await record.session(tx, owner, conformanceToday, 45);
        await record.session(tx, owner, day(4), 10);
      },
      expect: is({ countedMinutes: 85, weeklyTargetMinutes: 120 }),
    },
    {
      name: 'zählt weder nicht zählende Einträge noch die Nachbarwochen',
      plan: { weeklySportTargetMinutes: 150 },
      arrange: async (record, tx, owner) => {
        await record.session(tx, owner, conformanceToday, 60, { counted: false });
        await record.session(tx, owner, day(-3), 40);
        await record.session(tx, owner, day(5), 40);
      },
      expect: is({ countedMinutes: 0, weeklyTargetMinutes: 150 }),
    },
  ],
  gewicht: [
    { name: 'ohne Tagesgewicht noch nicht verfügbar', arrange: nothing, expect: is({ changeKg: null, direction: 'noch_nicht_verfuegbar' }) },
    {
      name: 'unter drei Tagesgewichten noch nicht verfügbar',
      arrange: async (record, tx, owner) => {
        await record.weighIn(tx, owner, day(-3), 80_000);
        await record.weighIn(tx, owner, conformanceToday, 79_000);
      },
      expect: is({ changeKg: null, direction: 'noch_nicht_verfuegbar' }),
    },
    {
      name: 'ohne Tagesgewicht in den letzten 14 Tagen noch nicht verfügbar',
      arrange: async (record, tx, owner) => {
        for (const offset of [-30, -25, -20, -15]) await record.weighIn(tx, owner, day(offset), 80_000);
      },
      expect: is({ changeKg: null, direction: 'noch_nicht_verfuegbar' }),
    },
    {
      name: 'gleiches Gewicht ist stabil',
      arrange: async (record, tx, owner) => {
        for (const offset of [-10, -5, 0]) await record.weighIn(tx, owner, day(offset), 80_000);
      },
      expect: is({ changeKg: 0, direction: 'stabil' }),
    },
    {
      name: 'eine Veränderung, die auf 0,0 kg rundet, ist stabil',
      arrange: async (record, tx, owner) => {
        for (const [offset, weightG] of [[-10, 80_000], [-5, 80_020], [0, 80_040]] as const) await record.weighIn(tx, owner, day(offset), weightG);
      },
      expect: is({ changeKg: 0, direction: 'stabil' }),
    },
    {
      name: 'fallendes Gewicht sinkt, auf eine Nachkommastelle',
      arrange: async (record, tx, owner) => {
        for (const [offset, weightG] of [[-12, 81_000], [-6, 80_400], [0, 79_800]] as const) await record.weighIn(tx, owner, day(offset), weightG);
      },
      expect: (content) => {
        expect(content.direction).toBe('sinkend');
        expect(content.changeKg).toBeLessThan(0);
      },
    },
    {
      name: 'steigendes Gewicht steigt',
      arrange: async (record, tx, owner) => {
        for (const [offset, weightG] of [[-12, 79_000], [-6, 79_600], [0, 80_200]] as const) await record.weighIn(tx, owner, day(offset), weightG);
      },
      expect: (content) => {
        expect(content.direction).toBe('steigend');
        expect(content.changeKg).toBeGreaterThan(0);
      },
    },
  ],
};

export function partnerProjectorConformanceCases<A extends AreaKey>(area: A, harness: ProjectorHarness<A>) {
  return (cases[area] as readonly Case<A>[]).map((conformance) => ({
    name: `${area}: ${conformance.name}`,
    async run() {
      const backend = await createTestBackend();
      const owner = await personWithSession(backend, `eigentuemerin-${randomUUID()}@example.test`, 'Anna');
      const plans = testPlans();
      plans.set(owner.personId, { validFrom: '2026-01-01', waterTargetMl: 2000, weeklySportTargetMinutes: 150, ...conformance.plan });
      const projector = harness.projector({ planReader: plans.planReader });
      const period = partnerSummaryPeriod(area, conformanceToday);

      const content = await backend.database.db.transaction(async (tx) => {
        await conformance.arrange(harness.record, tx, owner.personId);
        return projector.project(tx, { ownerPersonId: EntityId.parse(owner.personId), period, today: conformanceToday });
      });

      // Jeder Fall hat eine gültige Zielversion, also etwas zu zeigen.
      if (content === null) throw new Error(`${area}: Projector liefert trotz Zielversion „noch nichts zu zeigen“`);
      // Dieselbe Prüfung wie vor jeder Partnerantwort: genau die Felder des Vertrags, nichts weiter.
      const envelope = { type: area, id: randomUUID(), generation: 1, ownerPersonId: owner.personId, recipientPersonId: randomUUID(),
        couplingId: randomUUID(), period, dataAsOf: '2026-10-14T12:00:00.000Z', serverVersion: '1', content };
      expect(() => partnerResponse('partner_summary', envelope)).not.toThrow();
      conformance.expect(content);
    },
  }));
}
