import { z } from 'zod';

import { EntityId, Instant, LocalDate, SyncCursor, TimeZone } from '../src/base.ts';
import { InstallationId, OutboxOperation } from '../src/sync.ts';

// Format der Seed-Manifeste (Spezifikation 0, Abschnitt 12; #112). Ein Manifest beschreibt ein
// Szenario vollständig: feste Uhr und Zone, benannte lokale Tage, Konten, Installationen und den
// erwarteten Ausgangs- und Sollzustand in Postgres und in der lokalen Datenbank jeder Installation.
// Zeilen stehen in kanonischer JSON-Form unter ihren SQL-Namen, wie sie beide Schemas gleich führen:
// UUIDs, lokale Tage (`YYYY-MM-DD`) und Zeitpunkte (UTC-ISO-8601 mit Millisekunden) als Text,
// Messwerte als Ganzzahl, `server_version` und Positionen als Dezimalzeichenfolge, JSON-Spalten als
// JSON. Konten und Sitzungen (Better-Auth-Tabellen) stehen nicht als Zeilen im Manifest: Der Seeder
// legt sie aus `accounts` an; nur dort steht die E-Mail.

/** Version des Formats; ein inkompatibles Format zählt sie hoch. */
export const seedFormatVersion = 1;

/** Szenarien mit Manifest. Die übrigen aus Abschnitt 12 folgen in #113, #116 und #117. */
export const SeedScenarioKey = z.enum(['solo']);
export type SeedScenarioKey = z.infer<typeof SeedScenarioKey>;

/** Body von `POST /dev/seed` des Development-Backends. */
export const SeedRequest = z.strictObject({ scenario: SeedScenarioKey });
export type SeedRequest = z.infer<typeof SeedRequest>;

/** Kurzname eines Kontos, einer Installation oder eines lokalen Tags im Manifest. */
export const SeedKey = z.string().regex(/^[a-z][a-z0-9-]{0,39}$/);
export type SeedKey = z.infer<typeof SeedKey>;

export type SeedValue = string | number | boolean | null | SeedValue[] | { [key: string]: SeedValue };
export const SeedValue: z.ZodType<SeedValue> = z.lazy(() =>
  z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(SeedValue), z.record(z.string(), SeedValue)]),
);

const sqlName = z.string().regex(/^[a-z][a-z0-9_]*$/);

/** Eine Zeile unter ihren Spaltennamen. */
export const SeedRow = z.record(sqlName, SeedValue);
export type SeedRow = z.infer<typeof SeedRow>;

/** Zeilen je Tabelle. */
export const SeedRows = z.record(sqlName, z.array(SeedRow));
export type SeedRows = z.infer<typeof SeedRows>;

/** Ausschließlich synthetische Adressen der reservierten Domain `.test` (RFC 2606). */
const TestEmail = z.email().refine((email) => email.endsWith('.test'), { message: 'Nur synthetische `.test`-Adressen' });

export const SeedAccount = z.strictObject({
  key: SeedKey,
  /** Better-Auth-Konto. */
  accountId: EntityId,
  /** Die eine Person des Kontos. */
  personId: EntityId,
  email: TestEmail,
  /** Dokumentiertes Testpasswort; der Seeder speichert nur seinen gesalzenen Hash. */
  password: z.string().min(10).max(128),
});
export type SeedAccount = z.infer<typeof SeedAccount>;

export const SeedInstallation = z.strictObject({
  key: SeedKey,
  installationId: InstallationId,
  account: SeedKey,
  platform: z.enum(['ios', 'android']),
});
export type SeedInstallation = z.infer<typeof SeedInstallation>;

/** Lokale Datenbank einer Installation: Fachzeilen, Pull-Cursor und offene Operationen in Reihenfolge. */
export const SeedDeviceState = z.strictObject({
  rows: SeedRows,
  cursor: SyncCursor.nullable(),
  outbox: z.array(OutboxOperation),
});
export type SeedDeviceState = z.infer<typeof SeedDeviceState>;

/** Gesamtzustand: Postgres ohne Better-Auth-Tabellen und je Installation die lokale Datenbank. */
export const SeedState = z.strictObject({
  server: SeedRows,
  devices: z.record(SeedKey, SeedDeviceState),
});
export type SeedState = z.infer<typeof SeedState>;

/** Benannte Operation zwischen Ausgangs- und Sollzustand; weitere Arten ergänzen #113, #116 und #117. */
export const SeedStep = z.discriminatedUnion('type', [z.strictObject({ type: z.literal('sync'), installation: SeedKey })]);
export type SeedStep = z.infer<typeof SeedStep>;

/** Tabellen des Auth-Moduls; ihr Inhalt entsteht aus `accounts` bzw. erst bei der Anmeldung. */
export const authTables = ['user', 'account', 'session', 'verification'] as const;

const emailPattern = /[^\s@"]+@[^\s@"]+\.[^\s@"]+/;

export const SeedManifest = z
  .strictObject({
    formatVersion: z.literal(seedFormatVersion),
    scenario: SeedScenarioKey,
    /** Stand des Szenarios; jede inhaltliche Änderung zählt sie hoch. */
    revision: z.int().positive(),
    clock: z.strictObject({ instant: Instant, timeZone: TimeZone }),
    localDates: z.record(SeedKey, LocalDate),
    /** Version des Lebensmittelkatalogs (Spezifikation 2); `null`, solange das Szenario keinen nutzt. */
    catalogVersion: z.string().min(1).nullable(),
    accounts: z.array(SeedAccount).min(1),
    installations: z.array(SeedInstallation),
    initial: SeedState,
    steps: z.array(SeedStep),
    target: SeedState,
  })
  .superRefine((manifest, context) => {
    const problem = (message: string) => context.addIssue({ code: 'custom', message });
    const duplicates = (values: readonly string[]) => values.filter((value, index) => values.indexOf(value) !== index);
    for (const field of ['key', 'accountId', 'personId', 'email'] as const) {
      for (const value of duplicates(manifest.accounts.map((account) => account[field]))) problem(`Konto doppelt: ${field} ${value}`);
    }
    for (const field of ['key', 'installationId'] as const) {
      for (const value of duplicates(manifest.installations.map((installation) => installation[field]))) {
        problem(`Installation doppelt: ${field} ${value}`);
      }
    }
    const accountKeys = new Set(manifest.accounts.map((account) => account.key));
    const installationKeys = new Set(manifest.installations.map((installation) => installation.key));
    for (const installation of manifest.installations) {
      if (!accountKeys.has(installation.account)) problem(`Installation ${installation.key}: unbekanntes Konto ${installation.account}`);
    }
    for (const [name, state] of [['initial', manifest.initial], ['target', manifest.target]] as const) {
      for (const key of Object.keys(state.devices)) if (!installationKeys.has(key)) problem(`${name}: unbekannte Installation ${key}`);
      for (const table of authTables) if (table in state.server) problem(`${name}: ${table} entsteht aus den Konten, nicht aus Zeilen`);
      // E-Mails stehen nur in `accounts` (und daraus in den Better-Auth-Tabellen), nie in Fachzeilen.
      if (emailPattern.test(JSON.stringify(state))) problem(`${name}: E-Mail-Adresse außerhalb der Konten`);
    }
    for (const step of manifest.steps) {
      if (!installationKeys.has(step.installation)) problem(`Schritt ${step.type}: unbekannte Installation ${step.installation}`);
    }
  });
export type SeedManifest = z.infer<typeof SeedManifest>;
