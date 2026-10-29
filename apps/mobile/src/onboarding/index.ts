// Onboarding-Modul (Spezifikation 1, Abschnitte 1 und 9). Der Composition Root erzeugt es einmal je
// Gerät und meldet ihm jede geöffnete Kontodatenbank; die Routen `sitzung` und `onboarding` zeigen seine
// Bildschirme.

export { createOnboarding, type AccountSetupResult, type Onboarding, type OnboardingAuth, type OnboardingProgress } from './onboarding';
export type { OnboardingDraft, OnboardingDraftChange } from './draft';
export { OnboardingProvider, useOnboarding, useOnboardingProgress } from './OnboardingContext';
export { OnboardingFrame, type OnboardingFrameProps } from './OnboardingFrame';
export type { OnboardingFlowStep } from './steps';
export { AccountSetup } from './AccountSetup';
export { FirstStart } from './FirstStart';
export { OnboardingFlow } from './OnboardingFlow';
