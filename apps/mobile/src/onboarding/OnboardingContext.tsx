import { createContext, use, useSyncExternalStore, type ReactNode } from 'react';

import type { Onboarding, OnboardingProgress } from './onboarding';

// Das Onboarding-Modul des Geräts für die Bildschirme von `sitzung` und `onboarding`. Der Composition
// Root reicht es im Wurzel-Layout herein, Tests ein eigenes über echten Kontodatenbanken.

const Context = createContext<Onboarding | null>(null);

export function OnboardingProvider({ onboarding, children }: { onboarding: Onboarding; children: ReactNode }) {
  return <Context value={onboarding}>{children}</Context>;
}

export function useOnboarding(): Onboarding {
  const onboarding = use(Context);
  if (onboarding === null) throw new Error('Das Onboarding braucht den OnboardingProvider');
  return onboarding;
}

/** Stand der eigenen Person; folgt der geöffneten Kontodatenbank. */
export function useOnboardingProgress(): OnboardingProgress {
  const onboarding = useOnboarding();
  return useSyncExternalStore(onboarding.subscribe, onboarding.progress);
}
