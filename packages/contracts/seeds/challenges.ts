import { EntityId, LocalDate } from '../src/base.ts';
import { notificationIntentId } from '../src/notifications.ts';
import { weeklyPlanVersionId } from '../src/plan.ts';
import { buildSeedState, changedOnServer, pulledBy, type SeedEntity, type SeedPart } from './build.ts';
import { gekoppeltExtensions, gekoppeltParts } from './gekoppelt.ts';
import { seedAccounts, seedClock, seedDays, seedIds, seedInstallations } from './ids.ts';
import { SeedManifest, type SeedRow, type SeedState } from './manifest.ts';
import { seedCreated, seedWeeklyPlan } from './rows.ts';

// Szenarien der gemeinsamen Challenges (Spezifikation 4, Abschnitt 13; #210), mit denselben IDs, derselben
// Uhr und derselben Zone wie `gekoppelt`:
//
// - `challenge-vorgeschlagen`: `gekoppelt`, dazu hat Philipp heute um 9:00 Uhr „Gut getrunken“
//   vorgeschlagen. Der Vorschlag gilt bis Freitag, 9:00 Uhr; Anna muss antworten, der Push-Intent an sie
//   ist noch offen.
// - `challenge-verfallen`: `gekoppelt`, dazu hat Philipp am Montag um 9:00 Uhr „Aktive Woche“
//   vorgeschlagen, und Anna hat nicht geantwortet. Der Vorschlag ist seit heute 9:00 Uhr verfallen, aber
//   noch nicht festgeschrieben: Philipps Pull schreibt ihn neutral als `verfallen` fest, Annas Pull bringt
//   das auf ihr Gerät.
// - `challenge-passt-nicht` („Vorlage passt nicht zum Wochenplan“): `gekoppelt`, dazu hat Anna gestern Abend
//   einen Wochenplan ab morgen ohne „Ernährung erfasst“ gespeichert. In den sieben Tagen ab heute plant sie
//   den Baustein damit nie; „Ernährung im Blick“ passt nicht zu ihrem Plan.
//
// Alle Werte sind erfunden.

const philipp = seedIds.person.philipp;
const anna = seedIds.person.anna;
const couplingId = seedIds.coupling.philippAnna;
const iphone = seedInstallations.philippIphone.key;
const android = seedInstallations.annaAndroid.key;
const now = seedClock.instant;

/** Ein offener Vorschlag von Philipp, wie `proposeChallenge` ihn anlegt; Verfall 48 Stunden später. */
function proposal({ id, templateKey, proposedAt, expiresAt }: Proposal): SeedEntity {
  return {
    table: 'challenge',
    entityType: 'challenge',
    couplingId,
    row: {
      id,
      coupling_id: couplingId,
      template_key: templateKey,
      proposer_person_id: philipp,
      status: 'vorgeschlagen',
      proposed_at: proposedAt,
      proposal_expires_at: expiresAt,
      started_at: null,
      ends_at: null,
      ended_at: null,
      common_stage: null,
      challenge_deco_key: null,
      ...seedCreated(proposedAt),
    },
  };
}

type Proposal = Readonly<{ id: string; templateKey: string; proposedAt: string; expiresAt: string }>;

/** Der Intent `challenge_vorschlag` an Anna; nur Server, ohne Sync. */
function proposalIntent({ id, templateKey, proposedAt, expiresAt }: Proposal): SeedRow {
  return {
    intent_id: notificationIntentId({ sourceEventId: EntityId.parse(id), recipientPersonId: EntityId.parse(anna), type: 'challenge_vorschlag' }),
    source_event_id: id,
    recipient_person_id: anna,
    type: 'challenge_vorschlag',
    message_key: 'challenge_vorschlag',
    payload: { challengeId: id, templateKey, expiresAt, senderDisplayName: 'Philipp' },
    status: 'offen',
    created_at: proposedAt,
    status_changed_at: proposedAt,
  };
}

const withIntent = (state: SeedState, intent: SeedRow): SeedState => ({ ...state, server: { ...state.server, notification_intent: [intent] } });

const bothDevices = {
  [iphone]: { personId: philipp, cursor: 'latest' },
  [android]: { personId: anna, cursor: 'latest' },
} as const;

const steps = [
  { type: 'sync', installation: iphone },
  { type: 'sync', installation: android },
] as const;

