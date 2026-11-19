import type { AreaKey, LocalDate, Weekday } from '@abnehm/contracts/base';
import type { InviteCode } from '@abnehm/contracts/coupling';
import type { CommonStage, IslandRole } from '@abnehm/contracts/island';
import type { PartnerDailyGoalStage, PartnerSummaryEnvelope } from '@abnehm/contracts/partner';
import type { SharedEventType, WirContribution } from '@abnehm/contracts/wir';

import { longDateText, titleOf, weekdayNames } from '../shell/texts';
import type { DataAge } from './partner-view';

// Texte des Partnerbereichs nach Spezifikation 5, Abschnitt 2 (#121). Angezeigt wird die kurze Form,
// vorgelesen ein vollständiger deutscher Satzteil ohne Abkürzungen.

/** Ein Text in angezeigter und vorgelesener Form. */
export type Spoken = Readonly<{ shown: string; spoken: string }>;

/** Titel und Aktionen heißen wie ihre Routen (`shell/texts.ts`). */
export const partnerTexts = {
  title: titleOf({ type: 'partner' }),
  /** Bezug des groben Tageszielstands, sichtbar wie im zugänglichen Namen (`partnerHeadline`). */
  stageLabel: 'Tagesziele',
  soloTitle: 'Momo wartet im Ei',
  soloBody: 'Deine Tracker kannst du auch allein vollständig nutzen. Wenn ihr zu zweit seid, kümmert ihr euch gemeinsam um Momo.',
  /** Kurzform des Solo-Zustands auf der Partner-Karte von „Heute“. */
  soloToday: 'Momo wartet im Ei. Lade deinen Partner ein, wenn ihr gemeinsam starten möchtet.',
  invite: titleOf({ type: 'partner.invite' }),
  redeem: titleOf({ type: 'partner.redeem' }),
  encourage: titleOf({ type: 'partner.encourage' }),
  encourageBody: (name: string) => `Schick ${name} eine kurze Ermutigung.`,
  /** Titel des Sheets `partner.encourage` (Spezifikation 5, Abschnitt 4). */
  encourageTitle: (name: string) => `${name} anfeuern`,
  /** Unter den Botschaften, solange heute noch Anfeuerungen mit Push ankommen. */
  remainingPushes: (count: number) => `Noch ${count} ${count === 1 ? 'Anfeuerung' : 'Anfeuerungen'} mit Push heute`,
  /** Nach drei Anfeuerungen mit Push am lokalen Tag. */
  withoutPush: (name: string) => `Weitere Anfeuerungen sieht ${name} in der App, ohne Push.`,
  /** Sheet ohne aktive Kopplung, etwa über einen veralteten Link (Designwert, nicht belegt). */
  encourageSolo: 'Anfeuern geht, sobald ihr gekoppelt seid.',
  loading: 'Partner lädt …',
  /** Veraltet, aber noch ohne Datenstand, etwa zwischen zwei Pull-Seiten direkt nach dem Koppeln. */
  offline: 'Offline',
} as const;

/**
 * Texte der Kopplungsabläufe `partner.invite` und `partner.redeem` (Spezifikation 5, Abschnitt 5; #120).
 * Wörtlich aus der Spezifikation: „gültig bis …“, „Code teilen“, „Ihr seid gekoppelt“, „Mit … koppeln?“,
 * der Reaktivierungstext, „Koppeln“, die drei Fehlertexte und „Braucht Internet“ mit „Erneut versuchen“.
 * Die übrigen Sätze sind Designwerte (nicht belegt).
 */
