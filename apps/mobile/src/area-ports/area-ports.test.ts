/**
 * @jest-environment node
 */
import { EntityId, Instant, LocalDate } from '@abnehm/contracts/base';
import { DailyIntakeSeries, type PlanReader, type RecordManualWeight } from '@abnehm/contracts/ports';

import type { LocalDatabase } from '../local-db';
import { createLocalDatabases, type LocalDatabases } from '../local-db/local-databases';
import * as schema from '../local-db/schema';
import { sqliteOf } from '../local-db/sqlite';
import { createBetterSqliteFiles } from '../local-db/testing/better-sqlite';
import { personRow } from '../local-db/testing/rows';
import { composeAreaPorts, IncompleteAreaPortsError, PortContractError, type AreaPortProviders } from '.';
import {
  fakeAreaPorts,
  fakeIntakeReader,
  fakeIslandCheckInHintReader,
  fakePlanReader,
  fakeWeightRecorder,
  fakeWeightTrendReader,
  type FakeGoalVersion,
  type FakeWeeklyPlanVersion,
} from './testing/fakes';

// Nachweis für #104: Die Ports zwischen Bereichen werden am Composition Root vollständig geprüft,
// Lese-Ports bekommen nur Lesetransaktionen, und jede Rückgabe wird gegen den Vertrag validiert.

const PERSON = EntityId.parse('0b3f9a52-6c1e-4d7a-9f20-1a5e8c4d2b01');
const day = (value: string) => LocalDate.parse(value);
const today = day('2026-10-14');

const goal: FakeGoalVersion = {
  personId: PERSON,
  id: EntityId.parse('2a4c6e8f-1b3d-4f5a-9c7e-2b4d6f8a0c01'),
  validFrom: day('2026-10-01'),
  calorieBudgetMilliKcal: 1_620_000,
  lowerBoundMilliKcal: 1_514_000,
  maintenanceReason: null,
  pace: 'entspannt',
  goalWeightG: 76_000,
  waterTargetMl: 1500,
  weeklySportTargetMinutes: 150,
};
const standard = ['ernaehrung_erfasst', 'wasserziel', 'im_kalorienbudget'] as const;
const weeklyPlan: FakeWeeklyPlanVersion = {
  id: EntityId.parse('2a4c6e8f-1b3d-4f5a-9c7e-2b4d6f8a0c02'),
  personId: PERSON,
  validFrom: day('2026-10-01'),
  days: {
    montag: ['ernaehrung_erfasst', 'wasserziel', 'gewogen'],
    dienstag: ['ernaehrung_erfasst', 'wasserziel', 'sporteinheit'],
    mittwoch: [...standard],
    donnerstag: ['ernaehrung_erfasst', 'wasserziel', 'sporteinheit'],
    freitag: [...standard],
    samstag: ['ernaehrung_erfasst', 'wasserziel', 'sporteinheit'],
    sonntag: [...standard],
  },
};

const allProviders: AreaPortProviders = {
  planReader: () => fakePlanReader({ goals: [goal], weeklyPlans: [weeklyPlan] }),
  weightTrendReader: () => fakeWeightTrendReader(),
  intakeReader: () => fakeIntakeReader(),
  weightRecorder: () => fakeWeightRecorder(),
};

let files: ReturnType<typeof createBetterSqliteFiles>;
let databases: LocalDatabases;
let db: LocalDatabase;

beforeEach(async () => {
  files = createBetterSqliteFiles();
  databases = createLocalDatabases({
    openSqlite: files.openSqlite,
    onError: (error) => {
      throw error;
    },
  });
  db = await databases.open('konto_a');
  db.transaction((tx) => sqliteOf(tx).insert(schema.person).values(personRow(PERSON, 'konto_a')).run());
});

afterEach(() => {
  databases.lock();
  files.remove();
});

