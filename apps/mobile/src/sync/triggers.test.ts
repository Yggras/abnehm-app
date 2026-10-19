import { startSyncTriggers } from './triggers';

test('Start, Vordergrund, Änderung nach 2 Sekunden, Minute, Refresh und Netzrückkehr mit Outbox', async () => {
  jest.useFakeTimers();
  const sync = jest.fn(async () => {});
  let change!: (pending: string) => void;
  let foreground!: (active: boolean) => void;
  let network!: (online: boolean) => void;
  const stop = startSyncTriggers({ sync, observePending: (listener) => { change = listener; listener(''); return () => {}; },
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
  stop.refresh(); expect(sync).toHaveBeenCalledTimes(5);
  jest.advanceTimersByTime(60_000);
  expect(sync).toHaveBeenCalledTimes(6);
  stop.dispose(); jest.advanceTimersByTime(60_000);
  expect(sync).toHaveBeenCalledTimes(6);
  jest.useRealTimers();
});
