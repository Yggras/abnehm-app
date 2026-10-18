import { z } from 'zod';

import { EntityId, Instant, LocalDate, ServerVersion } from './base.ts';
import { addDays, daysBetween, isoWeekdayIndex } from './calendar.ts';

// Partner-Projektionen (Spezifikation 0, Abschnitt 5): serverseitig erzeugte, widerrufbare Lesemodelle
// in bewusst datensparsamer Form. Strikte Objekte schließen jeden weiteren Wert aus, etwa
// Rohdatensatz-IDs, einzelne Einträge oder ein absolutes Gewicht.

const DayPeriod = z.strictObject({ type: z.literal('tag'), localDate: LocalDate });

/** Lokale Woche Montag bis Sonntag in der Zeitzone des Eigentümers. */
const WeekPeriod = z
  .strictObject({ type: z.literal('woche'), from: LocalDate, to: LocalDate })
  .refine((period) => isoWeekdayIndex(period.from) === 0 && period.to === addDays(period.from, 6), {
    message: 'Woche läuft von Montag bis Sonntag',
  });

/** 14 lokale Tage bis einschließlich `to` (dem aktuellen Tag D). */
const FourteenDayPeriod = z
  .strictObject({ type: z.literal('vierzehn_tage'), from: LocalDate, to: LocalDate })
  .refine((period) => daysBetween(period.from, period.to) === 13, { message: 'Zeitraum umfasst 14 Tage' });

const envelopeBase = {
  id: EntityId,
  /** Steigt mit jeder erneuten Freigabe; gelöschte Fassungen werden nie wiederbelebt. */
  generation: z.int().positive(),
  ownerPersonId: EntityId,
  recipientPersonId: EntityId,
  couplingId: EntityId,
  /** Datenstand, nie letzte App-Aktivität. */
  dataAsOf: Instant,
  serverVersion: ServerVersion,
};

/** Gewichtsveränderung über 14 Tage: eine Nachkommastelle, Richtung nach Rundung. */
const WeightChange = z
  .strictObject({
    changeKg: z.number().multipleOf(0.1).nullable(),
    direction: z.enum(['sinkend', 'stabil', 'steigend', 'noch_nicht_verfuegbar']),
  })
  .refine(
    ({ changeKg, direction }) =>
      changeKg === null
        ? direction === 'noch_nicht_verfuegbar'
        : direction === (changeKg < 0 ? 'sinkend' : changeKg > 0 ? 'steigend' : 'stabil'),
    { message: 'Richtung passt nicht zur Veränderung', path: ['direction'] },
  );

/** Partner-Zusammenfassung eines Bereichs (Feld `type`) für genau einen Empfänger. */
export const PartnerSummaryEnvelope = z
  .discriminatedUnion('type', [
    z.strictObject({
      type: z.literal('ernaehrung'),
      ...envelopeBase,
      period: DayPeriod,
      /** Verschiedene Mahlzeiten mit mindestens einem nicht gelöschten Eintrag. */
      content: z.strictObject({ recordedMealCategories: z.int().min(0).max(4) }),
    }),
    z.strictObject({
      type: z.literal('wasser'),
      ...envelopeBase,
      period: DayPeriod,
      /** `round(100 × gezählte ml ÷ Wasserziel)`, bei 100 gedeckelt. */
      content: z.strictObject({ progressPercent: z.int().min(0).max(100) }),
    }),
    z.strictObject({
      type: z.literal('sport'),
      ...envelopeBase,
      period: WeekPeriod,
      content: z.strictObject({ countedMinutes: z.int().nonnegative(), weeklyTargetMinutes: z.int().positive() }),
    }),
    z.strictObject({ type: z.literal('gewicht'), ...envelopeBase, period: FourteenDayPeriod, content: WeightChange }),
  ])
  .refine((envelope) => envelope.ownerPersonId !== envelope.recipientPersonId, {
    message: 'Eigentümer und Empfänger sind verschiedene Personen',
    path: ['recipientPersonId'],
  });
export type PartnerSummaryEnvelope = z.infer<typeof PartnerSummaryEnvelope>;

/** Grober Tageszielstand des Partners: 0, 1, 2 oder 3 Tageszielerfüllungen, nie als Zahl. */
export const PartnerDailyGoalStage = z.enum(['noch_nichts', 'unterwegs', 'fast_geschafft', 'geschafft']);
export type PartnerDailyGoalStage = z.infer<typeof PartnerDailyGoalStage>;

/** An die aktive Kopplung gebundene Projektion des groben Tageszielstands; ohne Bereichsfreigabe sichtbar. */
export const PartnerDailyGoalStatus = z
  .strictObject({
    id: EntityId,
    ownerPersonId: EntityId,
    recipientPersonId: EntityId,
    couplingId: EntityId,
    localDate: LocalDate,
    dataAsOf: Instant,
    stage: PartnerDailyGoalStage,
    serverVersion: ServerVersion,
  })
  .refine((status) => status.ownerPersonId !== status.recipientPersonId, {
    message: 'Eigentümer und Empfänger sind verschiedene Personen',
    path: ['recipientPersonId'],
  });
export type PartnerDailyGoalStatus = z.infer<typeof PartnerDailyGoalStatus>;

/**
 * Inhaltsfreie Anweisung an einen früheren Empfänger, einen Partnercache zu löschen. Freigabeentzug
 * betrifft nur Zusammenfassungen; der Tageszielstand endet ausschließlich mit der Kopplung.
 */
export const RevocationNotice = z
  .strictObject({
    id: EntityId,
    recipientPersonId: EntityId,
    couplingId: EntityId,
    target: z.discriminatedUnion('type', [
      z.strictObject({ type: z.literal('partner_summary'), projectionId: EntityId }),
      z.strictObject({ type: z.literal('partner_daily_goal_status'), projectionId: EntityId }),
      z.strictObject({ type: z.literal('kopplung') }),
    ]),
    reason: z.enum(['freigabe_entzogen', 'entkopplung']),
    serverVersion: ServerVersion,
  })
  .refine((notice) => notice.reason === 'entkopplung' || notice.target.type === 'partner_summary', {
    message: 'Ein Freigabeentzug betrifft nur Zusammenfassungen',
    path: ['target'],
  });
export type RevocationNotice = z.infer<typeof RevocationNotice>;

/** Feste Anfeuerungsbotschaften (Spezifikation 5, Abschnitt 4); kein Freitext. */
export const EncouragementKey = z.enum([
  'du_schaffst_das',
  'ich_denk_an_dich',
  'stark_heute',
  'gemeinsam_fuer_momo',
  'stolz_auf_dich',
]);
export type EncouragementKey = z.infer<typeof EncouragementKey>;