export const couplingTexts = {
  creating: 'Code wird erzeugt …',
  /** Angenommen, die Kopplung ist aber noch nicht per Pull auf dem Gerät. */
  loadingCoupling: 'Kopplung wird geladen …',
  /** Ohne Pronomen: Im Paar lädt mal die eine, mal die andere Person ein (Impeccable-Kritik zu #120). */
  inviteIntro: 'Gib deinem Partner diesen Code. Er wird in der App unter „Code eingeben“ eingetragen.',
  /** Zugänglicher Name des Codes: Ziffer für Ziffer statt „vierhundertzweiundachtzig …“. */
  codeSpoken: (code: InviteCode) => `Einladungscode ${code.split('').join(' ')}`,
  validUntil: (when: string) => `gültig bis ${when}`,
  /** Ablaufzeit in „gültig bis …“ (`validUntilWhen`). */
  today: (time: string) => `heute, ${time}`,
  tomorrow: (time: string) => `morgen, ${time}`,
  onDate: (date: string, time: string) => `${date}, ${time}`,
  share: 'Code teilen',
  /** Einladungstext im System-Teilen-Menü; der Code steht ohne Leerzeichen, damit er sich so einfügen lässt. */
  shareMessage: (code: InviteCode) => `Lass uns gemeinsam mit Momo starten! Gib in der App unter „Code eingeben“ diesen Code ein: ${code}`,
  waiting: 'Sobald dein Partner den Code eingibt, seid ihr gekoppelt. Lass diese Ansicht so lange offen oder schau später auf „Wir“.',
  coupledTitle: 'Ihr seid gekoppelt',
  coupledBody: (name: string) => `Du und ${name} kümmert euch ab jetzt gemeinsam um Momo.`,
  /** Weg zum Schlüpfen: `momo` mit `view: "rollenwahl"`. */
  toHatching: 'Zum Schlüpfen',
  /**
   * Nach einer Reaktivierung ist Momo längst geschlüpft; Insel, Rollen und Freigaben sind zurück (Spezifikation 5,
   * Abschnitt 5). Statt „Zum Schlüpfen“ führt der Weg dann zur Insel (Impeccable-Kritik zu #120).
   */
  reactivatedTitle: 'Ihr seid wieder gekoppelt',
  reactivatedBody: (name: string) => `Du und ${name}: Eure Insel und Momo sind wieder da.`,
  toIsland: 'Zu eurer Insel',
  /** Aus dem Onboarding: zurück zu Schritt 11 statt zum Schlüpfen. */
  continue: 'Weiter',
  codeLabel: 'Einladungscode',
  codeHint: 'Sechs Ziffern',
  codeInvalid: 'Der Code hat genau sechs Ziffern.',
  next: 'Weiter',
  confirmTitle: (name: string) => `Mit ${name} koppeln?`,
  reactivates: 'Ihr wart schon gekoppelt. Eure Insel und Momo kommen mit euren bisherigen Rollen und Freigaben zurück.',
  couple: 'Koppeln',
  otherCode: 'Anderen Code eingeben',
  /** Derselbe Text für ungültige, abgelaufene, verbrauchte und eigene Codes: Er verrät nicht, ob es den Code gibt. */
  codeMismatch: 'Dieser Code passt nicht. Prüfe ihn oder bitte um einen neuen.',
  alreadyCoupled: 'Du bist bereits gekoppelt.',
  rateLimited: 'Zu viele Versuche. Bitte später erneut.',
  /** Unerwarteter Ausgang, etwa eine unlesbare Antwort. */
  failed: 'Das hat gerade nicht geklappt. Versuch es erneut.',
  offline: 'Braucht Internet',
  retry: 'Erneut versuchen',
} as const;

/** Der Code in zwei Dreiergruppen, etwa „482 915“. */
export function groupedCode(code: InviteCode): string {
  return `${code.slice(0, 3)} ${code.slice(3)}`;
}

/** Grober Tageszielstand, ohne „X von 3“. */
export const stageTexts: Readonly<Record<PartnerDailyGoalStage, string>> = {
  noch_nichts: 'noch am Anfang',
  unterwegs: 'unterwegs',
  fast_geschafft: 'fast geschafft',
  geschafft: 'alle Tagesziele geschafft',
};

export const areaNames: Readonly<Record<AreaKey, string>> = {
  ernaehrung: 'Ernährung',
  wasser: 'Wasser',
  sport: 'Sport',
  gewicht: 'Gewicht',
};

const decimal = (value: number) => Math.abs(value).toFixed(1).replace('.', ',');

/** Wert einer Partner-Zusammenfassung. */
export function summaryText(summary: PartnerSummaryEnvelope): Spoken {
  switch (summary.type) {
    case 'ernaehrung': {
      const count = summary.content.recordedMealCategories;
      const text = count === 0 ? 'noch keine Mahlzeit erfasst' : `${count} ${count === 1 ? 'Mahlzeit' : 'Mahlzeiten'} erfasst`;
      return { shown: text, spoken: text };
    }
    case 'wasser': {
      const percent = summary.content.progressPercent;
      return { shown: `${percent} % des Wasserziels`, spoken: `${percent} Prozent des Wasserziels` };
    }
    case 'sport': {
      const { countedMinutes, weeklyTargetMinutes } = summary.content;
      return {
        shown: `${countedMinutes} von ${weeklyTargetMinutes} min diese Woche`,
        spoken: `${countedMinutes} von ${weeklyTargetMinutes} Minuten diese Woche`,
      };
    }
    case 'gewicht': {
      const { changeKg, direction } = summary.content;
      switch (direction) {
        case 'noch_nicht_verfuegbar':
          return { shown: 'Trend ab drei Tagesgewichten', spoken: 'Trend ab drei Tagesgewichten' };
        case 'stabil':
          return { shown: 'Trend stabil', spoken: 'Trend stabil' };
        case 'sinkend':
          return { shown: `Trend −${decimal(changeKg!)} kg in 2 Wochen`, spoken: `Trend minus ${decimal(changeKg!)} Kilogramm in 2 Wochen` };
        case 'steigend':
          return { shown: `Trend +${decimal(changeKg!)} kg in 2 Wochen`, spoken: `Trend plus ${decimal(changeKg!)} Kilogramm in 2 Wochen` };
      }
    }
  }
}

