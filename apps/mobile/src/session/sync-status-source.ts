import type { SyncStatus } from '../sync';

let current: SyncStatus = { type: 'secured' };
const listeners = new Set<() => void>();

export const syncStatusSource = {
  getSnapshot: () => current,
  subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  publish(status: SyncStatus) {
    if (JSON.stringify(current) === JSON.stringify(status)) return;
    current = status;
    for (const listener of listeners) listener();
  },
};
