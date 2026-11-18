import { localDateAfter, type LocalDate } from '@abnehm/contracts/base';
import type { MomoMood } from '@abnehm/contracts/island';

import { assertWholeNumber } from './whole-number.ts';

// Momos Stimmung (Spezifikation 4, Abschnitt 6; Design-System › Momo). Sie wird je betrachtender Person
// auf deren Gerät abgeleitet und nie synchronisiert. Traurig, krank, hungrig oder strafend ist Momo nie
// (#12): Die schwächste Stimmung ist „döst“.

/** Wo Momo gezeigt wird: auf „Heute“ (und in Leerzuständen) oder in der Inselansicht. */
export type MomoView = 'heute' | 'insel';

/** Laufende Reaktion auf ein eigenes Ereignis: Tagesbonus oder Levelaufstieg bzw. Tageszielerfüllung. */
export type MomoReactionMood = Extract<MomoMood, 'begeistert' | 'freut_sich'>;

/** Ein eigenes Ereignis, auf das Momo kurz reagiert. */
export type MomoEvent = 'tageszielerfuellung' | 'tagesbonus' | 'levelaufstieg';

/** Rangfolge der Ereignisse, das stärkste zuerst. */
const eventRank: readonly MomoEvent[] = ['levelaufstieg', 'tagesbonus', 'tageszielerfuellung'];

/** Das stärkste von Ereignissen, die zusammen eintreffen: Levelaufstieg vor Tagesbonus vor Tageszielerfüllung. */
export function strongestEvent(events: readonly MomoEvent[]): MomoEvent {
  const strongest = eventRank.find((event) => events.includes(event));
  if (strongest === undefined) throw new RangeError('Ohne Ereignis gibt es keine Reaktion');
  return strongest;
}

/**
 * Momos Reaktion auf eigene Ereignisse, die zusammen eintreffen: begeistert nach Tagesbonus oder
 * Levelaufstieg, sonst freut sich (Spezifikation 4, Abschnitt 6).
 */
export function reactionMood(events: readonly MomoEvent[]): MomoReactionMood {
  return strongestEvent(events) === 'tageszielerfuellung' ? 'freut_sich' : 'begeistert';
}

export type MoodFacts = Readonly<{
  view: MomoView;
  /** Die Reaktion, solange sie läuft (`duration-celebrate`); danach `null`. */
  reaction: MomoReactionMood | null;
  /** Lokale Uhrzeit als Minute des Tags, 0–1439. */
  minuteOfDay: number;
  /** Für die Person neue Ereignisse plus erfüllbare Wünsche (`islandNotice`). */
  islandNotice: number;
  today: LocalDate;
  /** Lokaler Tag der jüngsten eigenen Tageszielerfüllung; `null` ohne jede. */
  lastOwnCompletion: LocalDate | null;
}>;

/** Momo schläft auf der Insel von 20:00 bis 06:00 lokaler Zeit (Designwert aus #83, Abschnitt 6, nicht belegt). */
const sleepFrom = 20 * 60;
const sleepUntil = 6 * 60;
const minutesPerDay = 24 * 60;

/** Die Stimmung zu den Fakten, Priorität von oben nach unten wie in Abschnitt 6 von #83. */
export function momoMood(facts: MoodFacts): MomoMood {
  const minuteOfDay = assertWholeNumber(facts.minuteOfDay, 0, 'Minute des Tags');
  if (minuteOfDay >= minutesPerDay) throw new RangeError(`Minute des Tags muss unter ${minutesPerDay} liegen: ${minuteOfDay}`);
  const islandNotice = assertWholeNumber(facts.islandNotice, 0, 'Insel-Hinweise');

  if (facts.reaction !== null) return facts.reaction;
  if (facts.view === 'insel' && (minuteOfDay >= sleepFrom || minuteOfDay < sleepUntil)) return 'schlaeft';
  if (islandNotice > 0) return 'neugierig';
  // Lokale Tage `YYYY-MM-DD` ordnen sich als Zeichenfolgen kalendarisch.
  if (facts.lastOwnCompletion === null || facts.lastOwnCompletion < localDateAfter(facts.today, -1)) return 'doest';
  return 'zufrieden';
}
