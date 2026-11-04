/** @jest-environment node */
import { randomUUID } from 'node:crypto';

import { createTestClock } from '@abnehm/clock/testing';
import { EntityId, Instant, LocalDate, ServerVersion, TimeZone } from '@abnehm/contracts/base';
import type { DailyGoalCause } from '@abnehm/contracts/daily-goals';
import { ConfirmPhotoDraft, photoDraftSnapshot, type NutritionSnapshot } from '@abnehm/contracts/nutrition';
import type { OutboxOperation, PushResult } from '@abnehm/contracts/sync';

import { insertPersonForTest } from '../daily-goals/testing/persisted';
import type { LocalDatabase } from '../local-db';
import { createLocalDatabases } from '../local-db/local-databases';
import { mealPhoto, nutritionEntry, outbox } from '../local-db/schema';
import { sqliteOf } from '../local-db/sqlite';
import { createBetterSqliteFiles } from '../local-db/testing/better-sqlite';
import { createLocalCommandRegistry, createSyncRegistry, createSyncWriter } from '../sync';
import { pendingOperations } from '../sync/outbox';
import { createNutrition, InvalidNutritionInputError, mealPhotoEntity, nutritionEntryEntity, photoDraftCommand, type DayLog, type PhotoDraftConfirmation } from '.';

// Nachweis für #162 an der Naht des App-Moduls „Ernährung“: „Mahlzeit hinzufügen“ im Fotoentwurf legt in
// einer Transaktion Einträge, Mahlzeitenfoto, genau eine Outbox-Operation `confirmPhotoDraft` und die
// Tagesmeldung an. Die Antwort des Servers gleicht der Fachbefehl ab: ohne Foto im Ergebnis entfernt die
// App ihr Foto, eine Ablehnung entfernt alles nie Bestätigte.

const philipp = EntityId.parse('0b3f9a52-6c1e-4d7a-9f20-1a5e8c4d2b01');
const draftId = EntityId.parse('5c7e9a1b-3d5f-4a7c-9e1b-5d7f9a1c3e03');
/** 12:30 in Berlin am Mittwoch, 14.10.2026 (UTC+2). */
const lunch = Instant.parse('2026-10-14T10:30:00.000Z');
const today = LocalDate.parse('2026-10-14');

/** Zwei Bestandteile, wie die Fotoanalyse sie liefert. */
const potatoes = photoDraftSnapshot({ name: 'Bratkartoffeln', baseUnit: 'g', baseAmount: 180_000, milliKcal: 270_000, proteinMg: 4_000, carbsMg: 32_000, fatMg: 13_000 });
/** Das Spiegelei ersetzt die Person durch ein Suchergebnis aus dem BLS; die geschätzten 60 g bleiben. */
const egg: NutritionSnapshot = {
  name: 'Hühnerei gebraten',
  baseUnit: 'g',
  referenceAmount: 100_000,
  milliKcal: 196_000,
  proteinMg: 13_600,
  carbsMg: 700,
  fatMg: 15_300,
  portions: [],
  source: 'bls',
  attribution: 'Max Rubner-Institut (2025): Bundeslebensmittelschlüssel (BLS), Version 4.0',
};

const lunchFromPhoto: PhotoDraftConfirmation = {
  draftId,
  localDate: today,
  meal: 'mittagessen',
  components: [
    { foodRef: null, snapshot: potatoes, displayUnit: 'g', displayAmountMilli: 180_000 },
    { foodRef: { type: 'bls', key: 'E111200' }, snapshot: egg, displayUnit: 'g', displayAmountMilli: 60_000 },
  ],
};

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

async function setup({ failReevaluation = false } = {}) {
  const files = createBetterSqliteFiles();
  const databases = createLocalDatabases({ openSqlite: files.openSqlite, onError: (error) => { throw error; } });
  cleanups.push(() => {
    databases.lock();
    files.remove();
  });
  const database: LocalDatabase = await databases.open('konto_a');
  database.transaction((tx) => insertPersonForTest(tx, philipp));
  const clock = createTestClock({ instant: lunch, timeZone: TimeZone.parse('Europe/Berlin') });
  const newId = () => EntityId.parse(randomUUID());
  const writer = createSyncWriter({ registry: createSyncRegistry([nutritionEntryEntity, mealPhotoEntity]), clock, newId });
  const reports: { personId: EntityId; localDates: readonly LocalDate[]; cause: DailyGoalCause }[] = [];
  const persistence = {
    reevaluateDailyGoals(_tx: unknown, personId: EntityId, localDates: readonly LocalDate[], cause: DailyGoalCause) {
      reports.push({ personId, localDates: [...localDates], cause });
      if (failReevaluation) throw new Error('Auswertung gescheitert');
    },
  };
  const nutrition = createNutrition({ database, clock, writer, newId, persistence });
  const commands = createLocalCommandRegistry({ database, writer, commands: [photoDraftCommand({ persistence })] });
  const read = () =>
    database.read((tx) => ({
      photos: sqliteOf(tx).select().from(mealPhoto).all(),
      entries: sqliteOf(tx).select().from(nutritionEntry).all(),
      operations: pendingOperations(tx, 100),
      outbox: sqliteOf(tx).select().from(outbox).all(),
    }));
  const dayLog = () => {
    let log: DayLog | null = null;
    nutrition.observeDayLog(today, (next) => (log = next))();
    return log as DayLog | null;
  };
  return { database, clock, nutrition, commands, reports, read, dayLog };
}

