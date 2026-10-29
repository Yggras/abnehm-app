import { buildSeedState, type SeedPart } from './build.ts';
import { seedAccounts, seedClock, seedDays, seedIds, seedInstallations } from './ids.ts';
import { SeedManifest } from './manifest.ts';

// Szenario `frisches_konto` (Spezifikation 1, Abschnitt 12; #138): Philipp hat gerade ein Konto
// angelegt, der Bootstrap hat seine Person mit Anzeigename und `onboarding_status = begonnen`
// erzeugt. Weitere Daten gibt es nicht, auch keine Bestätigung des Hinweises aus Schritt 1. Das iPhone
// ist auf dem Stand des Servers; die Sitzungs-Weiche führt ins Onboarding, und es beginnt vor
// Schritt 1 („disclaimer_accepted_at fehlt → Schritt 1“, Abschnitt 9). Alles ist erfunden.

const philipp = seedIds.person.philipp;
const bootstrappedAt = '2026-10-14T11:55:00.000Z';

/** Fundament: die Person, wie sie der Bootstrap anlegt. */
const fundament: SeedPart = {
  area: 'fundament',
  entities: [
    {
      table: 'person',
      entityType: 'person',
      ownerPersonId: philipp,
      row: {
        id: philipp,
        account_id: seedIds.account.philipp,
        display_name: 'Philipp',
        calculation_sex: null,
        birth_date: null,
        height_cm: null,
        activity_level: null,
        pregnant_or_breastfeeding: null,
        known_eating_disorder: null,
        disclaimer_accepted_at: null,
        onboarding_status: 'begonnen',
        onboarding_completed_at: null,
        goal_weight_reached_g: null,
        goal_weight_reached_at: null,
        time_zone: seedClock.timeZone,
        created_at: bootstrappedAt,
        updated_at: bootstrappedAt,
        deleted_at: null,
      },
    },
  ],
};

const state = buildSeedState({
  parts: [fundament],
  createdAt: seedClock.instant,
  devices: { [seedInstallations.philippIphone.key]: { personId: philipp, cursor: 'latest' } },
});

export const frischesKontoManifest = SeedManifest.parse({
  formatVersion: 1,
  scenario: 'frisches_konto',
  revision: 1,
  clock: seedClock,
  localDates: seedDays,
  catalogVersion: null,
  accounts: [seedAccounts.philipp],
  installations: [seedInstallations.philippIphone],
  initial: state,
  // Ein Sync ändert nichts: Das iPhone ist schon auf dem Stand des Servers.
  steps: [{ type: 'sync', installation: seedInstallations.philippIphone.key }],
  target: state,
});
