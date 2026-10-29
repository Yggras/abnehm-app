import { z } from 'zod';

import { DisplayName, EntityId, Instant, LocalDate, MessageKey, MessageValues, Weekday, weekdayOf } from './base.ts';
import { contributionState } from './contribution.ts';
import { DailyGoalEvaluated, DailyGoalSlot } from './daily-goals.ts';
import { MomoAppearance } from './island.ts';
import { EncouragementKey, PartnerDailyGoalStage } from './partner.ts';
import { MaintenanceReason } from './ports.ts';
import { actionTo, UiActionIntent } from './routes.ts';
import { trackerStatus, trackerStatuses } from './tracker-rules.ts';
import { bodyWeightG } from './units.ts';

// Ready-Payloads der „Heute“-Steckplätze (Spezifikation 0, Abschnitt 6). Die Shell besitzt
// Reihenfolge, Layout und Navigation; Beiträge bestehen nur aus Daten und `UiActionIntent`.

const percent = z.int().min(0).max(100);

export const HeaderReady = z
  .strictObject({
    displayName: DisplayName,
    localDate: LocalDate,
    weekday: Weekday,
    settingsAction: actionTo('settings'),
  })
  .refine((header) => header.weekday === weekdayOf(header.localDate), {
    message: 'Wochentag passt nicht zum Tag',
    path: ['weekday'],
  });
export type HeaderReady = z.infer<typeof HeaderReady>;

export const TopNoticeReady = z.strictObject({
  senderDisplayName: DisplayName,
  /** Neueste feste Anfeuerungsbotschaft des Tags. */
  encouragementKey: EncouragementKey,
  action: actionTo('partner').refine((action) => action.target.focus === 'received_encouragement', {
    message: 'Öffnet „Wir“ mit Fokus auf die erhaltene Anfeuerung',
    path: ['target', 'focus'],
  }),
});
export type TopNoticeReady = z.infer<typeof TopNoticeReady>;

export const MomoCharacterReady = z
  .strictObject({
    appearance: MomoAppearance,
    /** Eigene Energie; ein negativer Mehrgeräte-Zwischenstand erscheint als 0. */
    energy: z.int().nonnegative(),
    level: z.int().positive(),
    ownHalfPercent: percent,
    partnerHalfPercent: percent,
    /** Die eigene Hälfte ist voll, das Level aber noch nicht erreicht. */
    waitingForPartner: z.boolean(),
    islandNotice: z
      .strictObject({ newEvents: z.int().nonnegative(), claimableWishes: z.int().nonnegative() })
      .optional(),
  })
  .refine((character) => !character.waitingForPartner || character.ownHalfPercent === 100, {
    message: 'Warten auf den Partner setzt eine volle eigene Hälfte voraus',
    path: ['waitingForPartner'],
  });
export type MomoCharacterReady = z.infer<typeof MomoCharacterReady>;

/** Leer-Gründe von `momo.character`; sie ersetzen den Momo-Bereich auf „Heute“. */
export const MomoCharacterEmptyReason = z.enum(['momo_wartet_im_ei', 'rollenwahl_offen']);
export type MomoCharacterEmptyReason = z.infer<typeof MomoCharacterEmptyReason>;

/** Ohne Kopplung lädt die Leer-Aktion den Partner ein, vor der Rollenwahl öffnet sie die Rollenwahl. */
export const MomoCharacterState = contributionState(MomoCharacterReady, MomoCharacterEmptyReason).refine(
  (state) =>
    state.type !== 'empty' ||
    (state.reasonKey === 'momo_wartet_im_ei'
      ? state.action?.target.type === 'partner.invite'
      : state.action?.target.type === 'momo' && state.action.target.view === 'rollenwahl'),
  { message: 'Leer-Grund ohne seine Aktion', path: ['action'] },
);

/** View-Model eines Tagesziels auf seinem Platz, mit Aktion zum Bereich. */
const DailyGoalCard = z.strictObject({ slot: DailyGoalSlot, evaluation: DailyGoalEvaluated, action: UiActionIntent });

/** Genau drei Tagesziele, nach Platz geordnet. */
export const MomoDailyGoalsReady = z
  .tuple([DailyGoalCard, DailyGoalCard, DailyGoalCard])
  .refine((cards) => cards.every((card, index) => card.slot === index + 1), {
    message: 'Tagesziele stehen auf den Plätzen 1, 2 und 3',
  });
export type MomoDailyGoalsReady = z.infer<typeof MomoDailyGoalsReady>;

export const NutritionBudgetReady = z.strictObject({
  budgetKcal: z.int().positive(),
  maintenanceReason: MaintenanceReason.nullable(),
  /** Höchstens ein Hinweis; „Zielgewicht erreicht“ geht vor. */
  notice: z
    .discriminatedUnion('type', [
      z
        .strictObject({
          type: z.literal('budget_suggestion'),
          suggestionId: EntityId,
          suggestedBudgetKcal: z.int().positive(),
          action: actionTo('plan.budget_suggestion'),
        })
        .refine((notice) => notice.action.target.suggestionId === notice.suggestionId, {
          message: 'Aktion öffnet einen anderen Vorschlag',
          path: ['action'],
        }),
      z.strictObject({ type: z.literal('goal_weight_reached'), action: actionTo('plan.goal_reached') }),
    ])
    .optional(),
});
export type NutritionBudgetReady = z.infer<typeof NutritionBudgetReady>;