type CommandOperation = Extract<OutboxOperation, { businessKey: string }>;

function onlyCommand(operations: readonly OutboxOperation[]): CommandOperation {
  const [operation] = operations;
  if (operations.length !== 1 || operation === undefined || !('businessKey' in operation)) throw new Error('Genau ein Fachbefehl erwartet');
  return operation;
}

describe('Fotoentwurf bestätigen', () => {
  it('legt Einträge, Mahlzeitenfoto, genau eine Operation confirmPhotoDraft und die Tagesmeldung in einer Transaktion an', async () => {
    const { nutrition, read, reports } = await setup();

    const values = nutrition.confirmPhotoDraft(lunchFromPhoto);

    // 270 kcal Bratkartoffeln und 196 kcal je 100 g × 0,6 = 117,6 kcal Ei: 387,6 kcal, gerundet 388 kcal.
    expect(values).toEqual({ meal: 'mittagessen', kcal: 388 });
    const { photos, entries, operations, outbox: rows } = read();
    expect(photos).toEqual([expect.objectContaining({ personId: philipp, capturedAt: lunch, sharedWithPartner: true, serverVersion: null, deletedAt: null })]);
    const photoId = photos[0]!.id;
    expect(entries).toEqual([
      expect.objectContaining({ captureMethod: 'foto', snapshotSource: 'ki', foodRefType: null, totalMilliKcal: 270_000, mealPhotoId: photoId, meal: 'mittagessen', localDate: today }),
      expect.objectContaining({ captureMethod: 'foto', snapshotSource: 'bls', foodRefKey: 'E111200', totalMilliKcal: 117_600, mealPhotoId: photoId }),
    ]);
    const operation = onlyCommand(operations);
    expect(operation).toMatchObject({ type: 'confirmPhotoDraft', businessKey: `fotoentwurf:${draftId}`, knownServerVersion: null });
    const payload = ConfirmPhotoDraft.parse(operation.payload);
    expect(payload).toMatchObject({ draftId, photoId, sharedWithPartner: true });
    expect(payload.entries.map(({ id }) => id)).toEqual(entries.map(({ id }) => id));
    // Die Operation nennt jede optimistisch angelegte Zeile; der Pull überschreibt sie bis zur Antwort nicht.
    expect(rows[0]!.affectedRefs).toEqual([
      { entityType: 'meal_photo', entityId: photoId },
      ...entries.map(({ id }) => ({ entityType: 'nutrition_entry', entityId: id })),
    ]);
    expect(reports).toEqual([{ personId: philipp, localDates: [today], cause: 'eingabe' }]);
  });

  it('übernimmt „Mit Partner teilen: aus“', async () => {
    const { nutrition, read } = await setup();
    nutrition.confirmPhotoDraft({ ...lunchFromPhoto, sharedWithPartner: false });
    const { photos, operations } = read();
    expect(photos[0]!.sharedWithPartner).toBe(false);
    expect(ConfirmPhotoDraft.parse(onlyCommand(operations).payload).sharedWithPartner).toBe(false);
  });

  it('das Protokoll zeigt die Einträge aus dem Foto als solche', async () => {
    const { nutrition, clock, dayLog } = await setup();
    nutrition.addEntry({ localDate: today, meal: 'mittagessen', captureMethod: 'suche', foodRef: { type: 'bls', key: 'E111200' }, snapshot: egg, displayUnit: 'g', displayAmountMilli: 50_000 });
    clock.advanceBy(60_000);
    nutrition.confirmPhotoDraft(lunchFromPhoto);

    const meal = dayLog()!.meals.find((entry) => entry.meal === 'mittagessen')!;
    // Erst der Eintrag aus der Suche, dann die beiden aus dem Foto (gleicher Zeitpunkt, Reihenfolge nach ID).
    // Das Symbol gilt jedem Eintrag aus dem Foto, „KI-Schätzung“ nur dem nicht ersetzten Bestandteil.
    const [fromSearch, ...fromPhoto] = meal.entries.map(({ name, fromPhoto: photo, aiEstimate }) => [name, photo, aiEstimate] as const);
    expect(fromSearch).toEqual(['Hühnerei gebraten', false, false]);
    expect([...fromPhoto].sort()).toEqual([['Bratkartoffeln', true, true], ['Hühnerei gebraten', true, false]]);
  });

  it.each([
    ['ein künftiger Tag', { ...lunchFromPhoto, localDate: LocalDate.parse('2026-10-15') }],
    ['eine ungültige Menge', { ...lunchFromPhoto, components: [{ ...lunchFromPhoto.components[0]!, displayAmountMilli: 0 }] }],
    ['ein unbekanntes Stück', { ...lunchFromPhoto, components: [{ ...lunchFromPhoto.components[0]!, displayUnit: 'stueck' as const }] }],
    ['eine leere Mahlzeit', { ...lunchFromPhoto, components: [] }],
    ['ein KI-Bestandteil mit Referenz', { ...lunchFromPhoto, components: [{ ...lunchFromPhoto.components[0]!, foodRef: { type: 'bls', key: 'E111200' } as const }] }],
  ])('schreibt nichts bei %s', async (_name, input) => {
    const { nutrition, read, reports } = await setup();
    expect(() => nutrition.confirmPhotoDraft(input)).toThrow(InvalidNutritionInputError);
    expect(read()).toMatchObject({ photos: [], entries: [], operations: [] });
    expect(reports).toEqual([]);
  });

  it('ist eine Transaktion: Scheitert die Auswertung, bleibt nichts zurück', async () => {
    const { nutrition, read } = await setup({ failReevaluation: true });
    expect(() => nutrition.confirmPhotoDraft(lunchFromPhoto)).toThrow('Auswertung gescheitert');
    expect(read()).toMatchObject({ photos: [], entries: [], operations: [] });
  });
});

