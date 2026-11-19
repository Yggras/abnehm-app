import type { DailyGoalState } from '@abnehm/contracts/daily-goals';
import { countedWaterMl, countingSportEntries, isCountingWeightEntry, isWeighDay } from '@abnehm/contracts/tracker-rules';

import { bausteinEvaluation, isDayClosed, type BausteinEvaluator, type CheckInEvaluator, type DayFactsReader } from '../daily-goals';
import { sportEntriesOfDay } from './sport-repository';
import { waterEntriesOfDay } from './water-repository';
import { weightEntriesOfDay } from './weight-repository';

// Beiträge von Wasser, Sport und Gewicht zur Baustein-Auswertung und zum Tages-Check-in (Spezifikation 3,
// Abschnitt 7; Spezifikation 0, Abschnitt 3). Je Tracker liest ein Reader die Tagesfakten nur aus der
// eigenen Tabelle und zählt nach den geteilten Tracker-Regeln. Die Evaluatoren und Check-ins werten nur
// diese Fakten, den Snapshot und den Plan des Aufrufers aus. Tageszielerfüllung und Energie legt allein
// das Fundament an; der Composition Root registriert die Liste in seiner Registry.

/** Wasser eines Tags: Summe der nicht gelöschten Einträge in ml. */
export type WaterDayFacts = Readonly<{ countedMl: number }>;
/** Sport eines Tags: die Dauer jeder zählenden Einheit in Minuten, aufsteigend nach Beginn. */
export type SportDayFacts = Readonly<{ countingSessionMinutes: readonly number[] }>;
/** Gewicht eines Tags: Zahl der zählenden Messungen, manuell oder importiert. */
export type WeightDayFacts = Readonly<{ countingEntries: number }>;

const readWaterDayFacts: DayFactsReader<WaterDayFacts> = (tx, personId, localDate) => ({
  countedMl: countedWaterMl(waterEntriesOfDay(tx, personId, localDate), localDate),
});

// Die Abfrage liefert auch ersetzende Importe von Nachbartagen; gezählt werden nur Einheiten dieses Tags.
const readSportDayFacts: DayFactsReader<SportDayFacts> = (tx, personId, localDate) => ({
  countingSessionMinutes: countingSportEntries(sportEntriesOfDay(tx, personId, localDate))
    .filter((entry) => entry.localDate === localDate)
    .map((entry) => entry.durationMinutes),
});

const readWeightDayFacts: DayFactsReader<WeightDayFacts> = (tx, personId, localDate) => ({
  countingEntries: weightEntriesOfDay(tx, personId, localDate).filter(isCountingWeightEntry).length,
});

/** 0 `offen`, unter der Schwelle `teilweise`, ab der Schwelle `erfuellt` (Spezifikation 0, Abschnitt 3). */
function graded(value: number, threshold: number): DailyGoalState {
  return value === 0 ? 'offen' : value < threshold ? 'teilweise' : 'erfuellt';
}

const longestSession = ({ countingSessionMinutes }: SportDayFacts) => Math.max(0, ...countingSessionMinutes);

/** Wasserziel: gezählte ml gegen das Ziel aus dem Snapshot. */
const waterGoal: BausteinEvaluator<'wasserziel', WaterDayFacts> = {
  baustein: 'wasserziel',
  readFacts: readWaterDayFacts,
  evaluate(snapshot, at, { countedMl }) {
    const { targetMl } = snapshot;
    return bausteinEvaluation(graded(countedMl, targetMl), isDayClosed(snapshot, at), { type: snapshot.type, countedMl, targetMl });
  },
};

/** Sporteinheit: die längste zählende Einheit gegen die Mindestdauer; kürzere Einheiten addieren sich nicht. */
const sportGoal: BausteinEvaluator<'sporteinheit', SportDayFacts> = {
  baustein: 'sporteinheit',
  readFacts: readSportDayFacts,
  evaluate(snapshot, at, facts) {
    const { minimumSingleSessionMinutes } = snapshot;
    const longestSessionMinutes = longestSession(facts);
    return bausteinEvaluation(graded(longestSessionMinutes, minimumSingleSessionMinutes), isDayClosed(snapshot, at), {
      type: snapshot.type,
      longestSessionMinutes,
      minimumSingleSessionMinutes,
    });
  },
};

/** Gewogen: erfüllt ab einer zählenden Messung, auch einer importierten; nie `teilweise`. */
const weighedGoal: BausteinEvaluator<'gewogen', WeightDayFacts> = {
  baustein: 'gewogen',
  readFacts: readWeightDayFacts,
  evaluate(snapshot, at, { countingEntries }) {
    return bausteinEvaluation(countingEntries === 0 ? 'offen' : 'erfuellt', isDayClosed(snapshot, at), {
      type: snapshot.type,
      weightEntryCount: countingEntries,
    });
  },
};

/** Tages-Check-in `wasser` (#37): mittags unter ⅓, abends unter ⅔ des Wasserziels der Zielversion. */
const waterCheckIn: CheckInEvaluator<'wasser', WaterDayFacts> = {
  tracker: 'wasser',
  readFacts: readWaterDayFacts,
  evaluate({ moment, plan }, { countedMl }) {
    const targetMl = plan.goal.waterTargetMl;
    // Ganzzahlig verglichen, damit ⅓ und ⅔ nicht gerundet werden.
    return { behind: countedMl * 3 < targetMl * (moment === 'mittag' ? 1 : 2), reason: { type: 'wasser', countedMl, targetMl } };
  },
};

/**
 * Weicher Textschlüssel des Sport-Check-ins: „Schon trainiert? Öffne die App, damit Momo es mitbekommt“.
 * Ein Training kann noch im Health-Import fehlen (Spezifikation 3, Abschnitt 7).
 */
export const sportCheckInMessageKey = 'checkin.sport.schon_trainiert';

/** Tages-Check-in `sport` (#37): mittags nie, abends am Sporttag ohne zählende Einheit. */
const sportCheckIn: CheckInEvaluator<'sport', SportDayFacts> = {
  tracker: 'sport',
  readFacts: readSportDayFacts,
  evaluate({ moment, plan }, { countingSessionMinutes }) {
    const sportDay = plan.weeklyPlanDay.bausteine.includes('sporteinheit');
    const hasCountingEntry = countingSessionMinutes.length > 0;
    return {
      behind: moment === 'abend' && sportDay && !hasCountingEntry,
      reason: { type: 'sport', sportDay, hasCountingEntry, messageKey: sportCheckInMessageKey },
    };
  },
};

/** Tages-Check-in `gewicht` (#37): mittags und abends am Wiegetag ohne zählende Messung; nie mit Gewichtswerten. */
const weightCheckIn: CheckInEvaluator<'gewicht', WeightDayFacts> = {
  tracker: 'gewicht',
  readFacts: readWeightDayFacts,
  evaluate({ plan }, { countingEntries }) {
    const weighDay = isWeighDay(plan.weeklyPlanDay.bausteine);
    const hasCountingEntry = countingEntries > 0;
    return { behind: weighDay && !hasCountingEntry, reason: { type: 'gewicht', weighDay, hasCountingEntry } };
  },
};

/** Was Wasser, Sport und Gewicht in der Registry der Tagesziele registrieren. */
export const trackerDailyGoals = {
  bausteine: [waterGoal, sportGoal, weighedGoal],
  checkIns: [waterCheckIn, sportCheckIn, weightCheckIn],
} as const;
