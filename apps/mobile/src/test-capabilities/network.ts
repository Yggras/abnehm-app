import type { FaultController } from './faults';

// Transport-Fehlermodus (#114): iOS-Ersatz für Maestros `setAirplaneMode`, das nur Android unterstützt
// (https://docs.maestro.dev/api-reference/commands/setairplanemode). `transport=offline` des
// Fehler-Adapters lässt `fetch` wie ohne Netz scheitern; dieser Adapter meldet dem Sync zusätzlich
// den Netzstatus wie der Flugmodus. Die Rückkehr zu `ok` meldet das Netz wieder, und der Sync startet
// wie nach echter Netzrückkehr. Es gibt ihn nur in Test-Artefakten (Development- und E2E-Build), nie
// im Produktions-Bundle (Release-Test, `test/test-capabilities.ts`).

/** Name im Hinweis der Test-Artefakte; der Release-Test sucht ihn im Produktions-Bundle (Marker). */
export const transportFaultModeName = 'Transport-Fehlermodus';

/** Beobachtet, ob das Gerät Internet hat; meldet nur Änderungen. */
export type ObserveNetwork = (listener: (online: boolean) => void) => () => void;

/** Netzstatus des Geräts, überlagert vom Transport-Fehlermodus. */
export function faultyNetwork(device: ObserveNetwork, faults: FaultController): ObserveNetwork {
  return (listener) => {
    // Expo Network meldet nur Änderungen; ohne Meldung gilt das Gerät als verbunden.
    let deviceOnline = true;
    let reported: boolean | null = null;
    const report = () => {
      const online = deviceOnline && faults.plan().transport !== 'offline';
      if (online === reported) return;
      reported = online;
      listener(online);
    };
    const stopDevice = device((online) => {
      deviceOnline = online;
      report();
    });
    const stopFaults = faults.subscribe(() => {
      // Vor der ersten Meldung bleibt ein Plan ohne `offline` still, damit etwa ein Serverfehler keine
      // Netzrückkehr vortäuscht.
      if (reported === null && faults.plan().transport !== 'offline') return;
      report();
    });
    return () => {
      stopDevice();
      stopFaults();
    };
  };
}
