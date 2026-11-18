import {
  BuildObject,
  ChallengeStatus,
  CommonStage,
  DecideSharedAction,
  IslandEventKind,
  IslandProgress,
  IslandRecord,
  IslandRole,
  IslandState,
  MomoAppearance,
  MomoForm,
  MomoMood,
  RequestedSharedActionType,
  RequestSharedAction,
  SharedAction,
  SharedActionDecision,
} from '../src/island.ts';
import { fixtures } from './define.ts';
import { anna, command, coupling, island, islandField, islandObject, now, philipp, project, sharedAction, timeZone, today } from './ids.ts';

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

const waitingIsland = {
  couplingId: coupling,
  state: 'wartet_auf_rollen',
  hatchedAt: null,
  timeZone: null,
  createdAt: now,
  updatedAt: now,
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
  IslandEventKind: fixtures(IslandEventKind, {
    valid: { 'Besuch': 'besuch', 'Momos Wunsch': 'momos_wunsch' },
    invalid: { 'Levelaufstieg ist kein Insel-Ereignis': 'levelaufstieg' },
  }),
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
  IslandState: fixtures(IslandState, {
    valid: { 'wartet auf Rollen': 'wartet_auf_rollen', 'archiviert': 'archiviert' },
    invalid: { 'geschlüpft ist kein Zustand': 'geschluepft' },
  }),
  IslandRecord: fixtures(IslandRecord, {
    valid: {
      'wartet auf Rollen': waitingIsland,
      'geschlüpft': { ...waitingIsland, state: 'aktiv', hatchedAt: now, timeZone },
      'archiviert nach dem Schlüpfen': { ...waitingIsland, state: 'archiviert', hatchedAt: now, timeZone },
      'archiviert vor dem Schlüpfen': { ...waitingIsland, state: 'archiviert' },
    },
    invalid: {
      'aktiv ohne Schlüpfen': { ...waitingIsland, state: 'aktiv' },
      'wartend, aber geschlüpft': { ...waitingIsland, hatchedAt: now, timeZone },
      'Schlüpfzeitpunkt ohne Zone': { ...waitingIsland, state: 'aktiv', hatchedAt: now },
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
  RequestedSharedActionType: fixtures(RequestedSharedActionType, {
    valid: { 'Rollentausch': 'rollentausch', 'Deko schenken': 'deko_schenken' },
    invalid: { 'Entkoppeln beantragt niemand': 'entkoppeln' },
  }),
  RequestSharedAction: fixtures(RequestSharedAction, {
    valid: {
      'Deko schenken': { actionId: sharedAction, type: 'deko_schenken', payload: { islandObjectId: islandObject, decoKey: 'muschelkranz' } },
      'Rollentausch ohne Nutzlast': { actionId: sharedAction, type: 'rollentausch', payload: {} },
    },
    invalid: {
      'Entkoppeln': { actionId: sharedAction, type: 'entkoppeln', payload: {} },
      'Nutzlast einer anderen Art': { actionId: sharedAction, type: 'rollentausch', payload: { proposerRole: 'bauen' } },
      'Rollenwahl ohne Rolle': { actionId: sharedAction, type: 'rollenwahl', payload: {} },
      'Antragsteller aus dem Client': { actionId: sharedAction, type: 'rollentausch', payload: {}, requesterPersonId: anna },
      'ohne ID': { type: 'rollentausch', payload: {} },
    },
  }),
  SharedActionDecision: fixtures(SharedActionDecision, {
    valid: { 'annehmen': 'annehmen', 'zurückziehen': 'zurueckziehen' },
    invalid: { 'Status statt Entscheidung': 'angenommen' },
  }),
  DecideSharedAction: fixtures(DecideSharedAction, {
    valid: { 'Partner nimmt an': { actionId: sharedAction, decision: 'annehmen', timeZone } },
    invalid: {
      'ohne Entscheidung': { actionId: sharedAction, timeZone },
      'ohne Zone des Geräts': { actionId: sharedAction, decision: 'annehmen' },
      'Entscheider aus dem Client': { actionId: sharedAction, decision: 'ablehnen', timeZone, deciderPersonId: philipp },
    },
  }),
  BuildObject: fixtures(BuildObject, {
    valid: {
      'Laterne auf ein eigenes Feld': { commandId: command, islandObjectId: islandObject, fieldId: islandField, blueprintKey: 'laterne', localDate: today },
    },
    invalid: {
      'Preis aus dem Client': { commandId: command, islandObjectId: islandObject, fieldId: islandField, blueprintKey: 'laterne', localDate: today, price: 0 },
      'Besitzer aus dem Client': {
        commandId: command, islandObjectId: islandObject, fieldId: islandField, blueprintKey: 'laterne', localDate: today, ownerPersonId: anna,
      },
      'Bauplanschlüssel mit Großbuchstaben': { commandId: command, islandObjectId: islandObject, fieldId: islandField, blueprintKey: 'Laterne', localDate: today },
      'ohne Feld': { commandId: command, islandObjectId: islandObject, blueprintKey: 'laterne', localDate: today },
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
