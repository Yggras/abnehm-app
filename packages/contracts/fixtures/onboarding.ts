import { OnboardingStepKey, OnboardingStepOutcome, onboardingStepOutcomes } from '../src/onboarding.ts';
import { fixtures } from './define.ts';

export const onboardingFixtures = {
  OnboardingStepKey: fixtures(OnboardingStepKey, {
    valid: { 'Health': 'health', 'Partner': 'partner' },
    invalid: { 'Schritt 1–8 sind keine Steckplätze': 'welcome' },
  }),
  OnboardingStepOutcome: fixtures(OnboardingStepOutcome, {
    valid: { 'verbunden': { type: 'health_connected' }, 'übersprungen': { type: 'skipped' } },
    invalid: { 'mit Freitext': { type: 'skipped', reason: 'später' }, 'unbekannt': { type: 'done' } },
  }),
  'onboardingStepOutcomes.health': fixtures(onboardingStepOutcomes.health, {
    valid: { 'nicht verfügbar': { type: 'health_unavailable' }, 'übersprungen': { type: 'skipped' } },
    invalid: { 'Ergebnis eines anderen Schritts': { type: 'partner_coupled' } },
  }),
  'onboardingStepOutcomes.notifications': fixtures(onboardingStepOutcomes.notifications, {
    valid: { 'erlaubt': { type: 'notifications_granted' } },
    invalid: { 'Ergebnis eines anderen Schritts': { type: 'health_connected' } },
  }),
  'onboardingStepOutcomes.partner': fixtures(onboardingStepOutcomes.partner, {
    valid: { 'Code erzeugt': { type: 'partner_invite_created' } },
    invalid: { 'Ergebnis eines anderen Schritts': { type: 'notifications_denied' } },
  }),
};
