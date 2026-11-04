import { buildSeedState, changedOnServer, pulledBy } from './build.ts';
import { gekoppeltExtensions, gekoppeltPartsWith, partnerDailyGoalStatusEntity, type AnnasProjections } from './gekoppelt.ts';
import { seedAccounts, seedClock, seedDays, seedIds, seedInstallations } from './ids.ts';
import { SeedManifest } from './manifest.ts';

// Randzustand `veralteter_partnerstand` (Spezifikation 0, Abschnitt 12; #113). Er gleicht `gekoppelt`,
// nur hat Philipp zuletzt um 08:30 Uhr (06:30 UTC) gezogen: Was er von Anna sieht, ist der Stand von
// damals. Anna hatte da noch kein Wasser und ein erfülltes Tagesziel (Sporteinheit um 06:16 UTC), also
// den groben Tageszielstand „unterwegs“. Seitdem hat sie ihr Wasserziel erfüllt.
//
// Der Schritt ist Philipps Sync. Der Vor-Pull-Schritt der Partner-Projektionen (#106) rechnet Annas
// Tageszielstand zur Uhr des Manifests neu: „fast_geschafft“, dieselbe ID und Generation, neuer
// Datenstand und die nächste Serverversion, und Philipps Pull übernimmt ihn. Annas Zusammenfassungen
// bleiben auf dem alten Stand, bis die Bereiche ihre Projectors anmelden (Spezifikationen 2 und 3); dann
// ergänzen sie den Sollzustand und zählen die Revision hoch. Anna synchronisiert nicht; ihr Gerät
// bleibt, wie es war.
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

/** Annas Tageszielstand zur Uhr des Manifests; die Zeile behält ID, Generation und Anlagezeitpunkt. */
const fresh = partnerDailyGoalStatusEntity('anna', 'fast_geschafft', seedClock.instant);
const refreshed = changedOnServer(initial, {
  createdAt: seedClock.instant,
  changes: [{ ...fresh, row: { ...fresh.row, created_at: stale.dataAsOf } }],
});

export const veralteterPartnerstandManifest = SeedManifest.parse({
  formatVersion: 1,
  scenario: 'veralteter_partnerstand',
  // Revision 2: Mahlzeitenfotos seit #162 im Änderungsprotokoll, mit Bilddaten und abgelaufenem Fotoentwurf.
  revision: 2,
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
