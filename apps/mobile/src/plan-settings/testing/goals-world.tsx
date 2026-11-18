import { Stack } from 'expo-router';

import type { Clock } from '@abnehm/clock';
import type { LatestWeight } from '@abnehm/contracts/ports';

import { fakeWeightTrendReader } from '../../area-ports/testing/fakes';
import { ClockProvider } from '../../clock/clock-context';
import { goalVersion, outbox } from '../../local-db/schema';
import { sqliteOf } from '../../local-db/sqlite';
import { appGoalSettings, appPlan } from '../../plan';
import { createPlanTodayWorld, type PlanTodayWorld } from '../../plan/testing/today-world';
import { MessageHostProvider } from '../../shell/MessageHost';

// Test-Welt der Einstellungsseiten von Ziele & Onboarding (Spezifikation 1, Abschnitt 10): das echte
// Plan-Modul über einer SQLite-Datei mit den Migrationen der App (Test-Adapter der lokalen Datenbank,
// `createPlanTodayWorld`), angemeldet wie im Composition Root. Das Basisgewicht der Prognose liefert der
// Fixture-Adapter des `WeightTrendReader` aus #104.

export type GoalsWorld = PlanTodayWorld &
  Readonly<{
    /** Wurzel-Layout für `renderRouter`: Uhr und Meldungs-Host wie in `src/app/_layout.tsx`. */
    Layout: () => React.JSX.Element;
    /** Stößt das Lesemodell an wie im Betrieb der Minutentakt, etwa nach einem Tageswechsel der Testuhr. */
    tick(): void;
    /** Alle gespeicherten Zielversionen, nach `valid_from` sortiert. */
    goalVersions(): (typeof goalVersion.$inferSelect)[];
    outbox(): (typeof outbox.$inferSelect)[];
  }>;

export async function createGoalsWorld(clock: Clock, { latest = {} }: { latest?: Readonly<Record<string, LatestWeight>> } = {}): Promise<GoalsWorld> {
  const world = await createPlanTodayWorld(clock);
  const ticks = new Set<() => void>();
  const stops = [
    appPlan.opened(world.plan),
    appGoalSettings.opened(
      world.plan.goalSettings(fakeWeightTrendReader({ latest }), (update) => {
        ticks.add(update);
        return () => ticks.delete(update);
      }),
    ),
  ];
  function Layout() {
    return (
      <ClockProvider clock={clock}>
        <MessageHostProvider>
          <Stack screenOptions={{ headerShown: false }} />
        </MessageHostProvider>
      </ClockProvider>
    );
  }
  return {
    ...world,
    Layout,
    tick() {
      for (const tick of ticks) tick();
    },
    goalVersions: () =>
      world.database.read((tx) => sqliteOf(tx).select().from(goalVersion).all()).sort((a, b) => a.validFrom.localeCompare(b.validFrom)),
    outbox: () => world.database.read((tx) => sqliteOf(tx).select().from(outbox).all()),
    close() {
      for (const stop of stops) stop();
      world.close();
    },
  };
}
