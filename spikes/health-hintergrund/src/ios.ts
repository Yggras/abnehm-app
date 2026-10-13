import {
  configureBackgroundTypes,
  isProtectedDataAvailable,
  queryCategorySamples,
  queryQuantitySamples,
  queryQuantitySamplesWithAnchor,
  queryWorkoutSamples,
  queryWorkoutSamplesWithAnchor,
  requestAuthorization,
  subscribeToChanges,
  UpdateFrequency,
} from '@kingstinct/react-native-healthkit';
import type { QuantityTypeIdentifier } from '@kingstinct/react-native-healthkit';
import { AppState } from 'react-native';

import { log, minutesBetween, readState, writeState } from './log';
import { notify, testUpload } from './report';

const WORKOUT = 'HKWorkoutTypeIdentifier' as const;

// Typen, bei deren Änderung HealthKit die App im Hintergrund wecken soll.
const BACKGROUND_QUANTITY: QuantityTypeIdentifier[] = [
  'HKQuantityTypeIdentifierBodyMass',
  'HKQuantityTypeIdentifierStepCount',
  'HKQuantityTypeIdentifierActiveEnergyBurned',
  'HKQuantityTypeIdentifierAppleExerciseTime',
];
export const BACKGROUND_TYPES = [WORKOUT, ...BACKGROUND_QUANTITY];

// Zusätzliche Typen nur für die Inventur „was schreibt Google Health?“.
const INVENTORY_QUANTITY: QuantityTypeIdentifier[] = [
  ...BACKGROUND_QUANTITY,
  'HKQuantityTypeIdentifierBasalEnergyBurned',
  'HKQuantityTypeIdentifierDistanceWalkingRunning',
  'HKQuantityTypeIdentifierFlightsClimbed',
  'HKQuantityTypeIdentifierHeartRate',
  'HKQuantityTypeIdentifierRestingHeartRate',
  'HKQuantityTypeIdentifierHeartRateVariabilitySDNN',
  'HKQuantityTypeIdentifierOxygenSaturation',
  'HKQuantityTypeIdentifierRespiratoryRate',
];
const SLEEP = 'HKCategoryTypeIdentifierSleepAnalysis' as const;

export async function requestIosPermissions() {
  await requestAuthorization({ toRead: [WORKOUT, ...INVENTORY_QUANTITY, SLEEP] });
  log('info', { msg: 'HealthKit-Leserechte angefragt' });
  registerIosSubscriptions();
}

export async function enableIosBackground(frequency: 'immediate' | 'hourly') {
  const freq = frequency === 'immediate' ? UpdateFrequency.immediate : UpdateFrequency.hourly;
  const ok = await configureBackgroundTypes(BACKGROUND_TYPES, freq);
  writeState({ iosFrequency: frequency });
  log('info', { msg: 'Background Delivery konfiguriert', frequency, ok });
  registerIosSubscriptions();
}

// Läuft bei jedem Wecken durch HealthKit (auch nach Kaltstart im Hintergrund)
// sowie beim manuellen Import im Vordergrund.
export async function importIosChanges(typeId: string, trigger: string) {
  const started = Date.now();
  const appState = AppState.currentState;
  const protectedData = isProtectedDataAvailable();
  log('wake', { platform: 'ios', trigger, typeId, appState, protectedData, frequency: readState().iosFrequency });
  if (!protectedData) {
    log('error', { where: typeId, error: 'Gerät gesperrt – geschützte Daten nicht verfügbar' });
    return 0;
  }

  let newCount = 0;
  try {
    const anchorKey = `anchor:${typeId}`;
    const anchor = readState()[anchorKey];
    const firstRun = !anchor;

    if (typeId === WORKOUT) {
      const res = await queryWorkoutSamplesWithAnchor({ limit: 0, anchor });
      for (const w of res.workouts) {
        logSample(typeId, trigger, firstRun, {
          startDate: w.startDate,
          endDate: w.endDate,
          source: w.sourceRevision.source,
          device: w.device?.name,
          activityType: w.workoutActivityType,
          durationMin: Math.round(w.duration.quantity / 60),
          kcal: w.totalEnergyBurned?.quantity,
        });
      }
      newCount = res.workouts.length;
      writeState({ [anchorKey]: res.newAnchor });
    } else {
      const res = await queryQuantitySamplesWithAnchor(typeId as QuantityTypeIdentifier, {
        limit: 0,
        anchor,
      });
      for (const s of res.samples) {
        logSample(typeId, trigger, firstRun, {
          startDate: s.startDate,
          endDate: s.endDate,
          source: s.sourceRevision.source,
          device: s.device?.name,
          value: Math.round(s.quantity * 10) / 10,
          unit: s.unit,
        });
      }
      newCount = res.samples.length;
      writeState({ [anchorKey]: res.newAnchor });
    }

    log('import', { platform: 'ios', trigger, typeId, newCount, ms: Date.now() - started });
    await testUpload(`${trigger}:${typeId}`, newCount);
    if (trigger === 'background') {
      await notify('Hintergrund-Import (iPhone)', `${shortType(typeId)}: ${newCount} neu`);
    }
  } catch (e) {
    log('error', { where: typeId, trigger, error: String(e) });
  }
  log('done', { platform: 'ios', trigger, typeId, totalMs: Date.now() - started });
  return newCount;
}

