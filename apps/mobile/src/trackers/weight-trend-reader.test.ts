/** @jest-environment node */
import { createTestClock } from '@abnehm/clock/testing';
import { EntityId, Instant, LocalDate } from '@abnehm/contracts/base';
import { LatestWeight, WeightTrendSeries } from '@abnehm/contracts/ports';

import { composeAreaPorts } from '../area-ports';
import { fakeIntakeReader, fakePlanReader } from '../area-ports/testing/fakes';
import { berlin, createTrackerWorld, noon, philipp, type TrackerWorld } from './testing/tracker-world';

// Nachweis für #176: der lesende Port `WeightTrendReader` (Spezifikation 0, Abschnitt 3; Spezifikation 3,
// Abschnitt 7) über einer echten SQLite-Datei. Er liest in einer Lesetransaktion, rechnet mit denselben
// Tracker-Regeln wie Detailbildschirm und Mini-Tracker und validiert seine Rückgaben gegen Zod.
// Importierte Gewichte zählen im Trend wie manuelle (Hinweis aus #183).

const worlds: TrackerWorld[] = [];
afterEach(() => {
  for (const world of worlds.splice(0)) world.close();
});

async function world() {
  const created = await createTrackerWorld(createTestClock({ instant: noon, timeZone: berlin }));
  worlds.push(created);
  return created;
}

/** 07:30 in Berlin (Sommerzeit) am gegebenen Tag im Oktober 2026. */
const morningOf = (day: number) => Instant.parse(`2026-10-${String(day).padStart(2, '0')}T05:30:00.000Z`);
const day = LocalDate.parse;

function record({ trackers }: TrackerWorld, weightG: number, measuredAt: Instant) {
  trackers.expire(trackers.recordWeight({ weightG, measuredAt }).undoToken);
}

function importWeight({ trackers }: TrackerWorld, weightG: number, measuredAt: Instant) {
  trackers.importHealth(
    {
      origin: 'health_connect',
      type: 'weight',
      upserts: [{ type: 'weight', externalKey: `waage-${measuredAt}`, sourceApp: { id: 'com.fitbit.FitbitMobile', name: 'Fitbit' }, utcOffsetMinutes: 120, measuredAt, weightG }],
      deletedKeys: [],
      reconcileSince: null,
      notBefore: Instant.parse('2026-09-14T00:00:00.000Z'),
    },
    () => {},
  );
}

describe('WeightTrendReader', () => {
  it('liefert ohne Messung eine leere Reihe und „noch nie gewogen“', async () => {
    const { trackers } = await world();

    await expect(trackers.weightTrendReader.series(philipp, day('2026-10-01'), day('2026-10-14'))).resolves.toEqual([]);
    await expect(trackers.weightTrendReader.latest(philipp)).resolves.toEqual({ lastDayWeight: null, dayWeightCount: 0, trend: { type: 'noch_nicht_verfuegbar' } });
  });

  it('liefert je Tag mit Tagesgewicht Wert und Trend, mit Lücken, Importen und mehreren Messungen eines Tags', async () => {
    const created = await world();
    record(created, 80_000, morningOf(1));
    // Zweite Messung am 1.10. zählt nicht als Tagesgewicht.
    record(created, 81_500, Instant.parse('2026-10-01T16:00:00.000Z'));
    // Drei Tage Lücke, dann ein importierter Waagenwert mit genauen Gramm.
    importWeight(created, 79_000, morningOf(4));
    record(created, 79_500, morningOf(5));

    const series = await created.trackers.weightTrendReader.series(philipp, day('2026-09-01'), day('2026-10-14'));

    expect(WeightTrendSeries.parse(series)).toEqual([
      { localDate: '2026-10-01', dayWeightG: 80_000, trendG: 80_000 },
      // 80 000 + (1 − 0,9³) × (79 000 − 80 000)
      { localDate: '2026-10-04', dayWeightG: 79_000, trendG: 79_729 },
      // 79 729 + 0,1 × (79 500 − 79 729)
      { localDate: '2026-10-05', dayWeightG: 79_500, trendG: 79_706 },
    ]);
    await expect(created.trackers.weightTrendReader.latest(philipp)).resolves.toEqual(
      LatestWeight.parse({ lastDayWeight: { localDate: '2026-10-05', dayWeightG: 79_500 }, dayWeightCount: 3, trend: { type: 'verfuegbar', trendG: 79_706 } }),
    );
  });

  it('schneidet die Reihe auf den Zeitraum zu, rechnet den Trend aber über die ganze Historie', async () => {
    const created = await world();
    record(created, 80_000, morningOf(1));
    importWeight(created, 79_000, morningOf(4));
    record(created, 79_500, morningOf(5));

    await expect(created.trackers.weightTrendReader.series(philipp, day('2026-10-04'), day('2026-10-04'))).resolves.toEqual([
      { localDate: '2026-10-04', dayWeightG: 79_000, trendG: 79_729 },
    ]);
  });

  it('zeigt den Trend erst ab drei Tagesgewichten', async () => {
    const created = await world();
    record(created, 80_000, morningOf(1));
    record(created, 79_600, morningOf(2));

    await expect(created.trackers.weightTrendReader.latest(philipp)).resolves.toEqual({
      lastDayWeight: { localDate: '2026-10-02', dayWeightG: 79_600 },
      dayWeightCount: 2,
      trend: { type: 'noch_nicht_verfuegbar' },
    });
  });

  it('liest nur: Ein Aufruf schreibt weder Einträge noch Operationen', async () => {
    const created = await world();
    record(created, 80_000, morningOf(1));
    const operations = created.operations();

    await created.trackers.weightTrendReader.latest(philipp);
    await created.trackers.weightTrendReader.series(philipp, day('2026-10-01'), day('2026-10-14'));

    expect(created.operations()).toEqual(operations);
  });

  it('besteht die Prüfung des Composition Root', async () => {
    const created = await world();
    record(created, 80_000, morningOf(1));
    const ports = composeAreaPorts(created.database, {
      planReader: () => fakePlanReader(),
      intakeReader: () => fakeIntakeReader(),
      weightRecorder: () => created.trackers.weightRecorder,
      weightTrendReader: () => created.trackers.weightTrendReader,
    });

    await expect(ports.weightTrendReader.latest(EntityId.parse(philipp))).resolves.toMatchObject({ dayWeightCount: 1 });
  });
});
