import type { CommonStage, IslandRole, MomoForm } from '@abnehm/contracts/island';
import type { ChallengeMeasure, Season } from '@abnehm/game-rules/catalog';
import type { ChallengeShare } from '@abnehm/game-rules/challenges';
import type { ProjectKind } from '@abnehm/game-rules/projects';

import { formNames } from '../momo';
import { bausteinNames } from '../shell/texts';
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
  form: formNames,
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

/**
 * Texte von Objekt-Sheet, Lager und Umstellen (#194). „Aufwerten“, „Umstellen“, „Einlagern“, „Platzieren“,
 * „Lager“ und „von ‹Name› gebaut“ stehen in Spezifikation 4, Abschnitt 7, „Noch ‹n› Energie“ ebendort
 * fürs Bauen; die übrigen Sätze sind Designwerte dieses Tickets (nicht belegt).
 */
export const objectTexts = {
  level: (level: number) => `Stufe ${level}`,
  builtBy: (partner: string, level: number) => `von ${partner} gebaut · Stufe ${level}`,
  dekoFrom: (partner: string) => `Deko von ${partner}`,
  upgrade: (toLevel: number, price: number) => `Auf Stufe ${toLevel} aufwerten · ${price} Energie`,
  upgradeTooExpensive: (toLevel: number, price: number, missing: number) => `Stufe ${toLevel} kostet ${price} Energie. ${buildTexts.missing(missing)}`,
  highestLevel: 'Höchste Stufe erreicht',
  move: 'Umstellen',
  noFreeField: 'Gerade ist kein passendes Feld frei.',
  store: 'Einlagern',
  moving: (name: string) => `${name} umstellen`,
  storageTitle: 'Lager',
  storageEmpty: 'Dein Lager ist leer. Was du einlagerst oder geschenkt bekommst, wartet hier.',
  place: 'Platzieren',
  /** Titel des Platzier-Modus und zugänglicher Name von „Platzieren“ in einer Lager-Zeile. */
  placing: (name: string) => `${name} platzieren`,
  noFieldForItem: 'Kein passendes Feld frei',
  kind: {
    gebaut: (level: number) => `Gebaut · Stufe ${level}`,
    geschenk: (from: string) => `Geschenk von ${from}`,
    challenge: 'Challenge-Deko',
    deko: 'Deko',
  },
};

/**
 * Texte des Projekt-Sheets (#208). „Dein Anteil: 12 von 30“, „Dein Anteil ist voll“ und „Einzahlen“ stehen in
 * Spezifikation 4, Abschnitt 8, die Stufen ebendort; die übrigen Sätze sind Designwerte dieses Tickets (nicht
 * belegt). Kein Satz nennt, was dem Partner fehlt.
 */
export const projectTexts = {
  kind: { projekt: 'Gemeinschaftsprojekt', ausbau: 'Ausbau eures Wahrzeichens' } satisfies Record<ProjectKind, string>,
  ownShare: (paid: number, need: number) => `Dein Anteil: ${paid} von ${need}`,
  ownShareLabel: 'Dein Anteil',
  ownFull: 'Dein Anteil ist voll',
  stage: (stage: CommonStage) => `Gemeinsam: ${projectTexts.stageNames[stage]}`,
  stageNames: { gestartet: 'gestartet', gut_unterwegs: 'gut unterwegs', fast_geschafft: 'fast geschafft', geschafft: 'geschafft' } satisfies Record<CommonStage, string>,
  /** Beim Ausbau steht das Wahrzeichen schon; es wächst (Gerätelauf #208). */
  howItWorks: {
    projekt: 'Jeder füllt seinen Anteil mit eigener Energie, ohne Frist. Sind beide Anteile voll, steht euer Wahrzeichen.',
    ausbau: 'Jeder füllt seinen Anteil mit eigener Energie, ohne Frist. Sind beide Anteile voll, wird euer Wahrzeichen größer.',
  } satisfies Record<ProjectKind, string>,
  amount: 'Betrag',
  amountValue: (amount: number) => `${amount} Energie`,
  contribute: 'Einzahlen',
  contributeLabel: (amount: number) => `${amount} Energie einzahlen`,
  /** Bestätigung im Sheet: Eine Meldung läge auf dem Gerät hinter dem nativen Sheet (Gerätelauf #202). */
  contributed: (amount: number) => `${amount} Energie eingezahlt`,
  noEnergy: 'Gerade hast du keine Energie. Erfüllte Tagesziele bringen neue.',
};

/**
 * Texte des Sheets „Ereignisse“ (#202, #204). „Neu auf der Insel“, „Offene Wünsche“ und „Kein Zeitdruck“ stehen in
 * Spezifikation 4, Abschnitt 9; „‹Besucher› ist zu Besuch“ folgt dem Prototyp aus #28
 * (prototypes/momos-insel/app.js). Die übrigen Sätze sind Designwerte der Tickets (nicht belegt).
 */
