import type { IslandRole, MomoForm } from '@abnehm/contracts/island';
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
  accept: 'Annehmen',
  // „Angenommen“ und sein Hinweis: vorgemerkte Annahme bis zum Sync (Spezifikation 4, Abschnitt 11:
  // gemeinsame Aktionen sind offline nur vorgemerkt). Designwerte aus #184, nicht belegt.
  accepted: 'Angenommen',
  acceptedHint: 'Momo schlüpft, sobald deine Antwort gesichert ist.',
};

/**
 * Texte von Momo-Sheet und „So wächst Momo“ (#184). Die drei Sätze und die Formnamen stehen in
 * Spezifikation 4, Abschnitte 5 und 7; „Verstanden“ und die Zeile mit Form und Level sind Designwerte
 * dieses Tickets (nicht belegt).
 */
export const momoSheetTexts = {
  title: 'Momo',
  form: {
    kaulquappe: 'Kaulquappe',
    huepfer: 'Hüpfer',
    krabbler: 'Krabbler',
    aufrechter: 'Aufrechter',
    springer: 'Springer',
    spirale: 'Spirale',
    fluegling: 'Flügling',
    lagunendrache: 'Lagunendrache',
  } satisfies Record<MomoForm, string>,
  formAndLevel: (form: MomoForm, level: number) => `${momoSheetTexts.form[form]} · Level ${level}`,
  growth: 'So wächst Momo',
  growthSentences: [
    'Tagesziele bringen Energie.',
    'Bauen gibt Energie aus und füllt deine Hälfte.',
    'Sind beide Hälften voll, steigt Momo ein Level.',
  ],
  understood: 'Verstanden',
};

/**
 * Texte von Bau-Sheet und Bau-Modus (#192). „Noch ‹n› Energie“ steht in Spezifikation 4, Abschnitt 7; die
 * übrigen Sätze sind Designwerte dieses Tickets (nicht belegt).
 */
export const buildTexts = {
  title: 'Bauen',
  titleOnField: 'Auf dieses Feld bauen',
  energy: (energy: number) => `Du hast ${energy} Energie`,
  price: (price: number) => `${price} Energie`,
  missing: (missing: number) => `Noch ${missing} Energie`,
  /** Zugänglicher Name einer Bauplan-Zeile. */
  option: (name: string, price: number, missing: number) =>
    missing > 0 ? `${name}, ${buildTexts.price(price)}, ${buildTexts.missing(missing)}` : `${name}, ${buildTexts.price(price)}`,
  noFreeField: 'Gerade ist keines deiner Felder frei.',
  placing: (name: string) => `${name} bauen`,
  placingHint: 'Tippe auf ein leuchtendes Feld.',
  cancel: 'Abbrechen',
};
