import { z } from 'zod';

import { LocalDate, localDateAfter, type BausteinKey, type EntityId, type Instant, type MessageKey, type MessageValues } from '@abnehm/contracts/base';
import { dailyBonusKey } from '@abnehm/contracts/energy';
import type { MomoReactionMood } from '@abnehm/game-rules/mood';

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

export type MomoReaction =
  /** „‹Baustein› erfüllt · +1 Energie“; Momo freut sich. */
  | Readonly<{ type: 'tageszielerfuellung'; baustein: BausteinKey }>
  /** „Alle drei geschafft · +1 Energie“; Momo ist begeistert. */
  | Readonly<{ type: 'tagesbonus' }>
  /** Tagesende-Gutschriften des Vortags als eine Meldung. */
  | Readonly<{ type: 'tagesende'; energy: number; bonus: boolean }>;

/**
 * Der einzige Baustein, der sich erst nach Ablauf des Kalendertags entscheidet (CONTEXT.md,
 * „Tagesende-Gutschrift“; Spezifikation 0, Abschnitt 3).
 */
const dayEndBaustein: BausteinKey = 'im_kalorienbudget';

type CreditEvent = Readonly<{ key: string; baustein: BausteinKey | null }>;

/**
 * Gutschriften eines Tags, deren Tageszielerfüllung lokal vorliegt, in der Reihenfolge der Erfüllung; der
 * Tagesbonus (`baustein: null`) zuletzt.
 */
function creditsOfDay(tx: ReadContext, personId: EntityId, localDate: LocalDate): CreditEvent[] {
  const goals = completionsOfDay(tx, personId, localDate)
    // Die Gutschrift trägt denselben Schlüssel wie ihre Erfüllung.
    .filter((completion) => bookingByKey(tx, completion.completionKey) !== null)
    .sort((a, b) => a.firstCompletedAt.localeCompare(b.firstCompletedAt) || a.slot - b.slot)
    .map((completion) => ({ key: completion.completionKey, baustein: completion.baustein }));
  const bonusKey = dailyBonusKey(personId, localDate);
  return bookingByKey(tx, bonusKey) === null ? goals : [...goals, { key: bonusKey, baustein: null }];
}

/** Tagesende-Gutschriften: die des Kalorienbudgets und an solchen Tagen der Tagesbonus. */
function dayEndCredits(credits: readonly CreditEvent[]): CreditEvent[] {
  if (!credits.some((credit) => credit.baustein === dayEndBaustein)) return [];
  return credits.filter((credit) => credit.baustein === dayEndBaustein || credit.baustein === null);
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
 * Beansprucht alle noch nicht gezeigten Ereignisse und liefert ihre Reaktionen: zuerst die gebündelten
 * Tagesende-Gutschriften von gestern, dann die Ereignisse von heute. Ein zweiter Aufruf liefert für
 * dieselben Ereignisse nichts mehr, auch nach einem Neustart.
 */
export function claimReactions(tx: TransactionContext, personId: EntityId, today: LocalDate, at: Instant): MomoReaction[] {
  const pending = unshown(tx, personId, today);
  if (pending.today.length === 0 && pending.dayEnd.length === 0) return [];
  const days = {
    [pending.yesterday]: [...(pending.shown[pending.yesterday] ?? []), ...pending.dayEnd.map((credit) => credit.key)],
    [today]: [...(pending.shown[today] ?? []), ...pending.today.map((credit) => credit.key)],
  };
  writeDeviceState(tx, stateKey, ShownReactions.parse({ days }), at);
  const reactions: MomoReaction[] = pending.today.map((credit) =>
    credit.baustein === null ? { type: 'tagesbonus' } : { type: 'tageszielerfuellung', baustein: credit.baustein },
  );
  if (pending.dayEnd.length === 0) return reactions;
  return [{ type: 'tagesende', energy: pending.dayEnd.length, bonus: pending.dayEnd.some((credit) => credit.baustein === null) }, ...reactions];
}

const withBonus = (reaction: MomoReaction) => reaction.type === 'tagesbonus' || (reaction.type === 'tagesende' && reaction.bonus);

/** Momos Stimmung zu Reaktionen aus einem Commit: begeistert mit Tagesbonus, sonst freut sich. */
export function moodOfReactions(reactions: readonly MomoReaction[]): MomoReactionMood {
  return reactions.some(withBonus) ? 'begeistert' : 'freut_sich';
}

/** Die eine Haptik zu Reaktionen aus einem Commit; mit Tagesbonus die des Bonus. */
export function hapticOfReactions(reactions: readonly MomoReaction[]): HapticKind {
  return reactions.some(withBonus) ? 'tagesbonus' : 'tageszielerfuellung';
}

/** Die Meldung einer Reaktion für den Meldungs-Host; die Texte stehen in `shell/message-texts.ts`. */
export function messageOfReaction(reaction: MomoReaction): Readonly<{ messageKey: MessageKey; values: MessageValues }> {
  switch (reaction.type) {
    case 'tageszielerfuellung':
      return { messageKey: 'momo.tagesziel_erfuellt', values: { baustein: reaction.baustein } };
    case 'tagesbonus':
      return { messageKey: 'momo.tagesbonus', values: {} };
    case 'tagesende':
      return { messageKey: 'momo.tagesende', values: { energy: reaction.energy, bonus: reaction.bonus } };
  }
}
