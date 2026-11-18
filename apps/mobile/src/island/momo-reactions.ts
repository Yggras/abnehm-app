import { z } from 'zod';

import { LocalDate, localDateAfter, type BausteinKey, type EntityId, type Instant, type MessageKey, type MessageValues } from '@abnehm/contracts/base';
import { decidedAtDayEnd } from '@abnehm/contracts/daily-goals';
import { dailyBonusKey } from '@abnehm/contracts/energy';
import { strongestEvent, type MomoEvent } from '@abnehm/game-rules/mood';

import { completionsOfDay } from '../daily-goals';
import { bookingByKey } from '../energy';
import type { HapticKind } from '../haptics/haptics';
import type { ReadContext, TransactionContext } from '../local-db';
import { readDeviceState, writeDeviceState } from '../local-db/device-state';

// Momos Reaktionen auf Fundament-Ereignisse (Spezifikation 4, Abschnitt 6; #188). Reagiert wird auf
// Gutschriften der eigenen Person: jede Tageszielerfüllung und den Tagesbonus des aktuellen lokalen Tags
// und, gebündelt, die Tagesende-Gutschriften des Vortags. Ältere Ereignisse, etwa aus dem Pull eines
// anderen eigenen Geräts, übernimmt die App still. Grundlage ist nur das erstmalige Erfüllungsereignis:
// Seine Gutschrift bleibt nach einer Korrektur bestehen und entsteht nie ein zweites Mal.
//
// Dauerhafte Ereignis-ID ist der Buchungsschlüssel (`tagesziel:<person>:<tag>:<platz>`,
// `tagesbonus:<person>:<tag>`); er überlebt den Austausch eines lokalen Duplikats gegen den kanonischen
// Datensatz. Welche Schlüssel diese Installation gezeigt hat, merkt sie im Gerätezustand, ohne Sync, nur für
// heute und gestern. Beanspruchen und Merken laufen in einer Transaktion (Spezifikation 0, Abschnitt 1).

/**
 * Alle in einem Commit neu gezeigten Ereignisse, zusammengefasst zu einer Meldung (Nutzerentscheidung in
 * #188, https://github.com/Yggras/abnehm-app/issues/188#issuecomment-6986767756): etwa „Wasserziel erfüllt ·
 * +1 Energie“, „Alle drei geschafft · +2 Energie“ für das dritte Tagesziel samt Bonus oder „Gestern im
 * Kalorienbudget · +1 Energie“ für die Tagesende-Gutschriften.
 */
export type MomoReaction = Readonly<{
  /** Tagesende-Gutschriften des Vortags, gebündelt, mit oder ohne Bonus; `null` ohne. */
  yesterday: Readonly<{ bonus: boolean }> | null;
  /** Heute erstmals erfüllte Tagesziele, in der Reihenfolge der Erfüllung. */
  goals: readonly BausteinKey[];
  /** Heute der Tagesbonus. */
  bonus: boolean;
  /** Summe der Beträge aller dieser Gutschriften. */
  energy: number;
}>;

type CreditEvent = Readonly<{ key: string; baustein: BausteinKey | null; amount: number }>;

const isBonus = (credit: CreditEvent) => credit.baustein === null;
const atDayEnd = (credit: CreditEvent) => credit.baustein !== null && decidedAtDayEnd(credit.baustein);

/**
 * Gutschriften eines Tags, deren Tageszielerfüllung lokal vorliegt, in der Reihenfolge der Erfüllung; der
 * Tagesbonus (`baustein: null`) zuletzt.
 */
function creditsOfDay(tx: ReadContext, personId: EntityId, localDate: LocalDate): CreditEvent[] {
  const goals = completionsOfDay(tx, personId, localDate)
    .sort((a, b) => a.firstCompletedAt.localeCompare(b.firstCompletedAt) || a.slot - b.slot)
    .flatMap((completion) => {
      // Die Gutschrift trägt denselben Schlüssel wie ihre Erfüllung.
      const credit = bookingByKey(tx, completion.completionKey);
      return credit === null ? [] : [{ key: completion.completionKey, baustein: completion.baustein, amount: credit.amount }];
    });
  const bonusKey = dailyBonusKey(personId, localDate);
  const bonus = bookingByKey(tx, bonusKey);
  return bonus === null ? goals : [...goals, { key: bonusKey, baustein: null, amount: bonus.amount }];
}

/**
 * Tagesende-Gutschriften (CONTEXT.md): die der Bausteine, die sich erst nach Ablauf des Kalendertags
 * entscheiden, und an solchen Tagen der Tagesbonus.
 */
