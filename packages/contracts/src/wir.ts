import { z } from 'zod';

import { CatalogKey, DisplayName, EntityId, Instant, MessageKey } from './base.ts';
import { contributionState, type ContributionState } from './contribution.ts';
import { ChallengeStatus, CommonStage, IslandRole } from './island.ts';
import { UiActionIntent } from './routes.ts';

// Beiträge von Spezifikation 4 zum Tab „Wir“ (Spezifikation 0, Abschnitt 2). Spezifikation 5
// ordnet und rendert sie, ohne Tabellen von Spezifikation 4 zu lesen. Kein Beitrag enthält einen
// exakten Partneranteil; strikte Objekte weisen jedes weitere Feld ab.

const base = { id: EntityId, dataAsOf: Instant, action: UiActionIntent.optional() };

/** Eigener Stand und eigener Bedarf; der des Partners erscheint nur als gemeinsame Stufe. */
const ownShare = { ownCount: z.int().nonnegative(), ownRequired: z.int().positive() };

/** Ereignisse für „Neu bei euch“; individuelle Bauten und Tageszielerfüllungen gehören nicht dazu. */
export const SharedEventType = z.enum([
  'momo_geschluepft',
  'levelaufstieg',
  'gebiet',
  'projektabschluss',
  'accessoire',
  'deko_geschenkt',
  'challenge_gestartet',
  'challenge_geschafft',
  'challenge_abgelaufen',
  'challenge_beendet',
]);
export type SharedEventType = z.infer<typeof SharedEventType>;

export const WirContribution = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('challenge'),
    ...base,
    challengeId: EntityId,
    templateKey: CatalogKey,
    status: ChallengeStatus,
    /** Unterscheidet „Vorschlag gesendet“ von einem Vorschlag, auf den die Person antworten muss. */
    proposedBySelf: z.boolean(),
    ...ownShare,
    stage: CommonStage,
    endsAt: Instant.optional(),
  }),
  z.strictObject({
    type: z.literal('community_project'),
    ...base,
    projectId: EntityId,
    templateKey: CatalogKey,
    ownRole: IslandRole,
    ...ownShare,
    stage: CommonStage,
  }),
  z.strictObject({
    type: z.literal('shared_event'),
    ...base,
    eventId: EntityId,
    eventType: SharedEventType,
    occurredAt: Instant,
    messageKey: MessageKey,
    objectId: EntityId,
  }),
  z.strictObject({
    type: z.literal('pending_shared_action'),
    ...base,
    actionId: EntityId,
    /** Entkoppeln ist nie eine Anfrage, auf die der Partner antworten muss. */
    kind: z.enum(['rollenwahl', 'rollentausch', 'deko_schenken']),
    requesterDisplayName: DisplayName,
    expiresAt: Instant.optional(),
  }),
]);
export type WirContribution = z.infer<typeof WirContribution>;

/** Zustand der Beiträge, den die `WirContributionSource` von Spezifikation 4 liefert. */
export const WirContributionsState = contributionState(z.array(WirContribution));

/** Antwortbedürftig sind alle offenen gemeinsamen Aktionen und fremde Challenge-Vorschläge. */
export function needsResponse(contribution: WirContribution): boolean {
  return (
    contribution.type === 'pending_shared_action' ||
    (contribution.type === 'challenge' && contribution.status === 'vorgeschlagen' && !contribution.proposedBySelf)
  );
}

/** Beobachtbare Quelle, die Spezifikation 4 registriert und Spezifikation 5 in „Wir“ komponiert. */
export interface WirContributionSource {
  /** Meldet den aktuellen und jeden weiteren Zustand; liefert die Abmeldung. */
  subscribe(listener: (state: ContributionState<WirContribution[]>) => void): () => void;
}
