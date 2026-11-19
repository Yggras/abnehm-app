import {
  AreaUnlockRecord,
  BlueprintUnlockRecord,
  ChallengeRecord,
  ChallengeRequirementRecord,
  CommunityProjectRecord,
  IslandEventRecord,
  IslandEventStateRecord,
  IslandFieldRecord,
  IslandObjectOrigin,
  IslandObjectRecord,
  VisitorEventDetails,
  VisitorReward,
} from '../src/island-records.ts';
import { fixtures } from './define.ts';
import { anna, challenge, coupling, island, islandEvent, islandField, now, philipp } from './ids.ts';

const owned = { islandId: island, couplingId: coupling };

const project = {
  ...owned,
  sequenceNumber: 1,
  templateKey: 'gartenhaeuschen',
  buildNeed: 20,
  natureNeed: 20,
  status: 'aktiv',
  completedAt: null,
  createdAt: now,
  updatedAt: now,
} as const;

const builtLantern = {
  ...owned,
  ownerPersonId: philipp,
  catalogKey: 'laterne',
  origin: 'gebaut',
  level: 1,
  fieldId: islandField,
  createdAt: now,
  updatedAt: now,
} as const;

const hatched = {
  ...owned,
  type: 'momo_geschluepft',
  templateKey: null,
  responsiblePersonId: null,
  occasionKey: 'geschluepft',
  status: 'abgeschlossen',
  reward: null,
  occurredAt: now,
  createdAt: now,
  updatedAt: now,
} as const;

const proposedChallenge = {
  couplingId: coupling,
  templateKey: 'gut_getrunken',
  proposerPersonId: philipp,
  status: 'vorgeschlagen',
  proposedAt: '2026-10-14T07:00:00.000Z',
  proposalExpiresAt: '2026-10-16T07:00:00.000Z',
  startedAt: null,
  endsAt: null,
  endedAt: null,
  commonStage: null,
  challengeDecoKey: null,
  createdAt: '2026-10-14T07:00:00.000Z',
  updatedAt: '2026-10-14T07:00:00.000Z',
} as const;

const activeChallenge = {
  ...proposedChallenge,
  status: 'aktiv',
  startedAt: now,
  endsAt: '2026-10-21T12:00:00.000Z',
  commonStage: 'gestartet',
  updatedAt: now,
} as const;