describe('Antwort des Servers auf confirmPhotoDraft', () => {
  async function confirmed() {
    const world = await setup();
    world.nutrition.confirmPhotoDraft(lunchFromPhoto);
    const operation = onlyCommand(world.read().operations);
    return { ...world, operation, payload: ConfirmPhotoDraft.parse(operation.payload) };
  }

  function result(operation: CommandOperation, changes: Extract<PushResult, { type: 'applied' }>['changes'] = []): Extract<PushResult, { type: 'applied' }> {
    return { type: 'applied', operationId: operation.operationId, canonical: { type: 'absent', entityType: 'command_result', entityId: operation.operationId }, changes };
  }

  it('ohne Foto im Ergebnis entfernt die App ihr Foto und löst die Einträge davon', async () => {
    const { database, commands, operation, payload, read } = await confirmed();

    database.transaction((tx) => commands.reconcileApplied(tx, operation, result(operation)));

    const { photos, entries } = read();
    expect(photos).toEqual([]);
    expect(entries.map(({ id, mealPhotoId }) => [id, mealPhotoId])).toEqual(payload.entries.map(({ id }) => [id, null]));
  });

  it('mit Foto im Ergebnis bleibt es', async () => {
    const { database, commands, operation, payload, read } = await confirmed();
    const record = { type: 'record', entityType: 'meal_photo', entityId: payload.photoId, serverVersion: ServerVersion.parse('7'), data: {} } as const;

    database.transaction((tx) => commands.reconcileApplied(tx, operation, result(operation, [record])));

    expect(read().photos.map(({ id }) => id)).toEqual([payload.photoId]);
  });

  it('eine Ablehnung entfernt Foto und Einträge, die der Server nie bestätigt hat, und meldet den Tag', async () => {
    const { database, commands, operation, read, reports } = await confirmed();

    database.transaction((tx) =>
      commands.reconcileRejected(tx, operation, {
        type: 'permanently_rejected',
        operationId: operation.operationId,
        error: { code: 'invalid_payload', retryable: false },
        canonical: { type: 'absent', entityType: 'command_result', entityId: operation.operationId },
      }),
    );

    expect(read()).toMatchObject({ photos: [], entries: [] });
    expect(reports.at(-1)).toEqual({ personId: philipp, localDates: [today], cause: 'pull' });
  });
});
