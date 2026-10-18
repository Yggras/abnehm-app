import type { z } from 'zod';

import { IslandProgress } from '@abnehm/contracts/island';
import { PartnerDailyGoalStatus, PartnerPhotoList, PartnerSummaryEnvelope, RevocationNotice } from '@abnehm/contracts/partner';

// Serialisierte Partnerantworten (Spezifikation 0, Abschnitt 11): Was eine Person über ihren Partner
// erhält, läuft vor dem Senden durch das geschlossene Zod-Schema aus dem Vertragsmodul. Diese Schemas
// sind die einzige Positivliste; strikte Objekte schließen Rohdatensatz-IDs, fremde Zielwerte außer
// `weeklyTargetMinutes` und absolute Gewichtswerte aus. Einen zweiten Feldkatalog gibt es nicht.

const partnerResponseSchemas = {
  partner_summary: PartnerSummaryEnvelope,
  partner_daily_goal_status: PartnerDailyGoalStatus,
  revocation_notice: RevocationNotice,
  partner_photo_list: PartnerPhotoList,
  island_progress: IslandProgress,
} as const;

export type PartnerResponseKind = keyof typeof partnerResponseSchemas;

/** Eine Partnerantwort verletzt ihr Schema; sie wird nie gesendet. Der Fehler nennt keine Daten. */
export class PartnerResponseRejected extends Error {
  readonly kind: PartnerResponseKind;

  constructor(kind: PartnerResponseKind) {
    super(`Partnerantwort ${kind} verletzt ihr Vertragsschema`);
    this.name = 'PartnerResponseRejected';
    this.kind = kind;
  }
}

/** Die geprüfte Partnerantwort; wirft `PartnerResponseRejected` statt etwas Unbekanntes zu senden. */
export function partnerResponse<K extends PartnerResponseKind>(kind: K, value: unknown): z.output<(typeof partnerResponseSchemas)[K]> {
  const result = partnerResponseSchemas[kind].safeParse(value);
  if (!result.success) throw new PartnerResponseRejected(kind);
  return result.data as z.output<(typeof partnerResponseSchemas)[K]>;
}
