import type { IslandRole } from '@abnehm/contracts/island';
import type { Season } from '@abnehm/game-rules/catalog';

import type { IslandEntry } from './IslandBar';
import type { Daytime } from './scene-model';

/** Texte der Inselansicht (nur Deutsch). */
export const islandTexts = {
  season: { fruehling: 'Frühling', sommer: 'Sommer', herbst: 'Herbst', winter: 'Winter' } satisfies Record<Season, string>,
  daytime: { tag: 'Tag', abend: 'Abend' } satisfies Record<Daytime, string>,
  energy: (energy: number) => `${energy} Energie`,
  energyUnit: 'Energie',
  areas: 'Bereiche',
  entries: { lager: 'Lager', projekt: 'Projekt', bauen: 'Bauen', ereignisse: 'Ereignisse' } satisfies Record<IslandEntry, string>,
  island: (level: number, ownObjects: number) => `Momos Insel, Level ${level}, ${ownObjects} eigene Objekte`,
  momo: 'Momo',
  loading: 'Momo lädt …',
};

/**
 * Texte von Laichkugel und Rollenwahl (#180). „Momo schlüpft, sobald ihr die Rollen verteilt habt“ und
 * „Vorschlag gesendet“ stehen in Spezifikation 4, Abschnitt 7; die Beschreibung der Rollen folgt dem
 * Glossar (`CONTEXT.md`, „Rolle“). Die übrigen Sätze sind Designwerte dieses Tickets (nicht belegt).
 */
export const laichkugelTexts = {
  waiting: 'Momo wartet im Ei',
  solo: 'Momo schlüpft, wenn du dich mit deinem Partner koppelst. Energie aus deinen Tageszielen sammelst du schon jetzt.',
  energy: (energy: number) => `${energy} Energie gesammelt`,
  invite: 'Partner einladen',
  redeem: 'Code eingeben',
  hatchesAfterRoles: 'Momo schlüpft, sobald ihr die Rollen verteilt habt',
  role: { bauen: 'Bauen', natur: 'Natur' } satisfies Record<IslandRole, string>,
  roleMeaning: { bauen: 'Häuser, Wege und Brücken', natur: 'Pflanzen, Bäume und Tiere' } satisfies Record<IslandRole, string>,
  chooseRole: 'Welche Rolle übernimmst du?',
  chooseHint: 'Wähle deine Rolle, dein Partner bekommt die andere.',
  split: (own: IslandRole, partner: string, partnerRole: IslandRole) => `Du: ${laichkugelTexts.role[own]} · ${partner}: ${laichkugelTexts.role[partnerRole]}`,
  meaning: (role: IslandRole) => `${laichkugelTexts.role[role]}: ${laichkugelTexts.roleMeaning[role]}`,
  send: (partner: string) => `Vorschlag an ${partner} senden`,
  answerHint: (partner: string) => `${partner} kann annehmen oder ablehnen.`,
  sent: 'Vorschlag gesendet',
  withdraw: 'Vorschlag zurückziehen',
  proposedBy: (partner: string) => `${partner} schlägt eure Rollen vor`,
  decline: 'Ablehnen',
};
