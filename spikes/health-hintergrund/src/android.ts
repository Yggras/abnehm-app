import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import { AppState } from 'react-native';
import {
  getChanges,
  getGrantedPermissions,
  getSdkStatus,
  initialize,
  readRecords,
  requestPermission,
} from 'react-native-health-connect';
import type { RecordType } from 'react-native-health-connect';

import { backgroundReadStatus } from '../modules/hc-feature';
import { log, minutesBetween, readState, writeState } from './log';
import { notify, testUpload } from './report';

export const ANDROID_TASK = 'health-hintergrund-import';

// Typen, die der Hintergrund-Job per Change-Token abholt.
const SYNC_TYPES: RecordType[] = ['ExerciseSession', 'Steps', 'Weight', 'TotalCaloriesBurned', 'ActiveCaloriesBurned'];
// Zusätzliche Typen nur für die Inventur.
const INVENTORY_TYPES: RecordType[] = [...SYNC_TYPES, 'HeartRate', 'RestingHeartRate', 'SleepSession', 'Distance'];

async function ensureInit() {
  const ok = await initialize();
  if (!ok) throw new Error('Health Connect nicht initialisiert');
}

export async function androidStatus() {
  const sdk = await getSdkStatus(); // 3 = verfügbar (SdkAvailabilityStatus)
  let feature = 'unbekannt';
  try {
    feature = backgroundReadStatus();
  } catch (e) {
    feature = `Fehler: ${String(e)}`;
  }
  let granted: string[] = [];
  let taskRegistered = false;
  let taskStatus = '';
  try {
    await ensureInit();
    granted = (await getGrantedPermissions()).map((p) => `${p.accessType}:${p.recordType}`);
    taskRegistered = await TaskManager.isTaskRegisteredAsync(ANDROID_TASK);
    taskStatus = BackgroundTask.BackgroundTaskStatus[await BackgroundTask.getStatusAsync()];
  } catch (e) {
    log('error', { where: 'androidStatus', error: String(e) });
  }
  const status = { sdk, feature, granted, taskRegistered, taskStatus };
  log('status', { platform: 'android', ...status });
  return status;
}

export async function requestAndroidPermissions() {
  await ensureInit();
  const granted = await requestPermission([
    ...INVENTORY_TYPES.map((recordType) => ({ accessType: 'read' as const, recordType })),
    { accessType: 'read', recordType: 'BackgroundAccessPermission' },
  ]);
  log('info', { msg: 'Health-Connect-Rechte', granted: granted.map((p) => `${p.accessType}:${p.recordType}`) });
}

export async function registerAndroidTask(minutes: number) {
  if (await TaskManager.isTaskRegisteredAsync(ANDROID_TASK)) {
    await BackgroundTask.unregisterTaskAsync(ANDROID_TASK);
  }
  await BackgroundTask.registerTaskAsync(ANDROID_TASK, { minimumInterval: minutes });
  writeState({ androidInterval: String(minutes) });
  log('info', { msg: 'Hintergrund-Job registriert', minutes });
}

export async function importAndroidChanges(trigger: string) {
  const started = Date.now();
  log('wake', { platform: 'android', trigger, appState: AppState.currentState, interval: readState().androidInterval });
  let newCount = 0;
  try {
    await ensureInit();
    const token = readState().hcToken;
    const firstRun = !token;
    let next = token;
    let hasMore = true;
    while (hasMore) {
      const res = await getChanges(next ? { changesToken: next } : { recordTypes: SYNC_TYPES });
      if (res.changesTokenExpired) {
        log('error', { where: 'getChanges', error: 'Change-Token abgelaufen – setze zurück' });
        writeState({ hcToken: undefined });
        break;
      }
      for (const change of res.upsertionChanges) logRecord(change.record as AnyRecord, trigger, firstRun);
      newCount += res.upsertionChanges.length;
      if (res.deletionChanges.length) log('deleted', { platform: 'android', trigger, count: res.deletionChanges.length });
      next = res.nextChangesToken;
      hasMore = res.hasMore;
    }
    if (next) writeState({ hcToken: next });
    log('import', { platform: 'android', trigger, newCount, firstRun, ms: Date.now() - started });
    await testUpload(trigger, newCount);
    if (trigger === 'background') {
      await notify('Hintergrund-Import (Android)', `${newCount} neue Einträge`);
    }
  } catch (e) {
    log('error', { where: 'importAndroidChanges', trigger, error: String(e) });
  }
  log('done', { platform: 'android', trigger, totalMs: Date.now() - started });
  return newCount;
}

type AnyRecord = {
  recordType: string;
  startTime?: string;
  endTime?: string;
  time?: string;
  exerciseType?: number;
  title?: string;
  count?: number;
  weight?: { inKilograms: number };
  energy?: { inKilocalories: number };
  metadata?: { id?: string; dataOrigin?: string; lastModifiedTime?: string };
};

function logRecord(r: AnyRecord, trigger: string, firstRun: boolean) {
  const end = r.endTime ?? r.time;
  const written = r.metadata?.lastModifiedTime;
  log('sample', {
    platform: 'android',
    trigger,
    typeId: r.recordType,
    firstRun,
    start: r.startTime,
    end,
    written,
    dataOrigin: r.metadata?.dataOrigin,
    exerciseType: r.exerciseType,
    title: r.title,
    steps: r.count,
    kg: r.weight?.inKilograms,
    kcal: r.energy ? Math.round(r.energy.inKilocalories) : undefined,
    // Ende des Eintrags → in Health Connect geschrieben (Fitbit-Kette)
    writeDelayMin: end && written ? minutesBetween(end, written) : undefined,
    // In Health Connect geschrieben → von uns importiert
    importDelayMin: written && !firstRun ? minutesBetween(written, new Date()) : undefined,
  });
}

export async function androidInventory() {
  await ensureInit();
  const startTime = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  const endTime = new Date().toISOString();
  const rows: Record<string, unknown>[] = [];
  for (const type of INVENTORY_TYPES) {
    try {
      const res = await readRecords(type, { timeRangeFilter: { operator: 'between', startTime, endTime } });
      const byOrigin = new Map<string, number>();
      for (const rec of res.records as AnyRecord[]) {
        const origin = rec.metadata?.dataOrigin ?? '?';
        byOrigin.set(origin, (byOrigin.get(origin) ?? 0) + 1);
      }
      if (byOrigin.size === 0) rows.push({ type, source: '–', count: 0 });
      for (const [source, count] of byOrigin) rows.push({ type, source, count });
      if (type === 'ExerciseSession') {
        for (const rec of res.records as AnyRecord[]) {
          rows.push({
            type: 'Exercise-Detail',
            source: rec.metadata?.dataOrigin,
            exerciseType: rec.exerciseType,
            title: rec.title,
            start: rec.startTime,
            end: rec.endTime,
            written: rec.metadata?.lastModifiedTime,
          });
        }
      }
    } catch (e) {
      rows.push({ type, error: String(e) });
    }
  }
  log('inventory', { platform: 'android', rows });
  return rows;
}

// Muss im globalen Scope definiert sein (siehe Expo-Doku zu BackgroundTask).
export function defineAndroidTask() {
  TaskManager.defineTask(ANDROID_TASK, async () => {
    await importAndroidChanges('background');
    return BackgroundTask.BackgroundTaskResult.Success;
  });
}

export async function triggerAndroidTaskForTesting() {
  const ok = await BackgroundTask.triggerTaskWorkerForTestingAsync();
  log('info', { msg: 'Test-Auslösung (nur Debug)', ok });
}
