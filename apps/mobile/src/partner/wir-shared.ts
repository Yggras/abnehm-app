import { readingOf, type ClockReading } from '@abnehm/clock';
import { weekdayOf, type Instant } from '@abnehm/contracts/base';
import type { ContributionState } from '@abnehm/contracts/contribution';
import type { UiActionIntent } from '@abnehm/contracts/routes';
import { needsResponse, type SharedEventType, type WirContribution } from '@abnehm/contracts/wir';
import { indexCatalog, type CatalogEntryKind } from '@abnehm/game-rules/catalog';
import { gameCatalog } from '@abnehm/game-rules/content';

import type { IconName } from '../design/icon-shapes';
import { shellTexts } from '../shell/texts';
import { isTestArtifact } from '../test-artifact';
import { clockTimeOf, dataAgeOf } from './partner-view';
import { ageText, sharedEventTexts, sharedTexts, type Spoken } from './texts';
import { historyOf, newestFirst, newsCount, type WeekGroup, type WirEvent } from './wir-events';

// Gemeinsame Bereiche von „Wir“ (Spezifikation 5, Abschnitt 2; #124) aus den Beiträgen von Spezifikation 4:
// antwortbedürftige Vorgänge, aktive gemeinsame Challenge, aktives Gemeinschaftsprojekt und „Neu bei euch“.
// Reine Ableitung aus dem Zustand der `WirContributionSource`, weiteren gemeinsamen Ereignissen (#126) und
// einer Ablesung der Uhr; Tabellen von Spezifikation 4 liest sie nicht. Die Beiträge werden unverändert
// gerendert: Stand, Bedarf und Stufe kommen aus dem Beitrag, nur Namen aus dem Spielkatalog.

type Of<T extends WirContribution['type']> = Extract<WirContribution, { type: T }>;

/** Ein antwortbedürftiger Vorgang; der Titel nennt die anfragende Person. */
export type ResponseCard = Readonly<{
  id: string;
  title: (partnerName: string) => string;
  detail: string | null;
  action: UiActionIntent | undefined;
}>;

/** Eine Karte unter „aktive gemeinsame Challenge“ oder „aktives Gemeinschaftsprojekt“. */
export type SharedCard = Readonly<{
  id: string;
  eyebrow: string;
  title: string;
  lines: readonly string[];
  action: UiActionIntent | undefined;
}>;

/** Ein Ereignis samt Zeitpunkt, angezeigt etwa „heute 12:00“, vorgelesen „heute 12:00 Uhr“. */
export type ShownEvent = WirEvent & Readonly<{ when: Spoken }>;

export type WirShared =
  /**
   * Keine `WirContributionSource` angemeldet: in Test-Artefakten ein Platzhalter, im Release ein
   * Integrationsfehler (Spezifikation 0, Abschnitt 6).
   */
  | Readonly<{ type: 'missing' }>
  | Readonly<{ type: 'loading' }>
  | Readonly<{ type: 'error'; retryAction: UiActionIntent | undefined }>
  | Readonly<{
      type: 'ready';
      responses: readonly ResponseCard[];
      challenges: readonly SharedCard[];
      projects: readonly SharedCard[];
      /** Die drei neuesten gemeinsamen Ereignisse. */
      news: readonly ShownEvent[];
      /** Ob es mehr Ereignisse gibt als `news`; nur dann führt „Alle anzeigen“ zum Verlauf. */
      hasMore: boolean;
      /** Alle lokal vorhandenen Ereignisse nach Kalenderwochen. */
      history: readonly (Omit<WeekGroup, 'events'> & Readonly<{ events: readonly ShownEvent[] }>)[];
    }>;

const catalog = indexCatalog(gameCatalog);

/** Sichtbarer Name eines Katalogeintrags; ein unbekannter Schlüssel zeigt den allgemeinen Namen der Art. */
function catalogName(kind: Extract<CatalogEntryKind, 'challenge_vorlage' | 'gemeinschaftsprojekt'>, key: string, fallback: string): string {
  const found = catalog.find(kind, key);
  return found.type === 'found' ? found.entry.name : fallback;
}

/** „Gilt bis Freitag, 14:00 Uhr“ in der Zone der betrachtenden Person. */
function validUntil(at: Instant | undefined, now: ClockReading): string | null {
  if (at === undefined) return null;
  const then = readingOf(at, now.timeZone);
  return sharedTexts.validUntil(weekdayOf(then.localDate), clockTimeOf(then));
}

const dayMs = 24 * 60 * 60_000;

/**
 * Restlaufzeit in angefangenen 24-Stunden-Blöcken, nicht in Kalendertagen: Eine Challenge läuft 7 × 24 Stunden ab
 * der Annahme, unabhängig von Zeitumstellungen (`challengeEndsAt` in `@abnehm/game-rules/challenges`). Nach dem
 * Ende entfällt sie.
 */
function remaining(endsAt: Instant | undefined, now: ClockReading): string | null {
  if (endsAt === undefined) return null;
  const ms = Date.parse(endsAt) - Date.parse(now.instant);
  return ms > 0 ? sharedTexts.remaining(Math.ceil(ms / dayMs)) : null;
}

