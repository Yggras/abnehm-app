import { buildSeedState, changedOnServer, pulledBy } from './build.ts';
import { annasProjectionsNow, annasSummaries, gekoppeltExtensions, gekoppeltPartsWith, partnerDailyGoalStatusEntity, type AnnasProjections } from './gekoppelt.ts';
import { seedAccounts, seedClock, seedDays, seedIds, seedInstallations } from './ids.ts';
import { SeedManifest } from './manifest.ts';

// Randzustand `veralteter_partnerstand` (Spezifikation 0, Abschnitt 12; #113). Er gleicht `gekoppelt`,
// nur hat Philipp zuletzt um 08:30 Uhr (06:30 UTC) gezogen: Was er von Anna sieht, ist der Stand von
// damals. Anna hatte da noch kein Wasser und ein erfülltes Tagesziel (Sporteinheit um 06:16 UTC), also
// den groben Tageszielstand „unterwegs“. Seitdem hat sie ihr Wasserziel erfüllt.
//
// Der Schritt ist Philipps Sync. Der Vor-Pull-Schritt der Partner-Projektionen (#106) rechnet zur Uhr des
// Manifests neu, was älter als 10 Minuten ist, mit derselben ID und Generation, neuem Datenstand und je der
// nächsten Serverversion: Annas Zusammenfassungen Wasser (jetzt 100 %), Sport und Gewicht (unverändert,
// nur bestätigt; Projectors aus #181), danach ihren Tageszielstand „fast_geschafft“. Philipps Pull
// übernimmt alles. Ernährung hält Anna privat; der Projector dazu kommt mit Spezifikation 2. Anna
// synchronisiert nicht; ihr Gerät bleibt, wie es war.
//
// Das Development-Backend nutzt bis #271 die Systemuhr; per Seed-Link rechnet der erste Pull deshalb
// für den echten Tag. Den Sollzustand zeigen die Tests mit Testuhr.

const philipp = seedIds.person.philipp;
const anna = seedIds.person.anna;
const iphone = seedInstallations.philippIphone.key;

/** Annas Projektionen für Philipp, zuletzt um 06:30 UTC berechnet. */
const stale: AnnasProjections = { dataAsOf: '2026-10-14T06:30:00.000Z', waterPercent: 0, stage: 'unterwegs' };

const initial = buildSeedState({
  parts: gekoppeltPartsWith(stale),
  createdAt: seedClock.instant,
  devices: {
    [iphone]: { personId: philipp, cursor: 'latest' },
    [seedInstallations.annaAndroid.key]: { personId: anna, cursor: 'latest' },
  },
});

/** Annas Projektionen zur Uhr des Manifests; die Zeilen behalten ID, Generation und Anlagezeitpunkt. */
const fresh = [...annasSummaries(annasProjectionsNow), partnerDailyGoalStatusEntity('anna', annasProjectionsNow.stage, annasProjectionsNow.dataAsOf)];
const refreshed = changedOnServer(initial, {
  createdAt: seedClock.instant,
  changes: fresh.map((entity) => ({ ...entity, row: { ...entity.row, created_at: stale.dataAsOf } })),
});

export const veralteterPartnerstandManifest = SeedManifest.parse({
  formatVersion: 1,
  scenario: 'veralteter_partnerstand',
  // Revision 3: Annas Zusammenfassungen rechnet der Sync seit #181 mit neu; Tracker-Daten aus `gekoppelt` (#181).
  // Revision 2: Mahlzeitenfotos seit #162 im Änderungsprotokoll, mit Bilddaten und abgelaufenem Fotoentwurf.
  revision: 3,
  clock: seedClock,
  localDates: seedDays,
  catalogVersion: null,
  accounts: [seedAccounts.philipp, seedAccounts.anna],
  installations: [seedInstallations.philippIphone, seedInstallations.annaAndroid],
  initial,
  steps: [{ type: 'sync', installation: iphone }],
  target: pulledBy(refreshed, iphone, philipp),
  extensions: gekoppeltExtensions,
});
