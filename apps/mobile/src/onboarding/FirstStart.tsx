import { useState } from 'react';

import type { Instant } from '@abnehm/contracts/base';

import { useClock } from '../clock/clock-context';
import { AccountStep, type AccountMode } from './AccountStep';
import { WelcomeStep } from './WelcomeStep';

/**
 * Erster Start ohne Sitzung (Zustand `ohne_sitzung` der Sitzungs-Weiche, Route `sitzung`): Schritt 1
 * „Willkommen“ und Schritt 2 „Konto“. Es gibt noch keine Kontodatenbank; die Bestätigung aus Schritt 1
 * reist deshalb mit Registrieren bzw. Anmelden zur Person des Kontos. „Zurück“ behält Bestätigung und Modus.
 */
export function FirstStart() {
  const clock = useClock();
  const [confirmed, setConfirmed] = useState(false);
  const [acceptedAt, setAcceptedAt] = useState<Instant | null>(null);
  const [mode, setMode] = useState<AccountMode>('registrieren');

  if (acceptedAt === null) {
    return (
      <WelcomeStep
        confirmed={confirmed}
        onConfirmedChange={setConfirmed}
        onNext={() => setAcceptedAt(clock.read().instant)}
      />
    );
  }
  return <AccountStep mode={mode} onModeChange={setMode} onBack={() => setAcceptedAt(null)} disclaimerAcceptedAt={acceptedAt} />;
}