describe('composeAreaPorts', () => {
  it('setzt alle Ports zusammen; ohne Insel-Hinweis entfällt nur dieser', async () => {
    const ports = composeAreaPorts(db, allProviders);

    expect(ports.islandCheckInHintReader).toBeNull();
    await expect(ports.planReader.effectivePlan(PERSON, today)).resolves.toMatchObject({ type: 'gueltig' });
  });

  it('meldet alle fehlenden Pflichtports auf einmal', () => {
    expect(() => composeAreaPorts(db, { intakeReader: allProviders.intakeReader })).toThrow(
      new IncompleteAreaPortsError(['planReader', 'weightTrendReader', 'weightRecorder']),
    );
  });

  it('meldet fehlende Methoden eines gelieferten Ports', () => {
    const incomplete = { ...allProviders, weightTrendReader: () => ({ series: async () => [] }) as never };

    expect(() => composeAreaPorts(db, incomplete)).toThrow(new IncompleteAreaPortsError(['weightTrendReader.latest']));
  });

  it('übernimmt einen gelieferten Insel-Hinweis', async () => {
    const ports = composeAreaPorts(db, {
      ...allProviders,
      islandCheckInHintReader: () => fakeIslandCheckInHintReader({ type: 'neues_insel_ereignis', eventKind: 'besuch' }),
    });

    await expect(ports.islandCheckInHintReader?.hint(PERSON, Instant.parse('2026-10-14T12:00:00.000Z'))).resolves.toEqual({
      type: 'neues_insel_ereignis',
      eventKind: 'besuch',
    });
  });

  it('validiert jede Rückgabe gegen das Vertragsschema', async () => {
    const kcalInsteadOfMilliKcal: PlanReader = {
      effectivePlan: async (personId, localDate) => {
        const plan = await fakePlanReader({ goals: [goal], weeklyPlans: [weeklyPlan] }).effectivePlan(personId, localDate);
        return plan.type === 'gueltig' ? { ...plan, goal: { ...plan.goal, calorieBudgetMilliKcal: 1620 } } : plan;
      },
    };
    const ports = composeAreaPorts(db, { ...allProviders, planReader: () => kcalInsteadOfMilliKcal });

    await expect(ports.planReader.effectivePlan(PERSON, today)).rejects.toThrow(PortContractError);
  });

  it('gibt Lese-Ports nur Lesetransaktionen', async () => {
    let access: object | undefined;
    const ports = composeAreaPorts(db, {
      ...allProviders,
      intakeReader: (readAccess) => {
        access = readAccess;
        return {
          dailyIntake: async (personId, from) => {
            readAccess.read((tx) => sqliteOf(tx).update(schema.person).set({ displayName: 'Geändert' }).run());
            return DailyIntakeSeries.parse([{ localDate: from, intakeMilliKcal: 0, recordedMealCategories: 0 }]);
          },
        };
      },
    });

    expect(Object.keys(access ?? {})).toEqual(['read']);
    await expect(ports.intakeReader.dailyIntake(PERSON, today, today)).rejects.toThrow();
    expect(db.read((tx) => sqliteOf(tx).select().from(schema.person).get()?.displayName)).toBe('Testperson');
  });

  it('der Write-Port schreibt in eigener Transaktion; ungültige Eingaben erreichen ihn nicht', async () => {
    const calls: RecordManualWeight[] = [];
    const ports = composeAreaPorts(db, {
      ...allProviders,
      weightRecorder: (writeAccess) => ({
        recordManualWeight: async (input) => {
          calls.push(input);
          writeAccess.transaction((tx) => sqliteOf(tx).update(schema.person).set({ displayName: 'Gewogen' }).run());
          return { type: 'recorded', entryId: input.entryId, localDate: today };
        },
      }),
    });
    const input = {
      entryId: EntityId.parse('1f3e5d7c-9b8a-4c6e-8f2d-1e3c5a7b9d01'),
      personId: PERSON,
      weightG: 79_400,
      measuredAt: Instant.parse('2026-10-14T06:30:00.000Z'),
    };

    await expect(ports.weightRecorder.recordManualWeight({ ...input, weightG: 79_450 })).resolves.toEqual({
      type: 'contract_error',
      error: { code: 'invalid_payload', retryable: false },
    });
    expect(calls).toEqual([]);

    await expect(ports.weightRecorder.recordManualWeight(input)).resolves.toMatchObject({ type: 'recorded' });
    expect(db.read((tx) => sqliteOf(tx).select().from(schema.person).get()?.displayName)).toBe('Gewogen');
  });
});

