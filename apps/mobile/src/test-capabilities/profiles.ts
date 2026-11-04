import { z } from 'zod';

import { TimeZone } from '@abnehm/contracts/base';

import type { AppTestClock, ClockAdjustment } from './clock';
import type { FaultController, FaultPlan } from './faults';

// Laufzeitprofile (Spezifikation 0, Abschnitt 12; #113): benannte, deterministische Zeit-, Transport-,
// Auth-, Storage- und Serverfehler. Ein Profil ist kein persistenter Seed-Zustand; es stellt nur die
// Test-Adapter der App-Sitzung, also Fehler-Adapter und Testuhr, und läuft deshalb wie diese
// ausschließlich über die Build-Capability-Grenze (`src/build-capabilities.ts`). Es ändert nur, was es
// nennt: Profile lassen sich kombinieren, etwa `transport-offline` und dann `uhr-ungesichert-24h`.
// Zurück auf „alles normal“ stellt der Link `fehler` ohne Parameter; die Testuhr stellt erst ein neuer
// Seed zurück.

/** Welche Art Fehler ein Profil abbildet. */
export type RuntimeProfileKind = 'zeit' | 'transport' | 'auth' | 'storage' | 'server';

export type RuntimeProfile = Readonly<{
  kind: RuntimeProfileKind;
  description: string;
  faults?: Partial<FaultPlan>;
  clock?: ClockAdjustment;
}>;

export const runtimeProfiles = {
  'uhr-ungesichert-24h': {
    kind: 'zeit',
    description: 'Testuhr 25 Stunden vor: Eine ungesicherte Änderung ist älter als 24 Stunden („Noch nicht gesichert …“).',
    clock: { advanceHours: 25 },
  },
  'uhr-reise': {
    kind: 'zeit',
    description: 'Eigene Zone wechselt nach Pacific/Kiritimati (UTC+14) wie bei einer Reise; die App meldet den Zeitzonenwechsel.',
    clock: { timeZone: TimeZone.parse('Pacific/Kiritimati') },
  },
  'transport-offline': {
    kind: 'transport',
    description: 'Keine Verbindung: Anfragen scheitern wie `fetch` ohne Netz, der Sync sieht kein Netz.',
    faults: { transport: 'offline' },
  },
  'transport-antwort-verloren': {
    kind: 'transport',
    description: 'Der Server verarbeitet die Anfrage, die Antwort geht verloren.',
    faults: { transport: 'response_lost' },
  },
  'server-nicht-verfuegbar': {
    kind: 'server',
    description: 'Vorübergehender Serverfehler: jede Anfrage endet mit 503 ohne Body.',
    faults: { server: 'unavailable' },
  },
  'auth-sitzung-abgelehnt': {
    kind: 'auth',
    description: 'Der Server lehnt jede Sitzung mit 401 ab; die App sperrt das Konto.',
    faults: { auth: 'session_rejected' },
  },
  'storage-nicht-verfuegbar': {
    kind: 'storage',
    description: 'Der geschützte Speicher (SecureStore) liest und schreibt nicht.',
    faults: { storage: 'unavailable' },
  },
} as const satisfies Record<string, RuntimeProfile>;

export const runtimeProfileKeySchema = z.enum(Object.keys(runtimeProfiles) as [keyof typeof runtimeProfiles, ...(keyof typeof runtimeProfiles)[]]);
export type RuntimeProfileKey = z.infer<typeof runtimeProfileKeySchema>;

/** Stellt Fehler-Adapter und Testuhr auf das Profil. */
export function applyRuntimeProfile(key: RuntimeProfileKey, { faults, clock }: { faults: FaultController; clock: AppTestClock }): void {
  const profile: RuntimeProfile = runtimeProfiles[key];
  if (profile.faults !== undefined) faults.set(profile.faults);
  if (profile.clock !== undefined) clock.adjust(profile.clock);
}
