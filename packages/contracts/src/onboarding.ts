import { z } from 'zod';

// Onboarding-Registry (Spezifikation 0, Abschnitt 6): Die Schritte 9–11 sind Steckplätze. Ein
// Schritt-Beitrag meldet nur `complete(outcome)`; Spezifikation 1 nutzt das Ergebnis zum
// Weitergehen und speichert es nicht.

export const OnboardingStepKey = z.enum(['health', 'notifications', 'partner']);
export type OnboardingStepKey = z.infer<typeof OnboardingStepKey>;

const outcome = <const T extends string>(type: T) => z.strictObject({ type: z.literal(type) });

const skipped = outcome('skipped');
const healthConnected = outcome('health_connected');
const healthUnavailable = outcome('health_unavailable');
const notificationsGranted = outcome('notifications_granted');
const notificationsDenied = outcome('notifications_denied');
const partnerCoupled = outcome('partner_coupled');
const partnerInviteCreated = outcome('partner_invite_created');

export const OnboardingStepOutcome = z.discriminatedUnion('type', [
  healthConnected,
  healthUnavailable,
  notificationsGranted,
  notificationsDenied,
  partnerCoupled,
  partnerInviteCreated,
  skipped,
]);
export type OnboardingStepOutcome = z.infer<typeof OnboardingStepOutcome>;

/** Die Ergebnisse, die ein Schritt melden darf; `skipped` gilt für alle. */
export const onboardingStepOutcomes = {
  health: z.discriminatedUnion('type', [healthConnected, healthUnavailable, skipped]),
  notifications: z.discriminatedUnion('type', [notificationsGranted, notificationsDenied, skipped]),
  partner: z.discriminatedUnion('type', [partnerCoupled, partnerInviteCreated, skipped]),
} satisfies Record<OnboardingStepKey, z.ZodType<OnboardingStepOutcome>>;
