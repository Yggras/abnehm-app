import { z } from 'zod';

import type { Instant } from '@abnehm/contracts/base';

import type { ReadContext, TransactionContext } from '../local-db';
import { readDeviceState, writeDeviceState } from '../local-db/device-state';
import { onboardingFlowSteps, type OnboardingFlowStep } from './steps';

// Der Schritt, an dem das Onboarding auf diesem Gerät steht (Spezifikation 1, Abschnitt 9): Gerätezustand
// der Kontodatenbank (`device_state`), nicht synchronisiert, wie der Entwurf. Gemerkt werden die Schritte
// ab 3; Schritt 1 ergibt sich aus der Person, Schritt 2 gibt es mit Konto nicht mehr. Für die Schritte
// 9–11 ist er der einzige Fortschritt; geht er verloren, beginnt die App wieder bei Schritt 9.

/** Die Schritte, an denen das Onboarding mit Konto fortsetzen kann. */
export type ResumableStep = Exclude<OnboardingFlowStep, 'willkommen' | 'konto'>;

const resumableStepSchema = z.enum(onboardingFlowSteps.filter((step): step is ResumableStep => step !== 'willkommen' && step !== 'konto') as [ResumableStep, ...ResumableStep[]]);

const stepKey = 'onboarding_step';

/** Der gemerkte Schritt; `undefined`, wenn es keinen gibt oder ein gespeicherter nicht mehr passt. */
export function readOnboardingStep(tx: ReadContext): ResumableStep | undefined {
  return resumableStepSchema.safeParse(readDeviceState(tx, stepKey)).data;
}

export function writeOnboardingStep(tx: TransactionContext, step: ResumableStep, at: Instant): void {
  writeDeviceState(tx, stepKey, resumableStepSchema.parse(step), at);
}