/** „Stand …“ nach der Tabelle in Spezifikation 5, Abschnitt 2; ohne das Wort „Stand“. */
export function ageText(age: DataAge): Spoken {
  switch (age.type) {
    case 'gerade_eben':
      return { shown: 'gerade eben', spoken: 'gerade eben' };
    case 'minuten':
      return { shown: `vor ${age.minutes} Min.`, spoken: `vor ${age.minutes} ${age.minutes === 1 ? 'Minute' : 'Minuten'}` };
    case 'heute':
      return { shown: `heute ${age.time}`, spoken: `heute ${age.time} Uhr` };
    case 'datum':
      return { shown: `${age.day}.${age.month}. ${age.time}`, spoken: `${age.day}.${age.month}. ${age.time} Uhr` };
  }
}

/**
 * Zugänglicher Name des Partnerkopfs auf „Wir“ und „Heute“, etwa „Anna, Tagesziele: unterwegs, Stand vor
 * 5 Minuten“. Ohne Tageszielstand oder Datenstand entfällt der jeweilige Teil.
 */
export function partnerHeadline(name: string, stage: PartnerDailyGoalStage | null, stand: Spoken | null): string {
  return [name, stage === null ? null : `${partnerTexts.stageLabel}: ${stageTexts[stage]}`, stand?.spoken].filter((part) => part != null).join(', ');
}

/** „Stand vor 5 Min.“ bzw. veraltet neutral „Offline · letzter Stand vor 12 Min.“. */
export function standText(age: DataAge, stale: boolean): Spoken {
  const { shown, spoken } = ageText(age);
  return stale
    ? { shown: `Offline · letzter Stand ${shown}`, spoken: `Offline, letzter Stand ${spoken}` }
    : { shown: `Stand ${shown}`, spoken: `Stand ${spoken}` };
}

/**
 * Texte von „Partner & Freigaben“ und dem Onboarding-Schritt `partner` (Spezifikation 5, Abschnitte 5 und 6; #129).
 * Wörtlich aus der Spezifikation: „Nicht gekoppelt“, „Mit … gekoppelt“, „Momo und Insel seit …“, die Abschnitte,
 * die Untertitel der Schalter und der Infotext. Die übrigen Sätze sind Designwerte (nicht belegt).
 */
export const sharingTexts = {
  notCoupled: 'Nicht gekoppelt',
  soloBody: 'Koppelt euch mit einem Code. Danach legst du hier fest, was dein Partner von dir sieht.',
  coupledWith: (name: string) => `Mit ${name} gekoppelt`,
  /** Lokales Datum im Kalender des Geräts, etwa „1. Oktober 2026“. */
  since: (localDate: LocalDate) => `Momo und Insel seit ${longDateText(localDate)}`,
  areasTitle: 'Gesundheitsbereiche',
  areaSubtitles: {
    ernaehrung: 'Anzahl erfasster Mahlzeiten',
    wasser: 'Anteil am Wasserziel in Prozent',
    sport: 'Wochenminuten und Wochenziel',
    gewicht: 'Nur Trend und Veränderung, nie dein absolutes Gewicht',
  } satisfies Readonly<Record<AreaKey, string>>,
  photosTitle: 'Fotos',
  photos: 'Mahlzeitenfotos teilen',
  photosSubtitle: 'Unabhängig von der Ernährungs-Freigabe. Einzelne Fotos kannst du beim Erfassen ausnehmen.',
  info: 'Abschalten beendet den Zugriff sofort. Bereits gemachte Screenshots kann die App nicht zurückholen.',
  loading: 'Freigaben werden geladen',
  /** Onboarding-Schritt `partner`, solo und nach einem erzeugten Code. */
  stepSolo: 'Zu zweit kümmert ihr euch gemeinsam um Momo. Lade deinen Partner ein oder gib einen Code ein, den du bekommen hast.',
  stepInviteCreated: 'Dein Code ist erzeugt. Sobald er eingegeben ist, seid ihr gekoppelt, auch wenn du schon weiter bist.',
  /** Onboarding-Schritt `partner` nach der Kopplung, über den Schaltern. */
  stepCoupled: (name: string) => `Mit ${name} gekoppelt. Lege fest, was ${name} von dir sieht.`,
  next: 'Weiter',
} as const;