function logSample(
  typeId: string,
  trigger: string,
  firstRun: boolean,
  s: { startDate: Date; endDate: Date; source: { name: string; bundleIdentifier: string }; [k: string]: unknown },
) {
  // Erster Lauf = Historie: nur gezählt (siehe „import“), nicht einzeln protokolliert.
  if (firstRun) return;
  const { startDate, endDate, source, ...rest } = s;
  log('sample', {
    platform: 'ios',
    trigger,
    typeId,
    firstRun,
    start: startDate.toISOString(),
    end: endDate.toISOString(),
    sourceName: source.name,
    sourceBundle: source.bundleIdentifier,
    // Abstand Ende des Eintrags → Import. Beim ersten Lauf ohne Aussagekraft.
    delayMin: firstRun ? undefined : minutesBetween(endDate, new Date()),
    ...rest,
  });
}

// Muss beim Laden des JS-Bundles laufen (Modul-Ebene in index.ts), damit
// Wecken nach Kaltstart nicht verloren geht. Die Bibliothek puffert Ereignisse
// bis zur Registrierung.
// Erneut aufrufbar: Vor erteilten Rechten scheitern die Beobachter mit
// „Authorization not determined“, deshalb nach Rechten/Konfiguration neu anmelden.
let subscriptions: { remove: () => boolean }[] = [];

export function registerIosSubscriptions() {
  for (const sub of subscriptions) sub.remove();
  subscriptions = BACKGROUND_TYPES.map((typeId) =>
    subscribeToChanges(typeId, (args) => {
      if (args.errorMessage) {
        log('error', { where: `observer ${typeId}`, error: args.errorMessage });
        return;
      }
      // Beim Start im Vordergrund meldet HealthKit einmal alle Typen; der Zustand ist
      // dann noch „inactive“. Nur „background“ ist ein echtes Wecken im Hintergrund.
      const trigger = AppState.currentState === 'background' ? 'background' : 'observer-foreground';
      void importIosChanges(typeId, trigger);
    }),
  );
}

export async function importAllIos(trigger: string) {
  let total = 0;
  for (const typeId of BACKGROUND_TYPES) total += await importIosChanges(typeId, trigger);
  return total;
}

// Inventur: Welche Typen kamen in den letzten 7 Tagen von welcher Quelle?
export async function iosInventory() {
  const startDate = new Date(Date.now() - 7 * 24 * 3600 * 1000);
  const filter = { date: { startDate } };
  const rows: Record<string, unknown>[] = [];
  const summarize = (type: string, items: readonly { sourceRevision: { source: { name: string; bundleIdentifier: string } }; endDate: Date }[]) => {
    const bySource = new Map<string, { count: number; newest: Date }>();
    for (const it of items) {
      const key = `${it.sourceRevision.source.name} (${it.sourceRevision.source.bundleIdentifier})`;
      const cur = bySource.get(key);
      if (!cur) bySource.set(key, { count: 1, newest: it.endDate });
      else {
        cur.count++;
        if (it.endDate > cur.newest) cur.newest = it.endDate;
      }
    }
    if (bySource.size === 0) rows.push({ type: shortType(type), source: '–', count: 0 });
    for (const [source, v] of bySource) {
      rows.push({ type: shortType(type), source, count: v.count, newest: v.newest.toISOString() });
    }
  };
  for (const type of INVENTORY_QUANTITY) {
    try {
      summarize(type, await queryQuantitySamples(type, { limit: 0, filter }));
    } catch (e) {
      rows.push({ type: shortType(type), error: String(e) });
    }
  }
  try {
    summarize(SLEEP, await queryCategorySamples(SLEEP, { limit: 0, filter }));
  } catch (e) {
    rows.push({ type: 'SleepAnalysis', error: String(e) });
  }
  try {
    const workouts = await queryWorkoutSamples({ limit: 0, filter });
    summarize(WORKOUT, workouts);
    for (const w of workouts) {
      rows.push({
        type: 'Workout-Detail',
        source: w.sourceRevision.source.bundleIdentifier,
        activityType: w.workoutActivityType,
        start: w.startDate.toISOString(),
        durationMin: Math.round(w.duration.quantity / 60),
        kcal: w.totalEnergyBurned?.quantity,
        distance: w.totalDistance?.quantity,
      });
    }
  } catch (e) {
    rows.push({ type: 'Workout', error: String(e) });
  }
  log('inventory', { platform: 'ios', rows });
  return rows;
}

const shortType = (t: string) => t.replace(/^HK(Quantity|Category)?TypeIdentifier/, '');