describe('Fake-Ports', () => {
  it('PlanReader: vor der ersten Fassung leer, danach Fassung und Wochentag des Tags', async () => {
    const { planReader } = fakeAreaPorts({ planReader: fakePlanReader({ goals: [goal], weeklyPlans: [weeklyPlan] }) });

    await expect(planReader.effectivePlan(PERSON, day('2026-09-30'))).resolves.toEqual({ type: 'leer', localDate: '2026-09-30' });
    await expect(planReader.effectivePlan(PERSON, day('2026-10-12'))).resolves.toMatchObject({
      type: 'gueltig',
      goal: { validFrom: '2026-10-01', waterTargetMl: 1500 },
      weeklyPlanDay: { bausteine: ['ernaehrung_erfasst', 'wasserziel', 'gewogen'] },
    });
  });

  it('PlanReader: die neuere Fassung gilt ab ihrem `validFrom`', async () => {
    const newer = { ...goal, id: EntityId.parse('2a4c6e8f-1b3d-4f5a-9c7e-2b4d6f8a0c03'), validFrom: today, waterTargetMl: 2000 };
    const { planReader } = fakeAreaPorts({ planReader: fakePlanReader({ goals: [goal, newer], weeklyPlans: [weeklyPlan] }) });

    await expect(planReader.effectivePlan(PERSON, day('2026-10-13'))).resolves.toMatchObject({ goal: { waterTargetMl: 1500 } });
    await expect(planReader.effectivePlan(PERSON, today)).resolves.toMatchObject({ goal: { waterTargetMl: 2000 } });
  });

  it('IntakeReader liefert jeden Tag des Bereichs, Tage ohne Einträge mit 0', async () => {
    const { intakeReader } = fakeAreaPorts({
      intakeReader: fakeIntakeReader({ [PERSON]: { '2026-10-13': { intakeMilliKcal: 1_204_500, recordedMealCategories: 2 } } }),
    });

    await expect(intakeReader.dailyIntake(PERSON, day('2026-10-12'), today)).resolves.toEqual([
      { localDate: '2026-10-12', intakeMilliKcal: 0, recordedMealCategories: 0 },
      { localDate: '2026-10-13', intakeMilliKcal: 1_204_500, recordedMealCategories: 2 },
      { localDate: '2026-10-14', intakeMilliKcal: 0, recordedMealCategories: 0 },
    ]);
  });

  it('WeightTrendReader: ohne Daten nie gewogen; Reihen nach Zeitraum', async () => {
    const { weightTrendReader } = fakeAreaPorts({
      weightTrendReader: fakeWeightTrendReader({
        series: {
          [PERSON]: [
            { localDate: day('2026-10-12'), dayWeightG: 79_800, trendG: 79_800 },
            { localDate: today, dayWeightG: 79_400, trendG: 79_724 },
          ],
        },
      }),
    });

    await expect(weightTrendReader.latest(PERSON)).resolves.toEqual({
      lastDayWeight: null,
      dayWeightCount: 0,
      trend: { type: 'noch_nicht_verfuegbar' },
    });
    await expect(weightTrendReader.series(PERSON, day('2026-10-13'), today)).resolves.toEqual([
      { localDate: today, dayWeightG: 79_400, trendG: 79_724 },
    ]);
  });

  it('WeightRecorder: zweimal speichern ergibt genau einen Eintrag, lokaler Tag aus der Zone', async () => {
    const recorder = fakeWeightRecorder();
    const { weightRecorder } = fakeAreaPorts({ weightRecorder: recorder });
    const input = {
      entryId: EntityId.parse('1f3e5d7c-9b8a-4c6e-8f2d-1e3c5a7b9d01'),
      personId: PERSON,
      weightG: 79_400,
      measuredAt: Instant.parse('2026-10-14T22:30:00.000Z'),
    };

    await weightRecorder.recordManualWeight(input);
    await expect(weightRecorder.recordManualWeight({ ...input, weightG: 79_300 })).resolves.toEqual({
      type: 'recorded',
      entryId: input.entryId,
      localDate: '2026-10-15',
    });
    expect(recorder.entries()).toEqual([{ ...input, weightG: 79_300 }]);
  });

  it('prüfen ihre Rückgaben wie die echten Ports', async () => {
    const { intakeReader } = fakeAreaPorts({
      intakeReader: fakeIntakeReader({ [PERSON]: { [today]: { intakeMilliKcal: 1_204_500, recordedMealCategories: 5 } } }),
    });

    await expect(intakeReader.dailyIntake(PERSON, today, today)).rejects.toThrow(PortContractError);
  });

  it('kommen ohne Insel-Hinweis', () => {
    expect(fakeAreaPorts().islandCheckInHintReader).toBeNull();
  });
});