/** Verlauf hinter „Alle anzeigen“ (Spezifikation 5, Abschnitt 2; #124): Überschriften wörtlich aus der Spezifikation. */
export const historyTexts = {
  thisWeek: 'Diese Woche',
  lastWeek: 'Letzte Woche',
  week: (isoWeek: number) => `KW ${isoWeek}`,
} as const;

/**
 * Texte der gemeinsamen Bereiche von „Wir“ (#124). Wörtlich aus den Spezifikationen: „Neu bei euch“, „Alle
 * anzeigen“, „Vorschlag gesendet“ und „Du: 4 von 6“ (Spezifikation 4, Abschnitt 10) sowie die Titel der
 * Vorgänge aus den Push-Titeln von Spezifikation 4, Abschnitt 12, ohne Emoji. „Ansehen“ und „Dein Bau-Anteil“
 * stammen aus dem Prototyp `prototypes/partner-bereich`. Die übrigen Sätze sind Designwerte (nicht belegt).
 */
export const sharedTexts = {
  challengeProposal: (name: string) => `${name} schlägt eine Challenge vor`,
  pendingAction: {
    rollenwahl: (name: string) => `${name} schlägt eure Rollen vor`,
    rollentausch: (name: string) => `${name} möchte die Rollen tauschen`,
    deko_schenken: (name: string) => `${name} schenkt dir Deko`,
  } satisfies Readonly<Record<PendingActionKind, (name: string) => string>>,
  open: 'Ansehen',
  validUntil: (weekday: Weekday, time: string) => `Gilt bis ${weekdayNames[weekday]}, ${time} Uhr`,
  quotedTemplate: (template: string, detail: string | null) => (detail === null ? `„${template}“` : `„${template}“ · ${detail}`),
  challenge: 'Challenge',
  sent: 'Vorschlag gesendet',
  ownShare: (count: number, required: number) => `Du: ${count} von ${required}`,
  stage: (stage: CommonStage) => `Gemeinsam: ${commonStageTexts[stage]}`,
  remaining: (days: number) => `noch ${days} ${days === 1 ? 'Tag' : 'Tage'}`,
  project: 'Gemeinschaftsprojekt',
  projectShare: (role: IslandRole, count: number, required: number) => `Dein ${roleNames[role]}-Anteil: ${count} von ${required} Energie`,
  news: 'Neu bei euch',
  showAll: 'Alle anzeigen',
  close: 'Schließen',
  unavailable: 'Gemeinsames ist gerade nicht verfügbar.',
  retry: 'Erneut versuchen',
} as const;

type PendingActionKind = Extract<WirContribution, { type: 'pending_shared_action' }>['kind'];

const roleNames: Readonly<Record<IslandRole, string>> = { bauen: 'Bau', natur: 'Natur' };

/** Gemeinsame Stufe von Challenge und Gemeinschaftsprojekt, ohne Partneranteil. */
const commonStageTexts: Readonly<Record<CommonStage, string>> = {
  gestartet: 'gestartet',
  gut_unterwegs: 'gut unterwegs',
  fast_geschafft: 'fast geschafft',
  geschafft: 'geschafft',
};

/**
 * Gemeinsame Ereignisse von Spezifikation 4 je `messageKey` (Spezifikation 0, Abschnitt 2: Text aus dem Schlüssel).
 * Die Ereignisse tragen keine Werte wie das Level, die Sätze bleiben deshalb allgemein (Designwerte, nicht belegt).
 */
export const sharedEventTexts: Readonly<Record<`neu_bei_euch.${SharedEventType}`, string>> = {
  'neu_bei_euch.momo_geschluepft': 'Momo ist geschlüpft',
  'neu_bei_euch.levelaufstieg': 'Momo ist ein Level aufgestiegen',
  'neu_bei_euch.gebiet': 'Neues Gebiet auf eurer Insel',
  'neu_bei_euch.projektabschluss': 'Euer Gemeinschaftsprojekt ist fertig',
  'neu_bei_euch.accessoire': 'Neues Accessoire im Schrank',
  'neu_bei_euch.deko_geschenkt': 'Geschenkte Deko ist angekommen',
  'neu_bei_euch.challenge_gestartet': 'Eure Challenge hat begonnen',
  'neu_bei_euch.challenge_geschafft': 'Challenge gemeinsam geschafft',
  'neu_bei_euch.challenge_abgelaufen': 'Eure Challenge-Woche ist vorbei',
  'neu_bei_euch.challenge_beendet': 'Challenge beendet',
};
