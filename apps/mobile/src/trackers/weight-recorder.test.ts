/** @jest-environment node */
import { createTestClock } from '@abnehm/clock/testing';
import { EntityId, Instant, TimeZone } from '@abnehm/contracts/base';
import type { RecordManualWeight } from '@abnehm/contracts/ports';

import { composeAreaPorts, type AreaPorts } from '../area-ports';
import { fakeIntakeReader, fakePlanReader, fakeWeightTrendReader } from '../area-ports/testing/fakes';
import { berlin, createTrackerWorld, noon, philipp, type TrackerWorld } from './testing/tracker-world';

// Nachweis für #175: der Schreib-Port `WeightRecorder` (Spezifikation 0, Abschnitt 3; Spezifikation 3,
// Abschnitt 7), zusammengesetzt wie am Composition Root über `composeAreaPorts` samt Vertragsprüfung.
// Über ihn speichert *Ziele & Onboarding* das Startgewicht als gewöhnlichen manuellen Gewichtseintrag.

const worlds: TrackerWorld[] = [];
afterEach(() => {
  for (const world of worlds.splice(0)) world.close();
});

const entryId = EntityId.parse('1f3e5d7c-9b8a-4c6e-8f2d-1e3c5a7b9d01');
const morning = Instant.parse('2026-10-14T05:30:00.000Z');

async function setup() {
  const clock = createTestClock({ instant: noon, timeZone: berlin });
  const world = await createTrackerWorld(clock);
  worlds.push(world);
  // Wie am Composition Root: Die übrigen Pflichtports liefern hier die Fakes aus #104.
  const ports: AreaPorts = composeAreaPorts(world.database, {
    planReader: () => fakePlanReader(),
    weightTrendReader: () => fakeWeightTrendReader(),
    intakeReader: () => fakeIntakeReader(),
    weightRecorder: () => world.trackers.weightRecorder,
  });
  const record = (input: Partial<RecordManualWeight> = {}) =>
    ports.weightRecorder.recordManualWeight({ entryId, personId: philipp, weightG: 92_000, measuredAt: morning, ...input });
  return { ...world, clock, record };
}

it('ist idempotent je entryId: zweimal derselbe Aufruf ergibt genau einen Eintrag', async () => {
  const { record, weights } = await setup();

  expect(await record()).toEqual({ type: 'recorded', entryId, localDate: '2026-10-14' });
  expect(await record()).toEqual({ type: 'recorded', entryId, localDate: '2026-10-14' });

  expect(weights()).toEqual([expect.objectContaining({ id: entryId, personId: philipp, weightG: 92_000, origin: 'manuell', deletedAt: null })]);
});

it('legt Gewichtseintrag, Outbox-Operation und Tagesmeldung in einer eigenen Transaktion an', async () => {
  const { record, operations, reports } = await setup();

  await record();

  expect(operations()).toEqual([expect.objectContaining({ type: 'upsert_entity', entityType: 'weight_entry', entityId: entryId })]);
  expect(reports).toEqual([{ personId: philipp, localDates: ['2026-10-14'], cause: 'eingabe' }]);
});

it('aktualisiert bei einem erneuten Aufruf statt zu verdoppeln und meldet alten und neuen Tag', async () => {
  const { record, weights, reports } = await setup();
  await record();

  expect(await record({ weightG: 91_500, measuredAt: Instant.parse('2026-10-13T06:00:00.000Z') })).toEqual({
    type: 'recorded', entryId, localDate: '2026-10-13',
  });

  expect(weights()).toEqual([expect.objectContaining({ id: entryId, weightG: 91_500, localDate: '2026-10-13' })]);
  expect(reports[1]).toEqual({ personId: philipp, localDates: ['2026-10-14', '2026-10-13'], cause: 'eingabe' });
});

it('behält bei einem erneuten Aufruf Zone und Offset der Anlage, auch nach einer Reise', async () => {
  const { clock, record, weights } = await setup();
  await record();

  clock.setTimeZone(TimeZone.parse('America/New_York'));
  await record({ weightG: 91_900 });

  expect(weights()).toEqual([expect.objectContaining({ weightG: 91_900, timeZone: 'Europe/Berlin', utcOffsetMinutes: 120, localDate: '2026-10-14' })]);
});

it.each([
  ['19,9 kg', { weightG: 19_900 }],
  ['350,1 kg', { weightG: 350_100 }],
  ['einen Wert außerhalb der 100-g-Schritte', { weightG: 92_050 }],
  ['einen Messzeitpunkt in der Zukunft', { measuredAt: Instant.parse('2026-10-14T10:00:01.000Z') }],
])('validiert wie recordWeight und lehnt %s mit invalid_payload ab, ohne zu schreiben', async (_, input) => {
  const { record, weights, operations, reports } = await setup();

  expect(await record(input)).toEqual({ type: 'contract_error', error: { code: 'invalid_payload', retryable: false } });

  expect(weights()).toEqual([]);
  expect(operations()).toEqual([]);
  expect(reports).toEqual([]);
});

it.each([20_000, 350_000])('nimmt die Grenze %s g an', async (weightG) => {
  const { record, weights } = await setup();

  expect(await record({ weightG })).toMatchObject({ type: 'recorded' });

  expect(weights().map((row) => row.weightG)).toEqual([weightG]);
});

it('schreibt nur für die eigene Person', async () => {
  const { record, weights } = await setup();

  expect(await record({ personId: EntityId.parse('0b3f9a52-6c1e-4d7a-9f20-1a5e8c4d2b99') })).toEqual({
    type: 'contract_error', error: { code: 'forbidden', retryable: false },
  });

  expect(weights()).toEqual([]);
});

it('belebt einen gelöschten Eintrag nicht wieder: Löschen ist endgültig', async () => {
  const { trackers, record, weights } = await setup();
  await record();
  const { undoToken } = trackers.recordWeight({ weightG: 92_000, measuredAt: morning });
  trackers.undo(undoToken);
  // Den Eintrag aus dem Port löscht #176 über `deleteWeight`; hier genügt ein gelöschter Eintrag derselben ID.
  const deleted = weights().find((row) => row.deletedAt !== null)!;

  expect(await record({ entryId: EntityId.parse(deleted.id) })).toEqual({ type: 'contract_error', error: { code: 'conflict', retryable: false } });

  expect(weights().find((row) => row.id === deleted.id)).toMatchObject({ deletedAt: expect.any(String) });
});

it('ist eine Transaktion: Scheitert die Auswertung, bleibt nichts zurück', async () => {
  const { record, weights, operations, markers, failReevaluation } = await setup();
  failReevaluation(true);

  await expect(record()).rejects.toThrow('Auswertung gescheitert');

  expect(weights()).toEqual([]);
  expect(operations()).toEqual([]);
  expect(markers()).toEqual([]);
});
