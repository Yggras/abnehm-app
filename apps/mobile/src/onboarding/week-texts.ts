import type { BausteinKey, Weekday } from '@abnehm/contracts/base';

import { bausteinNames, germanList, weekdayNames, weekdayShortNames } from '../shell/texts';
import { resultTexts } from './goal-texts';

// Sichtbare Texte und zugängliche Namen von Onboarding-Schritt 8 „Wochenplan“ (Spezifikation 1, Abschnitte 4
// und 9). Der Grund der Sperre folgt dem Standard-Wochenplan: Der dritte Platz eines Tags ist am Sporttag
// „Sporteinheit“, am Wiegetag „Gewogen“.

const names = (bausteine: readonly BausteinKey[]) => germanList(bausteine.map((key) => bausteinNames[key]));

export const weeklyPlanTexts = {
  intro: 'Wähle deine Sporttage und deinen Wiegetag. Daraus entstehen deine drei Tagesziele für jeden Wochentag.',
  sportDays: 'Sporttage',
  weighDay: 'Wiegetag',
  weekday: (weekday: Weekday) => weekdayNames[weekday],
  weekdayShort: (weekday: Weekday) => weekdayShortNames[weekday],
  /** Am gesperrten Sporttag-Chip und als Satz unter den Sporttagen. */
  weighDayLocked: (weekday: Weekday) =>
    `${weekdayNames[weekday]} ist dein Wiegetag. Dort ist das dritte Tagesziel „${bausteinNames.gewogen}“, darum ist er kein Sporttag.`,
  /** Am gesperrten Wiegetag-Chip. */
  sportDayLocked: (weekday: Weekday) =>
    `${weekdayNames[weekday]} ist ein Sporttag. Dort ist das dritte Tagesziel „${bausteinNames.sporteinheit}“, darum ist er kein Wiegetag.`,
  /** Als Satz unter dem Wiegetag, solange es Sporttage gibt; gilt für alle gesperrten Wiegetag-Chips zugleich. */
  sportDaysLocked: `Sporttage sind kein Wiegetag: Dort ist das dritte Tagesziel „${bausteinNames.sporteinheit}“.`,
  /**
   * Gilt heute schon ein Plan, etwa nach „Zurück“ aus Schritt 9, gelten Änderungen ab morgen (Spezifikation 1,
   * Abschnitt 4; Entscheidung in #134). Die Tagesziele von heute behalten die Werte des ersten Speicherns.
   */
  fromTomorrow: 'Dein Plan gilt schon ab heute. Was du hier änderst, gilt ab morgen; deine Tagesziele für heute bleiben.',
  preview: 'Deine Woche',
  /** Zugänglicher Name einer Zeile der Vorschau, etwa „Montag: Ernährung erfasst, Wasserziel und Gewogen“. */
  dayLabel: (weekday: Weekday, bausteine: readonly BausteinKey[]) => `${weekdayNames[weekday]}: ${names(bausteine)}`,
  /** Über der Vorschau: die zwei Ziele, die jeden Tag gelten; je Wochentag steht dann nur das dritte. */
  everyDay: (bausteine: readonly BausteinKey[]) => `Jeden Tag: ${names(bausteine)}. Dazu je Wochentag:`,
  baustein: (key: BausteinKey) => bausteinNames[key],
  /** Schwelle der Sporteinheit = Sportwochenziel ÷ Sporttage, aufgerundet (Abschnitt 3). */
  minimumSession: (minutes: number, weeklyMinutes: number, sportDays: number) =>
    `Eine Sporteinheit zählt ab ${minutes} Minuten: dein Sportziel von ${weeklyMinutes} Minuten pro Woche, verteilt auf ${sportDays} ${sportDays === 1 ? 'Sporttag' : 'Sporttage'}.`,
  noSportDay: (weeklyMinutes: number) =>
    `Ohne Sporttag gibt es kein Tagesziel „${bausteinNames.sporteinheit}“. Dein Sportziel von ${weeklyMinutes} Minuten pro Woche bleibt.`,
  save: 'Plan speichern',
  retry: 'Erneut versuchen',
  failed: 'Dein Plan ist noch nicht gespeichert. Versuch es bitte noch einmal.',
  /** Der Entwurf ergibt keinen Plan mehr, etwa nach einem Tageswechsel über einen Geburtstag. */
  incomplete: resultTexts.incomplete,
} as const;
