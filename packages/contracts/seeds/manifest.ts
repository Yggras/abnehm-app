import { z } from 'zod';

import { EntityId, Instant, LocalDate, SyncCursor, TimeZone } from '../src/base.ts';
import { InviteCode } from '../src/coupling.ts';
import { DailyGoalCause } from '../src/daily-goals.ts';
import { NotificationPermission } from '../src/notifications.ts';
import { PhotoImageKey } from '../src/nutrition.ts';
import { InstallationId, OutboxOperation } from '../src/sync.ts';

// Format der Seed-Manifeste (Spezifikation 0, Abschnitt 12; #112). Ein Manifest beschreibt ein
// Szenario vollständig: feste Uhr und Zone, benannte lokale Tage, Konten, Installationen und den
// erwarteten Ausgangs- und Sollzustand in Postgres und in der lokalen Datenbank jeder Installation.
// Zeilen stehen in kanonischer JSON-Form unter ihren SQL-Namen, wie sie beide Schemas gleich führen:
// UUIDs, lokale Tage (`YYYY-MM-DD`) und Zeitpunkte (UTC-ISO-8601 mit Millisekunden) als Text,
// Messwerte als Ganzzahl, `server_version` und Positionen als Dezimalzeichenfolge, JSON-Spalten als
// JSON. Konten und Sitzungen (Better-Auth-Tabellen) stehen nicht als Zeilen im Manifest: Der Seeder
// legt sie aus `accounts` an; nur dort steht die E-Mail. Verarbeitete Operationen nennt ein Sollzustand
// ohne Hashes und gespeicherte Antwort (`derivedColumns` in `canonical.ts`), Einladungen ohne den HMAC ihres
// Codes (`inviteCodes`).

/** Version des Formats; ein inkompatibles Format zählt sie hoch. */
export const seedFormatVersion = 1;

/**
 * Szenarien mit Manifest. `solo-wasser-*` sind Varianten von `solo` für jeden Status des
 * Wasser-Mini-Trackers (#171), `solo-sport-*` die Status „Wochenziel erreicht“ und „über dem
 * Wochenziel“ des Sport-Mini-Trackers (#173), `solo-ohne-wiegetag` der Randzustand „Wochenplan ohne Wiegetag“
 * (#175). `solo-gewicht-steigend`, `solo-gewicht-ohne-14-tage` und `solo-haltemodus` sind die Randzustände
 * „steigender Trend“, „kein Tagesgewicht in den letzten 14 Tagen“ und „Prognose im Haltemodus entfallen“ des
 * Gewichtstrends; „unter drei Tagesgewichten“ zeigt schon `solo` (#176). `frisches_konto` ist das erste Szenario aus Spezifikation 1 (#138). `leer` bis
 * `veralteter_partnerstand` sind die Randzustände aus Abschnitt 12 (#113), `zwei_installationen` und
 * `offline_sync` die Mehrgeräte- und Sync-Szenarien (#116). `solo-energie` (Laichkugel solo mit
 * gesammelter Energie) und `rollenwahl-offen` stammen aus Spezifikation 4, Abschnitt 13 (#180).
 * `einladung-nach-entkopplung` ist der Ausgangszustand der Reaktivierung per Code aus Spezifikation 5 (#120).
 * `tage_ohne_app_oeffnung` und `zeitzonen_reisen` sind „Tage ohne App-Öffnung“ und „Zeitzonen“ aus
 * Spezifikation 1, Abschnitt 12 (#131). `solo-haltemodus-*` (je Sicherheitsgrund), `solo-budget-angehoben`
 * und `solo-ziele-ab-morgen` sind „erzwungener Haltemodus“, „Budget angehoben“ und „bevorstehende Fassung
 * ‚ab morgen‘“ aus Spezifikation 1, Abschnitt 12, für die Einstellungsseite „Ziele“ (#147).
 * `ernaehrung-*` und `kalorienbudget-*` sind die Randzustände der Ernährung aus Spezifikation 2,
 * Abschnitt 13 (#166). `levelaufstieg-ausstehend` ist „Levelaufstieg ausstehend vor und nach dem Pull“ aus
 * Spezifikation 4, Abschnitt 13 (#200). `onboarding-unterbrochen` und `zweites-geraet` sind „Onboarding
 * unterbrochen“ und „zweites Gerät“ aus Spezifikation 1, Abschnitt 12 (#146).
 */