const common = {
  formatVersion: 1,
  revision: 1,
  clock: seedClock,
  localDates: seedDays,
  catalogVersion: null,
  accounts: [seedAccounts.philipp, seedAccounts.anna],
  installations: [seedInstallations.philippIphone, seedInstallations.annaAndroid],
  extensions: gekoppeltExtensions,
} as const;

const offen: Proposal = { id: seedIds.challenge.philippsVorschlag, templateKey: 'gut_getrunken', proposedAt: '2026-10-14T07:00:00.000Z', expiresAt: '2026-10-16T07:00:00.000Z' };
const vorgeschlagenState = withIntent(
  buildSeedState({ parts: [...gekoppeltParts, { area: 'spiel', entities: [proposal(offen)] }], createdAt: now, devices: bothDevices }),
  proposalIntent(offen),
);

export const challengeVorgeschlagenManifest = SeedManifest.parse({
  ...common,
  scenario: 'challenge-vorgeschlagen',
  initial: vorgeschlagenState,
  // Ein Sync ändert nichts: Der Vorschlag ist offen, beide Geräte sind auf dem Stand.
  steps,
  target: vorgeschlagenState,
});

function verfallen() {
  const verfallend: Proposal = {
    id: seedIds.challenge.philippsVerfallenerVorschlag, templateKey: 'aktive_woche', proposedAt: '2026-10-12T07:00:00.000Z', expiresAt: '2026-10-14T07:00:00.000Z',
  };
  const vorschlag = proposal(verfallend);
  const initial = withIntent(
    buildSeedState({ parts: [...gekoppeltParts, { area: 'spiel', entities: [vorschlag] }], createdAt: now, devices: bothDevices }),
    // Der Push ging am Montag an Anna.
    { ...proposalIntent(verfallend), status: 'zugestellt', status_changed_at: '2026-10-12T07:00:05.000Z' },
  );
  // Der Vor-Pull-Schritt schreibt den Verfall fest: Ende ist die Frist, geändert zur Uhr des Servers.
  const expired: SeedEntity = { ...vorschlag, row: { ...vorschlag.row, status: 'verfallen', ended_at: '2026-10-14T07:00:00.000Z', updated_at: now } };
  const server = changedOnServer(initial, { createdAt: now, changes: [expired] });
  return { initial, target: pulledBy(pulledBy(server, iphone, philipp), android, anna) };
}

const verfallenStates = verfallen();

export const challengeVerfallenManifest = SeedManifest.parse({
  ...common,
  scenario: 'challenge-verfallen',
  initial: verfallenStates.initial,
  // Philipps Pull schreibt den Verfall fest, danach zieht Annas Android.
  steps,
  target: verfallenStates.target,
});

/** Annas Wochenplan ab morgen: dieselben Sporttage, statt „Ernährung erfasst“ Gewogen bzw. Kalorienbudget. */
const annasPlanAbMorgen = {
  montag: ['wasserziel', 'sporteinheit', 'gewogen'],
  dienstag: ['wasserziel', 'im_kalorienbudget', 'gewogen'],
  mittwoch: ['wasserziel', 'sporteinheit', 'im_kalorienbudget'],
  donnerstag: ['wasserziel', 'im_kalorienbudget', 'gewogen'],
  freitag: ['wasserziel', 'sporteinheit', 'gewogen'],
  samstag: ['wasserziel', 'sporteinheit', 'im_kalorienbudget'],
  sonntag: ['wasserziel', 'im_kalorienbudget', 'gewogen'],
} as const;

const morgen = LocalDate.parse('2026-10-15');

const passtNichtPart: SeedPart = {
  area: 'ziele',
  entities: [
    seedWeeklyPlan({
      id: weeklyPlanVersionId(EntityId.parse(anna), morgen),
      personId: anna,
      validFrom: morgen,
      createdAt: '2026-10-13T19:30:00.000Z',
      plan: annasPlanAbMorgen,
    }),
  ],
};

const passtNichtState = buildSeedState({ parts: [...gekoppeltParts, passtNichtPart], createdAt: now, devices: bothDevices });

export const challengePasstNichtManifest = SeedManifest.parse({
  ...common,
  scenario: 'challenge-passt-nicht',
  initial: passtNichtState,
  // Ein Sync ändert nichts; ob eine Vorlage passt, entscheidet erst ein Vorschlag.
  steps,
  target: passtNichtState,
});
