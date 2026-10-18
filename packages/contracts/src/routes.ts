import { z } from 'zod';

import { EntityId, LocalDate, MealKey } from './base.ts';

const none = z.strictObject({});
const newEntry = z.strictObject({
  /** Öffnet direkt das Formular für einen neuen Eintrag. */
  newEntry: z.literal(true).optional(),
});

/**
 * Routenkatalog (Spezifikation 0, Abschnitt 6): je Route das Schema ihrer Parameter.
 * Unbekannte Ziele öffnen `today`.
 */
export const routeParams = {
  today: none,
  log: none,
  'capture.food': z.strictObject({ meal: MealKey.optional(), localDate: LocalDate.optional() }),
  'capture.water': none,
  'capture.sport': newEntry,
  'capture.weight': newEntry,
  momo: z.strictObject({
    view: z.enum(['insel', 'bauen', 'lager', 'projekt', 'ereignisse', 'schrank', 'rollenwahl']).optional(),
    eventId: EntityId.optional(),
  }),
  'challenge.propose': none,
  'challenge.detail': z.strictObject({ challengeId: EntityId }),
  partner: z.strictObject({ focus: z.literal('received_encouragement').optional() }),
  'partner.invite': none,
  'partner.redeem': none,
  'partner.encourage': none,
  'notifications.permission': none,
  settings: z.strictObject({
    /** Ohne `section` die Übersicht. */
    section: z.enum(['goals', 'weekly_plan', 'partner_sharing', 'notifications', 'health', 'account']).optional(),
  }),
  onboarding: none,
  'plan.budget_suggestion': z.strictObject({ suggestionId: EntityId }),
  'plan.goal_reached': none,
} as const;

export type RouteName = keyof typeof routeParams;
export const RouteName = z.enum(Object.keys(routeParams) as [RouteName, ...RouteName[]]);

/** Schema des Ziels einer Route: ihre Parameter plus `type`. Verteilt über Vereinigungen von Routen. */
type Target<N extends RouteName> = N extends RouteName
  ? (typeof routeParams)[N] extends z.ZodObject<infer Shape, infer Config>
    ? z.ZodObject<z.core.util.Extend<Shape, { type: z.ZodLiteral<N> }>, Config>
    : never
  : never;

const routeTargets = Object.fromEntries(
  RouteName.options.map((name) => [name, routeParams[name].extend({ type: z.literal(name) })]),
) as { [N in RouteName]: Target<N> };

/** Ziel einer Navigation: Route im Feld `type`, daneben ihre typisierten Parameter. */
export const RouteTarget = z.discriminatedUnion(
  'type',
  Object.values(routeTargets) as [Target<RouteName>, ...Target<RouteName>[]],
);
export type RouteTarget = z.infer<typeof RouteTarget>;

/** Ziel aus ungeprüfter Quelle (Deep Link, Push-Daten): unbekannte oder ungültige Ziele öffnen `today`. */
export function routeTargetOrToday(value: unknown): RouteTarget {
  const parsed = RouteTarget.safeParse(value);
  return parsed.success ? parsed.data : { type: 'today' };
}

/** Stabile Kennung einer Aktion; aus ihr entsteht in der App der zugängliche Name. */
const ActionId = z
  .string()
  .max(100)
  .regex(/^[a-z][a-z0-9_]*(?:\.[a-z0-9_]+)*$/);

/** Aktion eines Beitrags: Beiträge bestehen nur aus Daten und solchen Navigationsabsichten. */
export const UiActionIntent = z.strictObject({ actionId: ActionId, target: RouteTarget });
export type UiActionIntent = z.infer<typeof UiActionIntent>;

/** Schema einer Aktion, die nur zu den genannten Routen führen darf. */
export function actionTo<const N extends RouteName>(...names: [N, ...N[]]) {
  const targets = names.map((name) => routeTargets[name]) as [Target<N>, ...Target<N>[]];
  return z.strictObject({ actionId: ActionId, target: z.discriminatedUnion('type', targets) });
}