export const SeedScenarioKey = z.enum([
  'solo',
  'solo-wasser-leer',
  'solo-wasser-erreicht',
  'solo-wasser-ueber-ziel',
  'solo-sport-erreicht',
  'solo-sport-ueber-ziel',
  'solo-ohne-wiegetag',
  'solo-gewicht-steigend',
  'solo-gewicht-ohne-14-tage',
  'solo-haltemodus',
  'solo-haltemodus-schwanger',
  'solo-haltemodus-essstoerung',
  'solo-haltemodus-untergewicht',
  'solo-budget-angehoben',
  'solo-ziele-ab-morgen',
  'gekoppelt',
  'nach_entkopplung',
  'frisches_konto',
  'leer',
  'teilweise',
  'erfuellt',
  'nach_erfuellung_korrigiert',
  'tagesende_offen',
  'tagesende_abgeschlossen',
  'ernaehrung-offen',
  'ernaehrung-teilweise',
  'ernaehrung-erfuellt',
  'ernaehrung-nach-erfuellung-korrigiert',
  'kalorienbudget-unter-untergrenze',
  'kalorienbudget-im-budget',
  'kalorienbudget-ueber-budget',
  'veralteter_partnerstand',
  'zwei_installationen',
  'offline_sync',
  'solo-energie',
  'rollenwahl-offen',
  'einladung-nach-entkopplung',
  'tage_ohne_app_oeffnung',
  'zeitzonen_reisen',
  'haelfte-voll',
  'doppelausgabe',
  'feldkonflikt',
  'ereignisse-voll',
  'levelaufstieg-ausstehend',
  'challenge-vorgeschlagen',
  'challenge-verfallen',
  'challenge-passt-nicht',
  'budgetvorschlag-senken',
  'budgetvorschlag-anheben',
  'onboarding-unterbrochen',
  'zweites-geraet',
]);
export type SeedScenarioKey = z.infer<typeof SeedScenarioKey>;

/** Pfad der Seed-Route des Development-Backends; nur dort gibt es sie. */
export const seedRoutePath = '/dev/seed';

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
  /**
   * Erlaubnis für Mitteilungen auf diesem Gerät (Spezifikation 5, Abschnitt 10; #125). Sie ist
   * Systemzustand, keine Zeile: In Tests startet der Fake-Mitteilungs-Port damit, in Test-Artefakten
   * stellt der Seed-Link den Mitteilungs-Port der App darauf (`mitteilungen` in
   * `test/test-capabilities.ts`). Ohne Angabe bleibt die Erlaubnis, wie sie ist.
   */
  notificationPermission: NotificationPermission.optional(),
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

/** Benannte Operation zwischen Ausgangs- und Sollzustand. */
export const SeedStep = z.discriminatedUnion('type', [
  /**
   * Push und Pull einer Installation. Übernimmt der Pull tagesbezogene Entitäten, wertet der
   * Persistenzdienst der Tagesziele (#105) deren Tage in derselben Transaktion neu aus.
   */
  z.strictObject({ type: z.literal('sync'), installation: SeedKey }),
  /**
   * Der Persistenzdienst der Tagesziele (#105) einer Installation wertet Tage ihrer Person zur Uhr des
   * Manifests aus, etwa bei App-Öffnung (`app_oeffnung`) oder Tagesabschluss (`tagesabschluss`). Er legt
   * Erfüllungen, Gutschriften und Tagesbonus an und schreibt ihre Fachbefehle in die Outbox; deren
   * Operations-IDs vergibt der Sync-Writer der Reihe nach aus `operationIds`. `pull` entsteht nur im
   * Schritt `sync`. `at` ist die Uhrzeit des Geräts bei dieser Auswertung, etwa wenn zwei Geräte offline
   * nacheinander erfüllen (#116); ohne `at` gilt die Uhr des Manifests, und danach steht das Gerät wieder dort.
   */
  z.strictObject({
    type: z.literal('tagesziele_auswerten'),
    installation: SeedKey,
    localDates: z.array(LocalDate).min(1),
    cause: DailyGoalCause.exclude(['pull']),
    operationIds: z.array(EntityId),
    at: Instant.optional(),
  }),
  /**
   * Ein Auslöser von „Tagesziele sicherstellen“ des Plan-Moduls (Spezifikation 1, Abschnitt 5; #131) auf
   * einer Installation, etwa die App-Öffnung: Er legt heute und die fehlenden Tage der letzten 7 lokalen
   * Tage an und meldet abgelaufene Tage mit `tagesabschluss`. Die Operations-IDs seiner Fachbefehle
   * (`materializeDailyGoals`, dazu Erfüllungen und Tagesbonus) vergibt der Sync-Writer der Reihe nach aus
   * `operationIds`. `at` und `timeZone` stellen die Uhr des Geräts für diesen Auslöser, etwa nach einer
   * Reise; danach steht das Gerät wieder auf der Uhr und Zone des Manifests.
   */
  z.strictObject({
    type: z.literal('tagesziele_sicherstellen'),
    installation: SeedKey,
    operationIds: z.array(EntityId),
    at: Instant.optional(),
    timeZone: TimeZone.optional(),
  }),
  /**
   * Die App-Öffnung prüft auf einer Installation den Budgetvorschlag über das Plan-Modul (Spezifikation 1,
   * Abschnitt 7; #150), höchstens einmal je lokalem Tag. Die Operations-ID des Upserts eines neuen Vorschlags
   * vergibt der Sync-Writer aus `operationIds`. Gewichtstrend und Tagesaufnahme liest die Prüfung über die
   * Ports der Spezifikationen 2 und 3 aus der Gerätedatenbank.
   */
  z.strictObject({ type: z.literal('budgetvorschlag_pruefen'), installation: SeedKey, operationIds: z.array(EntityId) }),
  /**
   * Ein Mitglied entkoppelt über den Entkopplungs-Kern (#107) in eigener Transaktion, wie es der Befehl
   * `requestUncoupling` (Spezifikation 5) tun wird. Der Server nimmt die Entkopplung sofort an.
   */
  z.strictObject({ type: z.literal('entkoppeln'), account: SeedKey, couplingId: EntityId, actionId: EntityId, at: Instant }),
]);
export type SeedStep = z.infer<typeof SeedStep>;

