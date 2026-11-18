import type { AreaKey } from '@abnehm/contracts/base';
import type { PartnerDailyGoalStage, PartnerSummaryEnvelope } from '@abnehm/contracts/partner';

import { titleOf } from '../shell/texts';
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
  loading: 'Partner lädt …',
  /** Veraltet, aber noch ohne Datenstand, etwa zwischen zwei Pull-Seiten direkt nach dem Koppeln. */
  offline: 'Offline',
} as const;

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
