import {
  BuildObject,
  ChallengeProposalDecision,
  ChallengeStatus,
  ClaimEventReward,
  CommonStage,
  ContributeToProject,
  DecideChallengeProposal,
  DecideSharedAction,
  IslandEventKind,
  IslandProgress,
  IslandRecord,
  IslandRole,
  IslandState,
  MarkEventsSeen,
  MomoAppearance,
  MomoForm,
  MomoMood,
  PlacementTarget,
  PlaceObject,
  ProposeChallenge,
  RequestedSharedActionType,
  RequestSharedAction,
  SharedAction,
  SharedActionDecision,
  UpgradeObject,
  WithdrawChallengeProposal,
} from '../src/island.ts';
import { fixtures } from './define.ts';
import { anna, challenge, command, contribution, coupling, island, islandEventState, islandField, islandObject, now, philipp, project, sharedAction, timeZone, today } from './ids.ts';

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
  ProposeChallenge: fixtures(ProposeChallenge, {
    valid: { 'Gut getrunken': { challengeId: challenge, templateKey: 'gut_getrunken' } },
    invalid: {
      'ohne Vorlage': { challengeId: challenge },
      'Anteil aus dem Client': { challengeId: challenge, templateKey: 'gut_getrunken', requiredCount: 1 },
      'Partner aus dem Client': { challengeId: challenge, templateKey: 'gut_getrunken', partnerPersonId: anna },
    },
  }),
  ChallengeProposalDecision: fixtures(ChallengeProposalDecision, {
    valid: { 'annehmen': 'annehmen', 'ablehnen': 'ablehnen' },
    invalid: { 'Zurückziehen ist ein eigener Befehl': 'zurueckziehen' },
  }),
  DecideChallengeProposal: fixtures(DecideChallengeProposal, {
    valid: { 'Anna nimmt an': { challengeId: challenge, decision: 'annehmen' }, 'Anna lehnt ab': { challengeId: challenge, decision: 'ablehnen' } },
    invalid: {
      'Zurückziehen': { challengeId: challenge, decision: 'zurueckziehen' },
      'Startzeit aus dem Client': { challengeId: challenge, decision: 'annehmen', startedAt: now },
    },
  }),
  WithdrawChallengeProposal: fixtures(WithdrawChallengeProposal, {
    valid: { 'Philipp zieht zurück': { challengeId: challenge } },
    invalid: { 'ohne Challenge': {} },
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
  UpgradeObject: fixtures(UpgradeObject, {
    valid: {
      'Laterne auf Stufe 2': { commandId: command, islandObjectId: islandObject, toLevel: 2, localDate: today },
      'auf Stufe 3': { commandId: command, islandObjectId: islandObject, toLevel: 3, localDate: today },
    },
    invalid: {
      'Preis aus dem Client': { commandId: command, islandObjectId: islandObject, toLevel: 2, localDate: today, price: 6 },
      'über Stufe 3 hinaus': { commandId: command, islandObjectId: islandObject, toLevel: 4, localDate: today },
      'auf Stufe 1': { commandId: command, islandObjectId: islandObject, toLevel: 1, localDate: today },
      'ohne Zielstufe': { commandId: command, islandObjectId: islandObject, localDate: today },
    },
  }),
  ContributeToProject: fixtures(ContributeToProject, {
    valid: {
      '5 Energie in den eigenen Anteil': { commandId: command, contributionId: contribution, projectId: project, amount: 5, localDate: today },
    },
    invalid: {
      'Rolle aus dem Client': { commandId: command, contributionId: contribution, projectId: project, amount: 5, localDate: today, role: 'natur' },
      'Person aus dem Client': { commandId: command, contributionId: contribution, projectId: project, amount: 5, localDate: today, personId: anna },
      'Betrag 0': { commandId: command, contributionId: contribution, projectId: project, amount: 0, localDate: today },
      'Bruchteil': { commandId: command, contributionId: contribution, projectId: project, amount: 1.5, localDate: today },
      'ohne Projekt': { commandId: command, contributionId: contribution, amount: 5, localDate: today },
    },
  }),
  MarkEventsSeen: fixtures(MarkEventsSeen, {
    valid: { 'ein eigenes Ereignis angesehen': { islandEventStateId: islandEventState } },
    invalid: {
      'Person aus dem Client': { islandEventStateId: islandEventState, personId: philipp },
      'Zeitpunkt aus dem Client': { islandEventStateId: islandEventState, seenAt: now },
      'ohne Ereignisstand': {},
    },
  }),
  ClaimEventReward: fixtures(ClaimEventReward, {
    valid: { 'Belohnung abholen': { islandEventStateId: islandEventState } },
    invalid: {
      'Belohnung aus dem Client': { islandEventStateId: islandEventState, reward: { type: 'bauplan', key: 'brunnen' } },
      'ohne Ereignisstand': {},
    },
  }),
  PlacementTarget: fixtures(PlacementTarget, {
    valid: { 'eigenes Feld': { type: 'feld', fieldId: islandField }, 'Lager': { type: 'lager' } },
    invalid: { 'Feld ohne ID': { type: 'feld' }, 'Lager mit Feld': { type: 'lager', fieldId: islandField } },
  }),
  PlaceObject: fixtures(PlaceObject, {
    valid: {
      'Laterne umstellen': { commandId: command, islandObjectId: islandObject, fromFieldId: islandField, target: { type: 'feld', fieldId: islandField } },
      'Laterne aus dem Lager platzieren': { commandId: command, islandObjectId: islandObject, fromFieldId: null, target: { type: 'feld', fieldId: islandField } },
      'Laterne einlagern': { commandId: command, islandObjectId: islandObject, fromFieldId: islandField, target: { type: 'lager' } },
    },
    invalid: {
      'Besitzer aus dem Client': { commandId: command, islandObjectId: islandObject, fromFieldId: null, target: { type: 'lager' }, ownerPersonId: anna },
      'Feld statt Ziel': { commandId: command, islandObjectId: islandObject, fromFieldId: null, fieldId: islandField },
      'ohne Objekt': { commandId: command, fromFieldId: null, target: { type: 'lager' } },
      'ohne früheres Feld': { commandId: command, islandObjectId: islandObject, target: { type: 'lager' } },
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