export const islandRecordFixtures = {
  ChallengeRecord: fixtures(ChallengeRecord, {
    valid: {
      'Philipps Vorschlag': proposedChallenge,
      'angenommen und aktiv': activeChallenge,
      'verfallen': { ...proposedChallenge, status: 'verfallen', endedAt: '2026-10-16T07:00:00.000Z' },
    },
    invalid: {
      'aktiv ohne Start': { ...activeChallenge, startedAt: null, endsAt: null },
      'Vorschlag mit Start': { ...proposedChallenge, startedAt: now, endsAt: '2026-10-21T12:00:00.000Z' },
      'abgelehnt ohne Ende': { ...proposedChallenge, status: 'abgelehnt' },
      'mit Partneranteil': { ...activeChallenge, partnerRequired: 6 },
    },
  }),
  ChallengeRequirementRecord: fixtures(ChallengeRequirementRecord, {
    valid: { 'Annas Anteil': { challengeId: challenge, couplingId: coupling, personId: anna, requiredCount: 6, createdAt: now, updatedAt: now } },
    invalid: {
      'ohne Bedarf': { challengeId: challenge, couplingId: coupling, personId: anna, requiredCount: 0, createdAt: now, updatedAt: now },
      'mit Stand des Partners': {
        challengeId: challenge, couplingId: coupling, personId: anna, requiredCount: 6, partnerCount: 3, createdAt: now, updatedAt: now,
      },
    },
  }),
  BlueprintUnlockRecord: fixtures(BlueprintUnlockRecord, {
    valid: { 'Start-Bauplan beim Schlüpfen': { ...owned, catalogKey: 'laterne', reason: 'start', unlockedAt: now, createdAt: now } },
    invalid: { 'unbekannter Grund': { ...owned, catalogKey: 'laterne', reason: 'gekauft', unlockedAt: now, createdAt: now } },
  }),
  AreaUnlockRecord: fixtures(AreaUnlockRecord, {
    valid: { 'erstes Gebiet auf Level 4': { ...owned, areaKey: 'mooswald', level: 4, unlockedAt: now, createdAt: now } },
    invalid: { 'Gebiet vor Level 4': { ...owned, areaKey: 'mooswald', level: 3, unlockedAt: now, createdAt: now } },
  }),
  IslandFieldRecord: fixtures(IslandFieldRecord, {
    valid: {
      'Ecke einer Person': { ...owned, fieldKey: 'grundinsel:0:0', ownerPersonId: philipp, createdAt: now },
      'Gebietsfeld über der Grundinsel': { ...owned, fieldKey: 'mooswald:3:-5', ownerPersonId: philipp, createdAt: now },
      'Lichtung ohne Besitzer': { ...owned, fieldKey: 'grundinsel:7:7', ownerPersonId: null, createdAt: now },
    },
    invalid: { 'Schlüssel ohne Koordinaten': { ...owned, fieldKey: 'grundinsel', ownerPersonId: null, createdAt: now } },
  }),
  IslandObjectOrigin: fixtures(IslandObjectOrigin, {
    valid: { 'gebaut': 'gebaut', 'Deko aus einer Challenge': 'challenge' },
    invalid: { 'gekauft': 'gekauft' },
  }),
  IslandObjectRecord: fixtures(IslandObjectRecord, {
    valid: {
      'gebaute Laterne auf einem Feld': builtLantern,
      'Deko im Lager': { ...builtLantern, catalogKey: 'muschelkranz', origin: 'besucher', fieldId: null },
    },
    invalid: {
      'Stufe 4': { ...builtLantern, level: 4 },
      'unbekannte Herkunft': { ...builtLantern, origin: 'gekauft' },
      'ohne Besitzer': { ...builtLantern, ownerPersonId: null },
    },
  }),
  CommunityProjectRecord: fixtures(CommunityProjectRecord, {
    valid: {
      'aktives Projekt 1': project,
      'fertiges Projekt': { ...project, status: 'fertig', completedAt: now },
    },
    invalid: {
      'fertig ohne Abschlusszeitpunkt': { ...project, status: 'fertig' },
      'aktiv mit Abschlusszeitpunkt': { ...project, completedAt: now },
    },
  }),
  IslandEventRecord: fixtures(IslandEventRecord, {
    valid: {
      'Momo geschlüpft': hatched,
      'Besuch für Philipp': {
        ...hatched,
        type: 'besuch',
        templateKey: 'igel_ilse',
        responsiblePersonId: philipp,
        occasionKey: 'tag:2026-10-14:1',
        status: 'offen',
        reward: { wish: { type: 'bauplan_bauen', blueprintKey: 'laterne' }, reward: { type: 'bauplan', key: 'brunnen' } },
      },
    },
    invalid: {
      'individueller Bau ist kein Ereignis': { ...hatched, type: 'objekt_gebaut' },
      'leerer Anlassschlüssel': { ...hatched, occasionKey: '' },
    },
  }),
  IslandEventStateRecord: fixtures(IslandEventStateRecord, {
    valid: {
      'neu': { islandEventId: islandEvent, personId: philipp, seenAt: null, claimedAt: null, createdAt: now, updatedAt: now },
      'gesehen': { islandEventId: islandEvent, personId: philipp, seenAt: now, claimedAt: null, createdAt: now, updatedAt: now },
      'abgeholt': { islandEventId: islandEvent, personId: philipp, seenAt: now, claimedAt: now, createdAt: now, updatedAt: now },
    },
    invalid: {
      'abgeholt, aber nie gesehen': { islandEventId: islandEvent, personId: philipp, seenAt: null, claimedAt: now, createdAt: now, updatedAt: now },
      'ohne Person': { islandEventId: islandEvent, seenAt: null, claimedAt: null, createdAt: now, updatedAt: now },
    },
  }),
  VisitorReward: fixtures(VisitorReward, {
    valid: { 'Besucher-Bauplan': { type: 'bauplan', key: 'brunnen' }, 'Deko': { type: 'deko', key: 'muschel' } },
    invalid: { 'Accessoire': { type: 'accessoire', key: 'strohhuetchen' }, 'Energie': { type: 'energie', amount: 3 } },
  }),
  VisitorEventDetails: fixtures(VisitorEventDetails, {
    valid: { 'Laterne bauen für einen Brunnen': { wish: { type: 'bauplan_bauen', blueprintKey: 'laterne' }, reward: { type: 'bauplan', key: 'brunnen' } } },
    invalid: {
      'ohne Wunsch': { reward: { type: 'deko', key: 'muschel' } },
      'Wunsch ohne Bauplan': { wish: { type: 'bauplan_bauen' }, reward: { type: 'deko', key: 'muschel' } },
    },
  }),
};
