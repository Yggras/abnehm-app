import { SharedEventType, WirContribution, WirContributionsState } from '../src/wir.ts';
import { fixtures, without } from './define.ts';
import { challenge, island, now, project, sharedAction, sharedEvent } from './ids.ts';

const proposal = {
  type: 'challenge',
  id: challenge,
  dataAsOf: now,
  action: { actionId: 'challenge.open', target: { type: 'challenge.detail', challengeId: challenge } },
  challengeId: challenge,
  templateKey: 'gut_getrunken',
  status: 'vorgeschlagen',
  proposedBySelf: false,
  ownCount: 0,
  ownRequired: 6,
  stage: 'gestartet',
  endsAt: '2026-10-16T12:00:00.000Z',
} as const;

const projectContribution = {
  type: 'community_project',
  id: project,
  dataAsOf: now,
  action: { actionId: 'momo.open_project', target: { type: 'momo', view: 'projekt' } },
  projectId: project,
  templateKey: 'leuchtturm',
  ownRole: 'bauen',
  ownCount: 12,
  ownRequired: 30,
  stage: 'gut_unterwegs',
} as const;

const gift = {
  type: 'pending_shared_action',
  id: sharedAction,
  dataAsOf: now,
  actionId: sharedAction,
  kind: 'deko_schenken',
  requesterDisplayName: 'Anna',
} as const;

const levelUp = {
  type: 'shared_event',
  id: sharedEvent,
  dataAsOf: now,
  eventId: sharedEvent,
  eventType: 'levelaufstieg',
  occurredAt: now,
  messageKey: 'neu_bei_euch.levelaufstieg',
  objectId: island,
} as const;

export const wirFixtures = {
  SharedEventType: fixtures(SharedEventType, {
    valid: { 'Momo geschlüpft': 'momo_geschluepft', 'Challenge beendet': 'challenge_beendet' },
    invalid: { 'Bau einer Person': 'objekt_gebaut', 'Tageszielerfüllung': 'tagesziel_erfuellt' },
  }),
  WirContribution: fixtures(WirContribution, {
    valid: {
      'fremder Challenge-Vorschlag': proposal,
      'aktive Challenge ohne Enddatum': { ...without(proposal, 'endsAt'), status: 'aktiv', proposedBySelf: true },
      'Gemeinschaftsprojekt': projectContribution,
      'Levelaufstieg': levelUp,
      'Deko-Geschenk': gift,
    },
    invalid: {
      'exakter Partneranteil in der Challenge': { ...proposal, partnerCount: 3 },
      'exakter Partneranteil im Projekt': { ...projectContribution, partnerCount: 18 },
      'Entkoppeln als Anfrage': { ...gift, kind: 'entkoppeln' },
      'Stufe als Prozent': { ...projectContribution, stage: 0.4 },
      'Ereignis mit sichtbarem Text': { ...levelUp, messageKey: 'Momo ist jetzt auf Level 7' },
      'ohne dataAsOf': without(gift, 'dataAsOf'),
    },
  }),
  WirContributionsState: fixtures(WirContributionsState, {
    valid: {
      'lädt': { type: 'loading' },
      'bereit': { type: 'ready', data: [gift, projectContribution, levelUp] },
      'veraltet': { type: 'stale', data: [levelUp], dataAsOf: now },
      'Fehler mit Wiederholen': {
        type: 'error',
        code: 'full_resync_required',
        retryAction: { actionId: 'wir.retry', target: { type: 'partner' } },
      },
    },
    invalid: {
      'bereit ohne Daten': { type: 'ready' },
      'veraltet ohne Datenstand': { type: 'stale', data: [] },
      'Fehler als Text': { type: 'error', code: 'Sync fehlgeschlagen' },
    },
  }),
};
