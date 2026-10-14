import { File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

// Ereignisprotokoll als JSON Lines im Dokumentenordner. Funktioniert auch im
// Hintergrund-Kontext (iOS-HealthKit-Wecken, Android-Headless-Task).

export type LogEntry = {
  at: string; // Zeitpunkt des Eintrags (ISO)
  kind: string; // z. B. wake, sample, upload, error, info
  [key: string]: unknown;
};

const logFile = () => new File(Paths.document, 'health-spike-log.jsonl');
const stateFile = () => new File(Paths.document, 'health-spike-state.json');

export function log(kind: string, data: Record<string, unknown> = {}) {
  const entry: LogEntry = { at: new Date().toISOString(), kind, ...data };
  try {
    const file = logFile();
    if (!file.exists) file.create();
    file.write(JSON.stringify(entry) + '\n', { append: true });
  } catch (e) {
    console.warn('Protokoll nicht schreibbar', e);
  }
  return entry;
}

export function readLog(): LogEntry[] {
  try {
    const file = logFile();
    if (!file.exists) return [];
    return file
      .textSync()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as LogEntry);
  } catch {
    return [];
  }
}

export function readLogRaw(): string {
  const file = logFile();
  return file.exists ? file.textSync() : '';
}

export function clearLog() {
  const file = logFile();
  if (file.exists) file.delete();
}

// Kleiner Schlüssel-Wert-Speicher für Anker, Change-Tokens und Einstellungen.
export function readState(): Record<string, string> {
  try {
    const file = stateFile();
    return file.exists ? JSON.parse(file.textSync()) : {};
  } catch {
    return {};
  }
}

export function writeState(patch: Record<string, string | undefined>) {
  const next = { ...readState(), ...patch };
  for (const key of Object.keys(next)) if (next[key] === undefined) delete next[key];
  const file = stateFile();
  if (!file.exists) file.create();
  file.write(JSON.stringify(next));
}

export const minutesBetween = (from: Date | string, to: Date | string) =>
  Math.round(((new Date(to).getTime() - new Date(from).getTime()) / 60000) * 10) / 10;

export const platformLabel = Platform.OS === 'ios' ? 'iPhone' : 'Android';
