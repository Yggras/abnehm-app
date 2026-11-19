import { nachEntkopplungManifest } from './nach-entkopplung.ts';
import { seedClock, seedIds, seedInviteCodes } from './ids.ts';
import { SeedManifest, type SeedState } from './manifest.ts';

// Szenario `einladung-nach-entkopplung` (Spezifikation 5, Abschnitt 5 und Testing Decisions; #120): der
// Ausgangszustand des Maestro-Ablaufs „Code eines geseedeten zweiten Kontos eingeben → Reaktivierungsvorschau
// → gekoppelt“. Es ist der Sollzustand von `nach_entkopplung` (Anna hat entkoppelt, beide Geräte haben gezogen:
// Kopplung und Insel archiviert, Partnercaches leer), dazu eine offene Einladung von Anna mit dem bekannten
// Code `seedInviteCodes.annasEinladung`. Gibt Philipp ihn ein, nennt „Code prüfen“ Anna mit `reactivates = true`,
// und die Annahme reaktiviert die archivierte Kopplung desselben Paars. Alle IDs außer der Einladung stammen
// aus #117.

/** Erstellt eine Stunde vor der Uhr des Manifests, gültig 24 Stunden wie jede Einladung (`INVITATION_VALIDITY_MS`). */
const createdAt = new Date(Date.parse(seedClock.instant) - 60 * 60_000).toISOString();
const expiresAt = new Date(Date.parse(createdAt) + 24 * 60 * 60_000).toISOString();

const afterUncoupling = nachEntkopplungManifest.target;

const state: SeedState = {
  server: {
    ...afterUncoupling.server,
    invitation: [
      {
        id: seedIds.invitation.annasEinladung,
        inviter_person_id: seedIds.person.anna,
        expires_at: expiresAt,
        consumed_at: null,
        consumed_by_person_id: null,
        created_at: createdAt,
      },
    ],
  },
  devices: afterUncoupling.devices,
};

export const einladungNachEntkopplungManifest = SeedManifest.parse({
  ...nachEntkopplungManifest,
  scenario: 'einladung-nach-entkopplung',
  revision: 1,
  initial: state,
  // Die Geräte sind schon auf dem Stand des Servers; ein Sync ändert nichts.
  steps: nachEntkopplungManifest.installations.map(({ key }) => ({ type: 'sync', installation: key })),
  target: state,
  extensions: {
    ...nachEntkopplungManifest.extensions,
    inviteCodes: { version: 1, codes: [{ invitationId: seedIds.invitation.annasEinladung, code: seedInviteCodes.annasEinladung }] },
  },
});
