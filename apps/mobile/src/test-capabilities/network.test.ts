import { startSyncTriggers } from '../sync/triggers';
import { createFaultController } from './faults';
import { faultyNetwork, type ObserveNetwork } from './network';

// Nachweis für #114: Der Transport-Fehlermodus ersetzt auf iOS Maestros `setAirplaneMode`. `offline`
// meldet dem Sync wie der Flugmodus kein Netz, die Rückkehr zu `ok` meldet das Netz wieder; der Sync
// startet dann wie nach echter Netzrückkehr.

function deviceNetwork() {
  const listeners = new Set<(online: boolean) => void>();
  const observe: ObserveNetwork = (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  return { observe, report: (online: boolean) => listeners.forEach((listener) => listener(online)), listeners };
}

describe('Transport-Fehlermodus', () => {
  it('meldet offline beim Umschalten und das Netz bei der Rückkehr zu ok', () => {
    const faults = createFaultController();
    const device = deviceNetwork();
    const seen: boolean[] = [];
    const stop = faultyNetwork(device.observe, faults)((online) => seen.push(online));

    faults.set({ transport: 'offline' });
    faults.set({ server: 'unavailable' });
    faults.reset();
    expect(seen).toEqual([false, true]);

    stop();
    faults.set({ transport: 'offline' });
    expect(seen).toEqual([false, true]);
    expect(device.listeners.size).toBe(0);
  });

  it('reicht den Gerätestatus durch und hält ihn während offline zurück', () => {
    const faults = createFaultController();
    const device = deviceNetwork();
    const seen: boolean[] = [];
    faultyNetwork(device.observe, faults)((online) => seen.push(online));

    device.report(true);
    faults.set({ transport: 'offline' });
    device.report(true);
    device.report(false);
    // Ohne Gerätenetz bringt auch das Ende des Fehlermodus kein Netz zurück.
    faults.set({ transport: 'ok' });
    device.report(true);
    expect(seen).toEqual([true, false, true]);
  });

  it('löst nach der Rückkehr genau einen Sync mit offener Outbox aus', () => {
    jest.useFakeTimers();
    try {
      const faults = createFaultController();
      const sync = jest.fn(() => Promise.resolve());
      let pendingListener: (signature: string) => void = () => {};
      const triggers = startSyncTriggers({
        initialActive: true,
        sync,
        observePending: (listener) => {
          pendingListener = listener;
          listener('');
          return () => {};
        },
        observeForeground: () => () => {},
        observeNetwork: faultyNetwork(deviceNetwork().observe, faults),
      });
      expect(sync).toHaveBeenCalledTimes(1); // App-Start

      faults.set({ transport: 'offline' });
      pendingListener('op-1');
      jest.advanceTimersByTime(2_000);
      expect(sync).toHaveBeenCalledTimes(2); // 2 s nach der lokalen Änderung, scheitert offline

      faults.reset();
      expect(sync).toHaveBeenCalledTimes(3); // Netzrückkehr mit gefüllter Outbox
      triggers.dispose();
    } finally {
      jest.useRealTimers();
    }
  });
});
