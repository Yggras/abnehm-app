import { act, render, screen, userEvent, within } from '@testing-library/react-native';

import { createTestClock } from '@abnehm/clock/testing';
import { EntityId, Instant, LocalDate, TimeZone } from '@abnehm/contracts/base';
import type { PlanReader } from '@abnehm/contracts/ports';

import { fakeAreaPorts, fakePlanReader } from '../area-ports/testing/fakes';
import { ClockProvider } from '../clock/clock-context';
import { insertPersonForTest } from '../daily-goals/testing/persisted';
import { hitArea } from '../design/testing/hit-area';
import { createLocalDatabases } from '../local-db/local-databases';
import { waterEntry } from '../local-db/schema';
import { sqliteOf } from '../local-db/sqlite';
import { createBetterSqliteFiles } from '../local-db/testing/better-sqlite';
import { openTarget } from '../navigation';
import { appQuickCommands } from '../shell/app-quick-commands';
import { MessageHostProvider, MessageSlot } from '../shell/MessageHost';
import { createTodayRegistry } from '../shell/today-registry';
import { TodayContent } from '../shell/TodayScreen';
import { createSyncRegistry, createSyncWriter } from '../sync';
import { pendingOperations } from '../sync/outbox';
import { createTrackers, waterEntryEntity } from '.';

// Nachweis für #171 am gerenderten Bildschirm: Der Wasser-Mini-Tracker auf „Heute“ mit dem echten
// Tracker-Modul, der Quick-Command-Registry der App und dem echten Meldungstext über einer echten
// SQLite-Datei. „+250 ml“ bucht ohne Navigation, die Meldung bietet „Rückgängig“.

jest.mock('../navigation', () => ({ ...jest.requireActual('../navigation'), openTarget: jest.fn() }));

const philipp = EntityId.parse('0b3f9a52-6c1e-4d7a-9f20-1a5e8c4d2b01');
const clock = createTestClock({ instant: Instant.parse('2026-10-14T10:00:00.000Z'), timeZone: TimeZone.parse('Europe/Berlin') });
const goal = {
  id: EntityId.parse('2a4c6e8f-1b3d-4f5a-9c7e-2b4d6f8a0c01'), personId: philipp, validFrom: LocalDate.parse('2026-10-01'),
  calorieBudgetMilliKcal: 1_800_000, lowerBoundMilliKcal: 1_500_000, maintenanceReason: null, pace: 'entspannt' as const,
  goalWeightG: 80_000, waterTargetMl: 2500, weeklySportTargetMinutes: 150,
};
const weeklyPlan = {
  id: EntityId.parse('2a4c6e8f-1b3d-4f5a-9c7e-2b4d6f8a0c02'), personId: philipp, validFrom: LocalDate.parse('2026-10-01'),
  days: Object.fromEntries(['montag', 'dienstag', 'mittwoch', 'donnerstag', 'freitag', 'samstag', 'sonntag']
    .map((day) => [day, ['ernaehrung_erfasst', 'wasserziel', 'gewogen']])) as never,
};
const withPlan = () => fakeAreaPorts({ planReader: fakePlanReader({ goals: [goal], weeklyPlans: [weeklyPlan] }) }).planReader;

const user = userEvent.setup();
const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  jest.mocked(openTarget).mockClear();
});

let ids = 0;