function dayEndCredits(credits: readonly CreditEvent[]): CreditEvent[] {
  if (!credits.some(atDayEnd)) return [];
  return credits.filter((credit) => atDayEnd(credit) || isBonus(credit));
}

const stateKey = 'momo_reaktionen';
/** Gezeigte Ereignis-IDs je lokalem Tag; nur heute und gestern werden aufbewahrt. */
const ShownReactions = z.strictObject({ days: z.record(LocalDate, z.array(z.string())) });

function shownOf(tx: ReadContext): Readonly<Partial<Record<LocalDate, readonly string[]>>> {
  const parsed = ShownReactions.safeParse(readDeviceState(tx, stateKey));
  return parsed.success ? parsed.data.days : {};
}

function unshown(tx: ReadContext, personId: EntityId, today: LocalDate) {
  const yesterday = localDateAfter(today, -1);
  const shown = shownOf(tx);
  const isNew = (day: LocalDate) => (credit: CreditEvent) => !(shown[day] ?? []).includes(credit.key);
  return {
    shown,
    yesterday,
    today: creditsOfDay(tx, personId, today).filter(isNew(today)),
    dayEnd: dayEndCredits(creditsOfDay(tx, personId, yesterday)).filter(isNew(yesterday)),
  };
}

/** Ob es Ereignisse gibt, die diese Installation noch nicht gezeigt hat; nur lesend, für die Beobachtung. */
export function hasUnshownReactions(tx: ReadContext, personId: EntityId, today: LocalDate): boolean {
  const pending = unshown(tx, personId, today);
  return pending.today.length > 0 || pending.dayEnd.length > 0;
}

/**
 * Beansprucht alle noch nicht gezeigten Ereignisse und fasst sie zu einer Reaktion zusammen; `null`, wenn
 * es keine gibt. Ein zweiter Aufruf liefert für dieselben Ereignisse nichts mehr, auch nach einem Neustart.
 */
export function claimReaction(tx: TransactionContext, personId: EntityId, today: LocalDate, at: Instant): MomoReaction | null {
  const pending = unshown(tx, personId, today);
  if (pending.today.length === 0 && pending.dayEnd.length === 0) return null;
  const days = {
    [pending.yesterday]: [...(pending.shown[pending.yesterday] ?? []), ...pending.dayEnd.map((credit) => credit.key)],
    [today]: [...(pending.shown[today] ?? []), ...pending.today.map((credit) => credit.key)],
  };
  writeDeviceState(tx, stateKey, ShownReactions.parse({ days }), at);
  return {
    yesterday: pending.dayEnd.length === 0 ? null : { bonus: pending.dayEnd.some(isBonus) },
    goals: pending.today.flatMap((credit) => (credit.baustein === null ? [] : [credit.baustein])),
    bonus: pending.today.some(isBonus),
    energy: [...pending.dayEnd, ...pending.today].reduce((sum, credit) => sum + credit.amount, 0),
  };
}

/** Die eigenen Ereignisse hinter einer Reaktion; gestern mit Bonus zählt als Tagesbonus. */
export function eventsOf(reaction: MomoReaction): MomoEvent[] {
  const events: MomoEvent[] = reaction.goals.map(() => 'tageszielerfuellung');
  if (reaction.bonus) events.push('tagesbonus');
  if (reaction.yesterday !== null) events.push(reaction.yesterday.bonus ? 'tagesbonus' : 'tageszielerfuellung');
  return events;
}

/**
 * Die eine Haptik zu Ereignissen aus einem Commit: die des stärksten (`strongestEvent` der Spielregeln).
 * Die Haptik-Arten sind genau die Ereignisse, auf die Momo reagiert (#95).
 */
export function hapticOf(events: readonly MomoEvent[]): HapticKind {
  return strongestEvent(events);
}

/**
 * Die eine Meldung einer Reaktion für den Meldungs-Host (`momo.energie`); den Text setzt
 * `shell/message-texts.ts` zusammen. Bis zu drei Tagesziele stehen als `ziel1` bis `ziel3`, weil
 * Meldungswerte flach sind (`MessageValues`).
 */
export function messageOfReaction(reaction: MomoReaction): Readonly<{ messageKey: MessageKey; values: MessageValues }> {
  const goals = Object.fromEntries(reaction.goals.map((baustein, index) => [`ziel${index + 1}`, baustein]));
  return {
    messageKey: 'momo.energie',
    values: {
      ...goals,
      bonus: reaction.bonus,
      gestern: reaction.yesterday !== null,
      gesternBonus: reaction.yesterday?.bonus ?? false,
      energie: reaction.energy,
    },
  };
}