const seedPhotoFields = {
  id: EntityId,
  /** Eigentümer des Fotos. */
  account: SeedKey,
  nutritionEntryId: EntityId,
  /** Konten außer dem Eigentümer, die das Foto im Ausgangszustand online sehen dürfen. */
  visibleTo: z.array(SeedKey),
};

const byte = z.int().min(0).max(255);

/**
 * Ein synthetisches Bild: eine Fläche in einer Farbe, die der Seeder als JPEG erzeugt. So bleiben die
 * Bilddaten klein, erfunden und im Manifest beschrieben statt als Datei im Repo.
 */
export const SyntheticImage = z.strictObject({
  width: z.int().min(1).max(1_280),
  height: z.int().min(1).max(1_280),
  rgb: z.tuple([byte, byte, byte]),
});
export type SyntheticImage = z.infer<typeof SyntheticImage>;

/**
 * Versionierte Erweiterungspunkte eines Szenarios (#117). Ein Punkt reserviert Inhalte, die ein späterer
 * Bereich liefert, samt fester IDs und Erwartungen. Der liefernde Bereich füllt ihn, indem er eine neue
 * Fassung (`version`) ergänzt; Tests erkennen an der Fassung, was schon vorliegt.
 */
export const SeedExtensions = z.strictObject({
  /**
   * Geteilte Mahlzeitenfotos von heute. Fassung 1: Fotos samt Ernährungseintrag als Zeilen mit festen IDs
   * und ihrer erwarteten Online-Sichtbarkeit (Fotoliste, Bildabruf). Fassung 2 (#162) ergänzt die
   * Bilddaten: je Foto Bildschlüssel und ein synthetisches Bild, das der Seeder in die Fotoablage legt,
   * dazu abgelaufene Fotoentwürfe als Randzustand.
   */
  mealPhotos: z
    .discriminatedUnion('version', [
      z.strictObject({ version: z.literal(1), photos: z.array(z.strictObject(seedPhotoFields)) }),
      z.strictObject({
        version: z.literal(2),
        photos: z.array(z.strictObject({ ...seedPhotoFields, imageKey: PhotoImageKey, image: SyntheticImage })),
        /** Server-only: abgelaufen, also nicht mehr bestätigbar; der Aufräumjob löscht ihn beim nächsten Lauf. */
        expiredDrafts: z.array(z.strictObject({ id: EntityId, account: SeedKey, imageKey: PhotoImageKey, image: SyntheticImage })),
      }),
    ])
    .optional(),
  /**
   * Der antwortbedürftige Vorgang: ein offenes Deko-Geschenk. Fassung 1 reserviert nur ID und Beteiligte;
   * Art `deko_schenken`, Deko-Katalog und Lager liefert Spezifikation 4 (#198) als Fassung 2.
   */
  decoGift: z
    .discriminatedUnion('version', [
      z.strictObject({ version: z.literal(1), state: z.literal('reserviert'), actionId: EntityId, from: SeedKey, to: SeedKey }),
    ])
    .optional(),
  /**
   * Klartext der Codes offener Einladungen (#120), je Zeile in `invitation`. Der Server speichert nur den HMAC
   * eines Codes unter seinem Einladungs-Secret; der Seeder bildet ihn beim Einfügen. Die Zeilen im Manifest
   * nennen deshalb keinen `code_hmac`, und der kanonische Vergleich lässt ihn aus (`derivedColumns`).
   */
  inviteCodes: z
    .discriminatedUnion('version', [
      z.strictObject({ version: z.literal(1), codes: z.array(z.strictObject({ invitationId: EntityId, code: InviteCode })) }),
    ])
    .optional(),
});
export type SeedExtensions = z.infer<typeof SeedExtensions>;

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
    extensions: SeedExtensions.optional(),
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
      if (step.type !== 'entkoppeln' && !installationKeys.has(step.installation)) problem(`Schritt ${step.type}: unbekannte Installation ${step.installation}`);
      if (step.type === 'entkoppeln' && !accountKeys.has(step.account)) problem(`Schritt ${step.type}: unbekanntes Konto ${step.account}`);
    }
    // Eine Operations-ID gibt es nur einmal: in den Outboxen des Ausgangszustands und in den Schritten.
    const operationIds = [
      ...Object.values(manifest.initial.devices).flatMap((device) => device.outbox.map((operation) => operation.operationId)),
      ...manifest.steps.flatMap((step) => ('operationIds' in step ? step.operationIds : [])),
    ];
    for (const value of duplicates(operationIds)) problem(`Operations-ID doppelt: ${value}`);

    const { mealPhotos, decoGift, inviteCodes } = manifest.extensions ?? {};
    const personOf = new Map(manifest.accounts.map((account) => [account.key, account.personId]));
    const rows = (table: string) => manifest.initial.server[table] ?? [];
    for (const photo of mealPhotos?.photos ?? []) {
      for (const key of [photo.account, ...photo.visibleTo]) if (!accountKeys.has(key)) problem(`Mahlzeitenfoto ${photo.id}: unbekanntes Konto ${key}`);
      const owner = personOf.get(photo.account);
      if (!rows('meal_photo').some((row) => row.id === photo.id && row.person_id === owner)) problem(`Mahlzeitenfoto ${photo.id} fehlt im Ausgangszustand`);
      if (!rows('nutrition_entry').some((row) => row.id === photo.nutritionEntryId && row.meal_photo_id === photo.id)) {
        problem(`Mahlzeitenfoto ${photo.id}: Ernährungseintrag ${photo.nutritionEntryId} fehlt`);
      }
      if ('imageKey' in photo && !rows('meal_photo').some((row) => row.id === photo.id && row.image_key === photo.imageKey)) {
        problem(`Mahlzeitenfoto ${photo.id}: Bildschlüssel passt nicht zur Zeile`);
      }
    }
    for (const draft of mealPhotos?.version === 2 ? mealPhotos.expiredDrafts : []) {
      const owner = personOf.get(draft.account);
      const row = rows('photo_draft').find((candidate) => candidate.id === draft.id);
      if (row === undefined || row.person_id !== owner || row.image_key !== draft.imageKey) problem(`Fotoentwurf ${draft.id} fehlt im Ausgangszustand`);
      else if (String(row.expires_at) > manifest.clock.instant) problem(`Fotoentwurf ${draft.id} ist nicht abgelaufen`);
    }
    const codes = inviteCodes?.codes ?? [];
    for (const value of duplicates(codes.map((entry) => entry.invitationId))) problem(`Einladungscode doppelt: ${value}`);
    for (const [name, state] of [['initial', manifest.initial], ['target', manifest.target]] as const) {
      for (const row of state.server.invitation ?? []) {
        if ('code_hmac' in row) problem(`${name}: Einladung ${String(row.id)} nennt ihren HMAC; der Seeder bildet ihn aus \`inviteCodes\``);
        if (!codes.some((entry) => entry.invitationId === row.id)) problem(`${name}: Einladung ${String(row.id)} ohne Code in \`inviteCodes\``);
      }
    }
    for (const entry of codes) {
      if (!rows('invitation').some((row) => row.id === entry.invitationId)) problem(`Einladungscode ${entry.invitationId}: Einladung fehlt im Ausgangszustand`);
    }
    if (decoGift !== undefined) {
      for (const key of [decoGift.from, decoGift.to]) if (!accountKeys.has(key)) problem(`Deko-Geschenk: unbekanntes Konto ${key}`);
      // Reserviert heißt: Die ID belegt noch keine Zeile, bis Spezifikation 4 den Punkt füllt.
      for (const [name, state] of [['initial', manifest.initial], ['target', manifest.target]] as const) {
        if (JSON.stringify(state).includes(decoGift.actionId)) problem(`${name}: reservierte ID des Deko-Geschenks ist belegt`);
      }
    }
  });
export type SeedManifest = z.infer<typeof SeedManifest>;
