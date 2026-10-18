import {
  ChallengeStatus,
  CommonStage,
  IslandProgress,
  IslandRole,
  MomoAppearance,
  MomoForm,
  MomoMood,
  SharedAction,
} from '../src/island.ts';
import { fixtures } from './define.ts';
import { anna, coupling, island, islandObject, now, philipp, project, sharedAction } from './ids.ts';

const progress = {
  islandId: island,
  couplingId: coupling,
  level: 6,
  levelNeed: 16,
  members: [
    { personId: philipp, halfPercent: 100, halfFull: true },
    { personId: anna, halfPercent: 43, halfFull: false },
  ],
  activeProject: { projectId: project, templateKey: 'leuchtturm', sequenceNumber: 2, stage: 'gut_unterwegs' },
  dataAsOf: now,
  serverVersion: '1834',
} as const;

const giftBase = {
  id: sharedAction,
  couplingId: coupling,
  requesterPersonId: anna,
  type: 'deko_schenken',
  payload: { islandObjectId: islandObject, decoKey: 'muschelkranz' },
  status: 'offen',
  createdAt: now,
  decidedAt: null,
} as const;

const hatched = {
  stage: 'geschluepft',
  formKey: 'huepfer',
  moodKey: 'freut_sich',
  accessories: { kopf: 'strohhuetchen', hals: null },
} as const;

export const islandFixtures = {
  IslandRole: fixtures(IslandRole, { valid: { 'Bauen': 'bauen', 'Natur': 'natur' }, invalid: { 'Deko': 'deko' } }),
  CommonStage: fixtures(CommonStage, {
    valid: { 'gestartet': 'gestartet', 'fast geschafft': 'fast_geschafft' },
    invalid: { 'Prozentwert': 80 },
  }),
  ChallengeStatus: fixtures(ChallengeStatus, {
    valid: { 'vorgeschlagen': 'vorgeschlagen', 'verfallen': 'verfallen' },
    invalid: { 'verloren': 'verloren' },
  }),
  IslandProgress: fixtures(IslandProgress, {
    valid: { 'Level 6, eigene Hälfte voll': progress },
    invalid: {
      'Energiemenge des Partners': {
        ...progress,
        members: [progress.members[0], { ...progress.members[1], spentEnergy: 7 }],
      },
      'volle Hälfte unter 100 %': {
        ...progress,
        members: [{ personId: philipp, halfPercent: 99, halfFull: true }, progress.members[1]],
      },
      'dieselbe Person zweimal': { ...progress, members: [progress.members[0], progress.members[0]] },
      'exakter Projektanteil des Partners': {
        ...progress,
        activeProject: { ...progress.activeProject, partnerContribution: 12 },
      },
      'Level 0': { ...progress, level: 0 },
    },
  }),
  SharedAction: fixtures(SharedAction, {
    valid: {
      'offenes Deko-Geschenk': giftBase,
      'angenommene Rollenwahl': {
        ...giftBase,
        type: 'rollenwahl',
        requesterPersonId: philipp,
        payload: { proposerRole: 'bauen' },
        status: 'angenommen',
        decidedAt: now,
      },
      'Entkoppeln': { ...giftBase, type: 'entkoppeln', payload: {}, status: 'angenommen', decidedAt: now },
    },
    invalid: {
      'offen mit Entscheidungszeitpunkt': { ...giftBase, decidedAt: now },
      'entschieden ohne Zeitpunkt': { ...giftBase, status: 'abgelehnt' },
      'Rollenwahl ohne Rolle': { ...giftBase, type: 'rollenwahl', payload: {} },
      'unbekannter Status': { ...giftBase, status: 'abgelaufen' },
    },
  }),
  MomoForm: fixtures(MomoForm, {
    valid: { 'Form 1': 'kaulquappe', 'Form 8': 'lagunendrache' },
    invalid: { 'Laichkugel ist keine Form': 'laichkugel' },
  }),
  MomoMood: fixtures(MomoMood, {
    valid: { 'zufrieden': 'zufrieden', 'döst': 'doest' },
    invalid: { 'traurig': 'traurig' },
  }),
  MomoAppearance: fixtures(MomoAppearance, {
    valid: {
      'geschlüpft mit Hut': hatched,
      'Laichkugel': { stage: 'laichkugel', formKey: null, moodKey: null, accessories: { kopf: null, hals: null } },
    },
    invalid: {
      'Laichkugel mit Form': { ...hatched, stage: 'laichkugel' },
      'geschlüpft ohne Form': { ...hatched, formKey: null },
      'unbekannte Stelle': { ...hatched, accessories: { kopf: null, hals: null, ruecken: 'flosse' } },
      'traurig': { ...hatched, moodKey: 'traurig' },
    },
  }),
};
