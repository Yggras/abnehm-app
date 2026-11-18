import { minutesOfDay, readingOf, type ClockReading } from '@abnehm/clock';
import type { DisplayName, EntityId, Instant } from '@abnehm/contracts/base';
import type { PartnerDailyGoalStage, PartnerSummaryEnvelope } from '@abnehm/contracts/partner';
import type { UiActionIntent } from '@abnehm/contracts/routes';

import type { PartnerCache } from '../partner-cache';
import type { TodayState } from '../shell/today-registry';

// Was „Wir“ und die Partner-Karte auf „Heute“ über den Partner zeigen (Spezifikation 5, Abschnitte 2
// und 3; #121). Reine Ableitung aus dem widerrufbaren Partnercache, dem Zeitpunkt des letzten
// vollständigen Pulls, dem Netzstatus und einer Ablesung der Uhr.

/** Ab diesem Alter des letzten vollständigen Pulls gilt der Partnerstand als veraltet (Spezifikation 5, Abschnitt 2). */
export const staleAfterMs = 10 * 60_000;

/** Was die App zuletzt über den Partner weiß; `null`, solange die eigene Person lokal fehlt. */
export type PartnerReading = Readonly<{ cache: PartnerCache; lastPullAt: Instant | null }> | null;

/** Alter eines Datenstands nach der Tabelle in Spezifikation 5, Abschnitt 2. */
export type DataAge =
  | Readonly<{ type: 'gerade_eben' }>
  | Readonly<{ type: 'minuten'; minutes: number }>
  | Readonly<{ type: 'heute'; time: string }>
  | Readonly<{ type: 'datum'; day: string; month: string; time: string }>;

export type CoupledPartner = Readonly<{
  personId: EntityId;
  displayName: DisplayName;
  /** Grober Tageszielstand samt Datenstand; `null`, bis der Server ihn berechnet hat. */
  dailyGoal: Readonly<{ stage: PartnerDailyGoalStage; dataAsOf: Instant }> | null;
  /** Je freigegebenem Bereich eine Zusammenfassung in der Reihenfolge Ernährung, Wasser, Sport, Gewicht. */
  summaries: readonly PartnerSummaryEnvelope[];
  /** Alter des jüngsten Datenstands der Übersicht; `null` ohne Projektion. */
  age: DataAge | null;
  /** Letzter vollständiger Pull älter als 10 Minuten oder Gerät offline. */
  stale: boolean;
}>;

export type WirPartner = Readonly<{ type: 'loading' }> | Readonly<{ type: 'solo' }> | Readonly<{ type: 'coupled' } & CoupledPartner>;

const pad = (value: number) => String(value).padStart(2, '0');

export function dataAgeOf(dataAsOf: Instant, now: ClockReading): DataAge {
  const ms = Date.parse(now.instant) - Date.parse(dataAsOf);
  if (ms < 60_000) return { type: 'gerade_eben' };
  if (ms < 60 * 60_000) return { type: 'minuten', minutes: Math.floor(ms / 60_000) };
  const then = readingOf(dataAsOf, now.timeZone);
  const minutes = minutesOfDay(then);
  const time = `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
  if (then.localDate === now.localDate) return { type: 'heute', time };
  const [, month, day] = then.localDate.split('-');
  return { type: 'datum', day: day!, month: month!, time };
}

function isStale(lastPullAt: Instant | null, online: boolean, now: ClockReading): boolean {
  return !online || lastPullAt === null || Date.parse(now.instant) - Date.parse(lastPullAt) > staleAfterMs;
}

export function wirPartnerOf(reading: PartnerReading, online: boolean, now: ClockReading): WirPartner {
  if (reading === null) return { type: 'loading' };
  const { cache, lastPullAt } = reading;
  if (cache.partner === null) return { type: 'solo' };
  const status = cache.dailyGoalStatus;
  const newest = [status?.dataAsOf, ...cache.summaries.map((summary) => summary.dataAsOf)]
    .filter((at): at is Instant => at !== undefined)
    .reduce<Instant | null>((latest, at) => (latest === null || Date.parse(at) > Date.parse(latest) ? at : latest), null);
  return {
    type: 'coupled',
    personId: cache.partner.personId,
    displayName: cache.partner.displayName,
    dailyGoal: status === null ? null : { stage: status.stage, dataAsOf: status.dataAsOf },
    summaries: cache.summaries,
    age: newest === null ? null : dataAgeOf(newest, now),
    stale: isStale(lastPullAt, online, now),
  };
}

/** Die Aktionen des Partnerbereichs, auf „Heute“ als `UiActionIntent` im Beitrag, auf „Wir“ direkt. */
export const partnerActions = {
  invite: { actionId: 'partner_card.invite', target: { type: 'partner.invite' } },
  redeem: { actionId: 'partner_card.redeem', target: { type: 'partner.redeem' } },
  encourage: { actionId: 'partner_card.encourage', target: { type: 'partner.encourage' } },
} as const satisfies Record<string, UiActionIntent>;
const { invite: inviteAction, redeem: redeemAction, encourage: encourageAction } = partnerActions;

/**
 * Beitrag `partner` für „Heute“: solo Einladen und Code eingeben, gekoppelt Anzeigename, grober
 * Tageszielstand, dessen `dataAsOf` und Anfeuern; veraltet als `stale`. Zusammenfassungen gibt es dort nie.
 * Gekoppelt ohne berechneten Tageszielstand lädt die Karte noch.
 */
export function partnerCardOf(partner: WirPartner): TodayState<'partner'> {
  switch (partner.type) {
    case 'loading':
      return { type: 'loading' };
    case 'solo':
      return { type: 'ready', data: { type: 'solo', inviteAction, redeemAction } };
    case 'coupled': {
      if (partner.dailyGoal === null) return { type: 'loading' };
      const { stage, dataAsOf } = partner.dailyGoal;
      const data = { type: 'coupled', partnerDisplayName: partner.displayName, dailyGoalStage: stage, dataAsOf, encourageAction } as const;
      return partner.stale ? { type: 'stale', data, dataAsOf } : { type: 'ready', data };
    }
  }
}