export const eventTexts = {
  title: 'Ereignisse',
  fresh: 'Neu auf der Insel',
  wishes: 'Offene Wünsche',
  noPressure: 'Kein Zeitdruck. Wünsche warten, bis du so weit bist.',
  empty: 'Gerade wartet niemand auf dich. Besucher kommen ab und zu vorbei.',
  visiting: (visitor: string) => `${visitor} ist zu Besuch`,
  wish: (blueprint: string) => `Wünscht sich: ${blueprint}`,
  reward: (reward: Readonly<{ type: 'bauplan' | 'deko'; name: string }>) =>
    reward.type === 'bauplan' ? `Bringt den Bauplan ${reward.name} mit` : `Bringt ${reward.name} für dein Lager mit`,
  howTo: (blueprint: string) => `Wenn du den Bauplan ${blueprint} baust, kannst du die Belohnung abholen.`,
  claim: 'Belohnung abholen',
  /** Bestätigung im Sheet nach dem Abholen. */
  claimed: (reward: Readonly<{ type: 'bauplan' | 'deko'; name: string }>) =>
    reward.type === 'bauplan' ? `Neuer Bauplan: ${reward.name}` : `${reward.name} liegt jetzt in deinem Lager`,
  /** Zugänglicher Name von „Belohnung abholen“ in einer Karte. */
  claimFor: (visitor: string) => `Belohnung von ${visitor} abholen`,
  /** Entdeckung (#204): Abschnitt, Ankunft, Karte und zugänglicher Name des Abholens. */
  areas: 'Neue Gebiete',
  newArea: (area: string) => `Neues Gebiet: ${area}`,
  discovered: (area: string) => `${area} entdeckt`,
  areaBlueprints: (names: readonly string[]) => `Neue Baupläne für eure Insel: ${listOf(names)}`,
  areaDeko: (names: readonly string[]) => `Für dein Lager: ${listOf(names)}`,
  claimDeko: (names: readonly string[]) => `${listOf(names)} abholen`,
};

/** „A“, „A und B“, „A, B und C“. */
function listOf(names: readonly string[]): string {
  return names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} und ${names.at(-1)}`;
}

/**
 * Texte der Challenge-Bildschirme `challenge.propose` und `challenge.detail` (#210). „Passt gerade nicht zu
 * euren Wochenplänen“ und „Vorschlag gesendet“ stehen in Spezifikation 4, Abschnitt 10; die übrigen Sätze
 * sind Designwerte dieses Tickets (nicht belegt). Namen und Erklärungen der Vorlagen kommen aus dem
 * Spielkatalog.
 */
export const challengeTexts = {
  intro: (partner: string) => `Sieben Tage, gemeinsam mit ${partner}. Jede Person erfüllt ihren eigenen Anteil.`,
  share: (share: ChallengeShare, measure: ChallengeMeasure): string => {
    if (share.type === 'passt_nicht') return challengeTexts.unfit;
    // „17 von 21“ wie in #19; wie viele Tagesziele erfüllbar sind, sagen die Spielregeln.
    if (measure.type === 'tagesziele') return `Dein Anteil: ${share.required} von ${share.possible} Tageszielen`;
    if (measure.baustein === 'sporteinheit') return `Dein Anteil: ${share.required} von ${share.planned} geplanten Sporteinheiten`;
    return `Dein Anteil: ${share.required} von ${share.planned} Tagen mit „${bausteinNames[measure.baustein]}“`;
  },
  unfit: 'Passt gerade nicht zu euren Wochenplänen',
  /** Hinweis oben auf `challenge.propose`, nachdem der Server einen Vorschlag abgelehnt hat. */
  unfitRejected: (template: string) => `„${template}“ passt gerade nicht zu euren Wochenplänen.`,
  propose: 'Vorschlagen',
  /** Zugänglicher Name von „Vorschlagen“ in einer Vorlagenkarte. */
  proposeTemplate: (template: string) => `${template} vorschlagen`,
  solo: 'Challenges startet ihr zu zweit. Sobald ihr gekoppelt seid, kannst du eine vorschlagen.',
  alreadyProposed: 'Gerade ist schon ein Vorschlag offen.',
  alreadyActive: 'Gerade läuft schon eine Challenge.',
  show: 'Ansehen',
  /** Einstieg im Momo-Sheet. */
  sheetPropose: 'Challenge vorschlagen',
  sheetOpen: 'Zur Challenge',
  proposedBy: (partner: string) => `${partner} schlägt vor`,
  sent: 'Vorschlag gesendet',
  waitingFor: (partner: string) => `${partner} entscheidet.`,
  pending: 'Wird gesendet, sobald du online bist.',
  validUntil: (weekday: string, time: string) => `Gilt bis ${weekday}, ${time} Uhr`,
  accept: 'Annehmen',
  decline: 'Ablehnen',
  withdraw: 'Zurückziehen',
  accepted: 'Angenommen. Die Challenge startet, sobald du online bist.',
  running: 'Die Challenge läuft.',
  gone: 'Dieser Vorschlag ist nicht mehr offen.',
};