export const NutritionLogReady = z.strictObject({ intakeKcal: z.int().nonnegative(), logAction: actionTo('log') });
export type NutritionLogReady = z.infer<typeof NutritionLogReady>;

/** Fester Katalog der Quick-Commands; V1 kennt nur `water.quick_add` mit 250 ml. */
export const QuickCommandKey = z.enum(['water.quick_add']);
export type QuickCommandKey = z.infer<typeof QuickCommandKey>;

/** Nutzlast von `water.quick_add`: genau ein Glas (Spezifikation 3, Abschnitt 4). */
export const WaterQuickAddParams = z.strictObject({ ml: z.literal(250) });
export type WaterQuickAddParams = z.infer<typeof WaterQuickAddParams>;

const waterQuickAdd = z.strictObject({
  type: z.literal('command'),
  commandKey: z.literal('water.quick_add'),
  params: WaterQuickAddParams,
});

/** Knopf eines Mini-Trackers: Navigation oder lokaler Quick-Command. */
export const TrackerQuickAction = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('navigate'), intent: UiActionIntent }),
  waterQuickAdd,
]);
export type TrackerQuickAction = z.infer<typeof TrackerQuickAction>;

/** Ergebnis eines Quick-Commands für den Meldungs-Host; `undoToken` ist flüchtig und nie synchronisiert. */
export const QuickCommandOutcome = z.strictObject({
  messageKey: MessageKey,
  values: MessageValues,
  undoToken: z.string().min(1).max(200),
});
export type QuickCommandOutcome = z.infer<typeof QuickCommandOutcome>;

const TrackerStatus = z.enum(trackerStatuses);

/**
 * Leer-Grund der Mini-Tracker Wasser und Sport: Es gibt für den Tag keine gültige Zielversion
 * (Spezifikation 3, Abschnitt 7). Nach abgeschlossenem Onboarding sollte das nicht vorkommen.
 */
export const TrackerEmptyReason = z.enum(['ohne_zielversion']);
export type TrackerEmptyReason = z.infer<typeof TrackerEmptyReason>;

/**
 * Wasser-Mini-Tracker: heute gezählte ml und Wasserziel der gültigen Zielversion. Der Status folgt
 * aus beiden (`trackerStatus` der Tracker-Regeln); der Knopf bucht immer `water.quick_add`.
 */
export const TrackerWaterReady = z
  .strictObject({
    key: z.literal('wasser'),
    countedMl: z.int().nonnegative(),
    targetMl: z.int().positive(),
    status: TrackerStatus,
    detailAction: actionTo('capture.water'),
    quickAction: waterQuickAdd,
  })
  .refine((water) => water.status === trackerStatus(water.countedMl, water.targetMl), {
    message: 'Status passt nicht zu gezählten ml und Wasserziel',
    path: ['status'],
  });
export type TrackerWaterReady = z.infer<typeof TrackerWaterReady>;

export const TrackerSportReady = z.strictObject({
  key: z.literal('sport'),
  weekMinutes: z.int().nonnegative(),
  weeklyTargetMinutes: z.int().positive(),
  status: TrackerStatus,
  detailAction: actionTo('capture.sport'),
  quickAction: TrackerQuickAction,
});
export type TrackerSportReady = z.infer<typeof TrackerSportReady>;

/** Knopf des Gewichts-Mini-Trackers: öffnet immer das Formular für einen neuen Eintrag (Spezifikation 3, Abschnitt 4). */
const weightNewEntry = z.strictObject({
  type: z.literal('navigate'),
  intent: actionTo('capture.weight').refine((intent) => intent.target.newEntry === true, {
    message: 'Öffnet das Formular für einen neuen Eintrag',
    path: ['target', 'newEntry'],
  }),
});

/**
 * Gewichts-Mini-Tracker: letztes Tagesgewicht bzw. ab drei Tagesgewichten der Trendwert und der Stand
 * des Wiegetags. Der Status ist immer neutral; der Knopf öffnet das Formular „Eintragen“.
 */
export const TrackerWeightReady = z.strictObject({
  key: z.literal('gewicht'),
  /** Trendwert ab drei Tagesgewichten, sonst das letzte Tagesgewicht; `null` ohne Gewichtseintrag. */
  value: z
    .strictObject({ type: z.enum(['trend', 'tagesgewicht']), weightG: bodyWeightG })
    .nullable(),
  status: z.discriminatedUnion('type', [
    z.strictObject({ type: z.literal('wiegetag_offen') }),
    z.strictObject({ type: z.literal('gewogen') }),
    /** Nächster Wiegetag aus den kommenden sieben Tagen; `null`, wenn der Wochenplan keinen hat. */
    z.strictObject({ type: z.literal('kein_wiegetag'), nextWeighDay: LocalDate.nullable() }),
  ]),
  detailAction: actionTo('capture.weight'),
  quickAction: weightNewEntry,
});
export type TrackerWeightReady = z.infer<typeof TrackerWeightReady>;

/** Partner-Karte: solo mit Einladen/Code eingeben oder gekoppelt ohne Zusammenfassungen. */
export const PartnerCardReady = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('solo'),
    inviteAction: actionTo('partner.invite'),
    redeemAction: actionTo('partner.redeem'),
  }),
  z.strictObject({
    type: z.literal('coupled'),
    partnerDisplayName: DisplayName,
    dailyGoalStage: PartnerDailyGoalStage,
    dataAsOf: Instant,
    encourageAction: actionTo('partner.encourage'),
  }),
]);
export type PartnerCardReady = z.infer<typeof PartnerCardReady>;