async function renderToday(planReader: PlanReader = withPlan()) {
  const files = createBetterSqliteFiles();
  const databases = createLocalDatabases({ openSqlite: files.openSqlite, onError: (error) => { throw error; } });
  const database = await databases.open('konto_a');
  database.transaction((tx) => insertPersonForTest(tx, philipp));
  const newId = () => EntityId.parse(`10000000-0000-4000-8000-${String(++ids).padStart(12, '0')}`);
  const trackers = createTrackers({
    database, clock, newId,
    writer: createSyncWriter({ registry: createSyncRegistry([waterEntryEntity]), clock, newId }),
    persistence: { reevaluateDailyGoals() {} },
  });
  const registry = createTodayRegistry();
  registry.register('tracker', 'trackers.water', trackers.waterToday(planReader, () => () => {}));
  const release = appQuickCommands.opened(database, trackers.quickCommands);
  cleanups.push(() => {
    release();
    databases.lock();
    files.remove();
  });
  await render(
    <ClockProvider clock={clock}>
      <MessageHostProvider>
        <TodayContent registry={registry} />
        <MessageSlot />
      </MessageHostProvider>
    </ClockProvider>,
  );
  await act(async () => {});
  return {
    rows: () => database.read((tx) => sqliteOf(tx).select().from(waterEntry).all()),
    operations: () => database.read((tx) => pendingOperations(tx, 100)).map((operation) => operation.type),
  };
}

const progress = () => screen.getByRole('progressbar', { name: 'Wasser heute' });

test('„+250 ml“ bucht ohne Navigation, zeigt „+250 ml Wasser“ mit „Rückgängig“ und aktualisiert den Mini-Tracker', async () => {
  const { rows } = await renderToday();
  expect(progress()).toHaveAccessibilityValue({ min: 0, max: 2500, now: 0, text: '0,0 l von 2,5 l' });

  await user.press(screen.getByRole('button', { name: 'Wasser: +250 ml' }));
  await act(async () => {});

  expect(openTarget).not.toHaveBeenCalled();
  expect(rows()).toEqual([expect.objectContaining({ amountMl: 250, deletedAt: null })]);
  expect(within(screen.getByTestId('message-slot')).getByText('+250 ml Wasser')).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Rückgängig' })).toBeOnTheScreen();
  expect(progress()).toHaveAccessibilityValue({ min: 0, max: 2500, now: 250, text: '0,3 l von 2,5 l' });
  expect(screen.getByText('Unterwegs')).toBeOnTheScreen();
});

test('„Rückgängig“ löscht die Buchung genau einmal, auch bei Doppeltipp', async () => {
  const { rows, operations } = await renderToday();
  await user.press(screen.getByRole('button', { name: 'Wasser: +250 ml' }));

  const undo = screen.getByRole('button', { name: 'Rückgängig' });
  await user.press(undo);
  await user.press(undo);
  await act(async () => {});

  expect(rows()).toEqual([expect.objectContaining({ deletedAt: expect.any(String) })]);
  expect(operations()).toEqual(['upsert_entity', 'delete_entity']);
  expect(progress()).toHaveAccessibilityValue({ min: 0, max: 2500, now: 0, text: '0,0 l von 2,5 l' });
  expect(screen.queryByRole('button', { name: 'Rückgängig' })).not.toBeOnTheScreen();
});

test('die Fläche öffnet den Detailbildschirm capture.water', async () => {
  await renderToday();

  await user.press(screen.getByRole('button', { name: 'Wasser: 0,0 l von 2,5 l, Noch offen. Details öffnen' }));

  expect(openTarget).toHaveBeenCalledWith({ type: 'capture.water' });
});

test('Aktionen haben deutsche zugängliche Namen und mindestens 48 × 48 dp', async () => {
  await renderToday();

  for (const name of ['Wasser: +250 ml', 'Wasser: 0,0 l von 2,5 l, Noch offen. Details öffnen']) {
    const area = hitArea(screen.getByRole('button', { name }));
    expect(area.height).toBeGreaterThanOrEqual(48);
    expect(area.width).toBeGreaterThanOrEqual(48);
  }
});

test('ohne gültige Zielversion zeigt der Mini-Tracker einen Hinweis statt Wert und Knopf', async () => {
  await renderToday(fakeAreaPorts().planReader);

  expect(screen.getByText('Noch kein Ziel festgelegt.')).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: 'Wasser: +250 ml' })).not.toBeOnTheScreen();
});
