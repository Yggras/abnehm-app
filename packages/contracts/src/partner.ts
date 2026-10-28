import { z } from 'zod';

import { EntityId, Instant, LocalDate, MealKey, ServerVersion, type AreaKey } from './base.ts';
import { addDays, daysBetween, isoWeekdayIndex } from './calendar.ts';
import { uuidV5 } from './ids.ts';
import { mealCategoryCount } from './units.ts';

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

/** Felder jeder Partner-Projektion. */
const projectionBase = {
  id: EntityId,
  ownerPersonId: EntityId,
  recipientPersonId: EntityId,
  couplingId: EntityId,
  /** Datenstand, nie letzte App-Aktivität. */
  dataAsOf: Instant,
  serverVersion: ServerVersion,
};

const ownerIsNotRecipient = (projection: { ownerPersonId: string; recipientPersonId: string }) =>
  projection.ownerPersonId !== projection.recipientPersonId;
const ownerIsNotRecipientRule = {
  message: 'Eigentümer und Empfänger sind verschiedene Personen',
  path: ['recipientPersonId'],
};

const envelopeBase = {
  ...projectionBase,
  /** Steigt mit jeder erneuten Freigabe; gelöschte Fassungen werden nie wiederbelebt. */
  generation: z.int().positive(),
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
      content: z.strictObject({ recordedMealCategories: mealCategoryCount }),
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
  .refine(ownerIsNotRecipient, ownerIsNotRecipientRule);
export type PartnerSummaryEnvelope = z.infer<typeof PartnerSummaryEnvelope>;

type EnvelopeOf<A extends AreaKey> = Extract<PartnerSummaryEnvelope, { type: A }>;
/** Inhalt der Zusammenfassung eines Bereichs, wie ihn sein Projector berechnet. */
export type PartnerSummaryContent<A extends AreaKey = AreaKey> = EnvelopeOf<A>['content'];
export type PartnerSummaryPeriod<A extends AreaKey = AreaKey> = EnvelopeOf<A>['period'];

/**
 * Aktueller Zeitraum der Zusammenfassung eines Bereichs am aktuellen lokalen Tag des Eigentümers:
 * Ernährung und Wasser der Tag, Sport die Woche von Montag bis Sonntag, Gewicht die 14 Tage bis heute.
 */
export function partnerSummaryPeriod<A extends AreaKey>(area: A, today: LocalDate): PartnerSummaryPeriod<A>;
export function partnerSummaryPeriod(area: AreaKey, today: LocalDate): PartnerSummaryPeriod {
  switch (area) {
    case 'ernaehrung':
    case 'wasser':
      return { type: 'tag', localDate: today };
    case 'sport': {
      const monday = addDays(today, -isoWeekdayIndex(today));
      return { type: 'woche', from: LocalDate.parse(monday), to: LocalDate.parse(addDays(monday, 6)) };
    }
    case 'gewicht':
      return { type: 'vierzehn_tage', from: LocalDate.parse(addDays(today, -13)), to: today };
  }
}

/** Erster und letzter Tag eines Zeitraums, wie Datenbanken ihn speichern. */
export function partnerSummaryBounds(period: PartnerSummaryPeriod): Readonly<{ from: LocalDate; to: LocalDate }> {
  return period.type === 'tag' ? { from: period.localDate, to: period.localDate } : { from: period.from, to: period.to };
}

/** Der Zeitraum eines Bereichs aus seinen gespeicherten Grenzen; Gegenstück zu `partnerSummaryBounds`. */
export function partnerSummaryPeriodOf(area: AreaKey, from: LocalDate, to: LocalDate): PartnerSummaryPeriod {
  switch (area) {
    case 'ernaehrung':
    case 'wasser':
      return { type: 'tag', localDate: from };
    case 'sport':
      return { type: 'woche', from, to };
    case 'gewicht':
      return { type: 'vierzehn_tage', from, to };
  }
}

/** Grober Tageszielstand des Partners: 0, 1, 2 oder 3 Tageszielerfüllungen, nie als Zahl. */
export const PartnerDailyGoalStage = z.enum(['noch_nichts', 'unterwegs', 'fast_geschafft', 'geschafft']);
export type PartnerDailyGoalStage = z.infer<typeof PartnerDailyGoalStage>;

/** An die aktive Kopplung gebundene Projektion des groben Tageszielstands; ohne Bereichsfreigabe sichtbar. */
export const PartnerDailyGoalStatus = z
  .strictObject({ ...projectionBase, localDate: LocalDate, stage: PartnerDailyGoalStage })
  .refine(ownerIsNotRecipient, ownerIsNotRecipientRule);
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

const revocationNoticeNamespace = 'a3c1f0e2-5b7d-4e9a-8c6f-1d2e3f4a5b62';

/**
 * ID einer Revocation-Notice aus ihrer Serverversion. Jede Position der Sync-Clock gehört genau einer
 * Zeile, also ist die ID eindeutig; aus demselben Ausgangszustand entsteht dieselbe ID. So kann ein
 * Seed-Manifest den Sollzustand nach einem Widerruf vollständig angeben (#117).
 */
export function revocationNoticeId(serverVersion: ServerVersion): EntityId {
  return EntityId.parse(uuidV5(revocationNoticeNamespace, `revocation_notice:${serverVersion}`));
}

/** Feste Anfeuerungsbotschaften (Spezifikation 5, Abschnitt 4); kein Freitext. */
export const EncouragementKey = z.enum([
  'du_schaffst_das',
  'ich_denk_an_dich',
  'stark_heute',
  'gemeinsam_fuer_momo',
  'stolz_auf_dich',
]);
export type EncouragementKey = z.infer<typeof EncouragementKey>;

/**
 * Kurzlebiger, opaker Verweis auf ein Partnerfoto, höchstens 10 Minuten gültig; ausdrücklich keine
 * Mahlzeitenfoto-ID.
 */
const PartnerPhotoHandle = z
  .string()
  .regex(/^[A-Za-z0-9_-]{16,200}$/)
  .refine((handle) => !EntityId.safeParse(handle.toLowerCase()).success, { message: 'Keine Foto-ID als Handle' });

/**
 * Antwort der Online-Fotoliste „Fotos von heute“ (Spezifikation 0, Abschnitt 5): höchstens 12 Fotos
 * des aktuellen lokalen Tags des Eigentümers, vom Server nach Aufnahmezeit sortiert. Namen, Mengen,
 * Nährwerte, Zeitpunkte und Roh-IDs enthält sie nicht. Sie ist keine Projektion und nie im Pull.
 */
export const PartnerPhotoList = z.strictObject({
  photos: z.array(z.strictObject({ handle: PartnerPhotoHandle, meal: MealKey })).max(12),
  dataAsOf: Instant,
});
export type PartnerPhotoList = z.infer<typeof PartnerPhotoList>;

/** Bildabruf per Handle, als Vorschau oder vergrößert; die Antwort ist das Bild, nicht cachebar. */
export const PartnerPhotoRequest = z.strictObject({
  handle: PartnerPhotoHandle,
  variant: z.enum(['vorschau', 'gross']),
});
export type PartnerPhotoRequest = z.infer<typeof PartnerPhotoRequest>;
