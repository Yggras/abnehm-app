import { startSyncTriggers } from './triggers';

test('Start, Vordergrund, Änderung nach 2 Sekunden, Minute, Refresh und Netzrückkehr mit Outbox', async () => {
  jest.useFakeTimers();
  const sync = jest.fn(async () => {});
  let change!: (pending: string) => void;
  let foreground!: (active: boolean) => void;
  let network!: (online: boolean) => void;
  const stop = startSyncTriggers({ initialActive: true, sync, observePending: (listener) => { change = listener; listener(''); return () => {}; },
    observeForeground: (listener) => { foreground = listener; return () => {}; },
    observeNetwork: (listener) => { network = listener; return () => {}; } });
  expect(sync).toHaveBeenCalledTimes(1);
  change('op-1'); jest.advanceTimersByTime(1999);
  expect(sync).toHaveBeenCalledTimes(1);
  jest.advanceTimersByTime(1);
  expect(sync).toHaveBeenCalledTimes(2);
  foreground(false); jest.advanceTimersByTime(60_000);
  expect(sync).toHaveBeenCalledTimes(2);
  foreground(true);
  expect(sync).toHaveBeenCalledTimes(3);
  network(false); network(true);
  expect(sync).toHaveBeenCalledTimes(4);
  jest.advanceTimersByTime(60_000);
  expect(sync).toHaveBeenCalledTimes(5);
  stop.dispose(); jest.advanceTimersByTime(60_000);
  expect(sync).toHaveBeenCalledTimes(5);
  jest.useRealTimers();
});

test('eine erste positive Netzmeldung synchronisiert bei gefüllter Outbox auch ohne vorherige Offline-Meldung', () => {
  jest.useFakeTimers();
  const sync = jest.fn(async () => {});
  let network!: (online: boolean) => void;
  const stop = startSyncTriggers({ initialActive: true, sync,
    observePending: (listener) => { listener('op-1'); return () => {}; },
    observeForeground: () => () => {}, observeNetwork: (listener) => { network = listener; return () => {}; } });
  network(true);
  expect(sync).toHaveBeenCalledTimes(2);
  network(true);
  expect(sync).toHaveBeenCalledTimes(2);
  stop.dispose(); jest.useRealTimers();
});

test('ein im Hintergrund geöffnetes Konto startet weder Push noch Pull und bleibt ohne Minutentakt', () => {
  jest.useFakeTimers();
  const sync = jest.fn(async () => {});
  let foreground!: (active: boolean) => void;
  const stop = startSyncTriggers({ initialActive: false, sync, observePending: (listener) => { listener('op-1'); return () => {}; },
    observeForeground: (listener) => { foreground = listener; return () => {}; },
    observeNetwork: () => () => {} });
  jest.advanceTimersByTime(120_000);
  expect(sync).not.toHaveBeenCalled();
  foreground(true);
  expect(sync).toHaveBeenCalledTimes(1);
  stop.dispose(); jest.useRealTimers();
});
