import { readingOf, type Clock } from '@abnehm/clock';
import { Instant } from '@abnehm/contracts/base';

// Steuerbare Serveruhr des Development-Backends (#271): die Systemuhr, um eine Verschiebung gestellt.
// Seed-Route und Seed-Kommando stellen sie auf die Uhr des Manifests, `POST /dev/uhr` auf einen
// Zeitpunkt, den die App mit jeder Änderung ihrer Testuhr schickt. Sie läuft danach mit der Systemuhr
// weiter, damit Zeitfenster der Begrenzungen und Jobintervalle wie in Produktion vergehen.
//
// Nur im Development-Image: Das Produktions-Image kopiert `apps/backend/dev/` nicht, und das Uhr-Paket
// bleibt ohne steuerbare Uhr. Die Verschiebung braucht nur dessen öffentliches `readingOf`.

export type ServerClock = Clock & {
  /** Stellt die Uhr auf den Zeitpunkt; jedes Stellen gilt absolut, auch rückwärts. */
  set(instant: Instant): void;
};

export function createServerClock(system: Clock): ServerClock {
  let offsetMilliseconds = 0;
  return {
    read(timeZone) {
      const base = system.read(timeZone);
      if (offsetMilliseconds === 0) return base;
      const shifted = Instant.parse(new Date(Date.parse(base.instant) + offsetMilliseconds).toISOString());
      return readingOf(shifted, base.timeZone);
    },
    set(instant) {
      offsetMilliseconds = Date.parse(Instant.parse(instant)) - Date.parse(system.read().instant);
    },
  };
}