function responseOf(contribution: Of<'challenge'> | Of<'pending_shared_action'>, now: ClockReading): ResponseCard {
  const { id, action } = contribution;
  if (contribution.type === 'pending_shared_action') {
    const { kind, requesterDisplayName, expiresAt } = contribution;
    return { id, action, title: () => sharedTexts.pendingAction[kind](requesterDisplayName), detail: validUntil(expiresAt, now) };
  }
  const template = catalogName('challenge_vorlage', contribution.templateKey, sharedTexts.challenge);
  return { id, action, title: sharedTexts.challengeProposal, detail: sharedTexts.quotedTemplate(template, validUntil(contribution.endsAt, now)) };
}

function challengeOf(contribution: Of<'challenge'>, now: ClockReading): SharedCard {
  const { id, action, templateKey, status, proposedBySelf, ownCount, ownRequired, stage, endsAt } = contribution;
  const lines =
    status === 'vorgeschlagen' && proposedBySelf
      ? [sharedTexts.sent, validUntil(endsAt, now)]
      : [sharedTexts.ownShare(ownCount, ownRequired), sharedTexts.stage(stage), status === 'aktiv' ? remaining(endsAt, now) : null];
  return {
    id,
    action,
    eyebrow: sharedTexts.challenge,
    title: catalogName('challenge_vorlage', templateKey, sharedTexts.challenge),
    lines: lines.filter((line): line is string => line !== null),
  };
}

function projectOf({ id, action, templateKey, ownRole, ownCount, ownRequired, stage }: Of<'community_project'>): SharedCard {
  return {
    id,
    action,
    eyebrow: sharedTexts.project,
    title: catalogName('gemeinschaftsprojekt', templateKey, sharedTexts.project),
    lines: [sharedTexts.projectShare(ownRole, ownCount, ownRequired), sharedTexts.stage(stage)],
  };
}

const sharedEventIcons: Readonly<Record<SharedEventType, IconName>> = {
  momo_geschluepft: 'star',
  levelaufstieg: 'star',
  gebiet: 'island',
  projektabschluss: 'hammer',
  accessoire: 'box',
  deko_geschenkt: 'box',
  challenge_gestartet: 'flag',
  challenge_geschafft: 'check',
  challenge_abgelaufen: 'flag',
  challenge_beendet: 'flag',
};

/** Ein `messageKey` ohne Text im Katalog: im Release ein Integrationsfehler wie beim Meldungs-Host. */
export class MissingSharedEventTextError extends Error {
  constructor(messageKey: string) {
    super(`Integrationsfehler: Text für das gemeinsame Ereignis „${messageKey}“ fehlt.`);
    this.name = 'MissingSharedEventTextError';
  }
}

/**
 * Ein Spiel-`shared_event` als gemeinsames Ereignis; der Text entsteht aus dem `messageKey` (Spezifikation 0,
 * Abschnitt 2). Fehlt er, zeigen Test-Artefakte „Text fehlt: …“, ein Release wirft.
 */
export function gameEventOf({ id, occurredAt, eventType, messageKey }: Of<'shared_event'>): WirEvent {
  const texts: Readonly<Record<string, string>> = sharedEventTexts;
  const text = Object.prototype.hasOwnProperty.call(texts, messageKey) ? texts[messageKey] : undefined;
  if (text === undefined && !isTestArtifact()) throw new MissingSharedEventTextError(messageKey);
  return { id, occurredAt, icon: sharedEventIcons[eventType], text: text ?? shellTexts.missingMessageText(messageKey) };
}

const byNewest = (a: WirContribution, b: WirContribution) => Date.parse(b.dataAsOf) - Date.parse(a.dataAsOf);

/**
 * Die gemeinsamen Bereiche aus dem Zustand der Spiel-Beiträge (`null`: nicht angemeldet) und weiteren
 * gemeinsamen Ereignissen anderer Quellen. Veraltete Beiträge zeigen ihren Inhalt; `empty` heißt nichts zu zeigen.
 */
export function wirSharedOf(state: ContributionState<WirContribution[]> | null, otherEvents: readonly WirEvent[], now: ClockReading): WirShared {
  if (state === null) return { type: 'missing' };
  switch (state.type) {
    case 'loading':
      return { type: 'loading' };
    case 'error':
      return { type: 'error', retryAction: state.retryAction };
    case 'empty':
    case 'ready':
    case 'stale': {
      const responses: ResponseCard[] = [];
      const challenges: SharedCard[] = [];
      const projects: SharedCard[] = [];
      const events: WirEvent[] = [...otherEvents];
      for (const entry of state.type === 'empty' ? [] : [...state.data].sort(byNewest)) {
        switch (entry.type) {
          case 'pending_shared_action':
            responses.push(responseOf(entry, now));
            break;
          case 'challenge':
            if (needsResponse(entry)) responses.push(responseOf(entry, now));
            else challenges.push(challengeOf(entry, now));
            break;
          case 'community_project':
            projects.push(projectOf(entry));
            break;
          case 'shared_event':
            events.push(gameEventOf(entry));
            break;
        }
      }
      const sorted = newestFirst(events);
      const shown = (event: WirEvent): ShownEvent => ({ ...event, when: ageText(dataAgeOf(event.occurredAt, now)) });
      return {
        type: 'ready',
        responses,
        challenges,
        projects,
        news: sorted.slice(0, newsCount).map(shown),
        hasMore: sorted.length > newsCount,
        history: historyOf(sorted, now).map((group) => ({ ...group, events: group.events.map(shown) })),
      };
    }
  }
}
