import type { FaultController, FaultPlan } from './faults';
import type { TestLink } from './links';
import type { SeedOutcome, SeedRun } from './seed/seed-flow';

// Eingang der Testfähigkeiten (#112): nimmt Deep Links an, stellt die Fehler-Adapter sofort und reiht
// Seeds ein, bis die App-Shell sie ausführt. Ein Seed läuft nie doppelt; ein neuer Link wartet, bis der
// laufende fertig ist. Der Zustand ist für den Hinweis im Development Build beobachtbar.

export type TestStatus =
  | Readonly<{ type: 'ruhe' }>
  | Readonly<{ type: 'seed_laeuft'; run: SeedRun }>
  | Readonly<{ type: 'seed_fertig'; outcome: Extract<SeedOutcome, { type: 'geseedet' }> }>
  | Readonly<{ type: 'seed_fehlgeschlagen'; step: Extract<SeedOutcome, { type: 'fehlgeschlagen' }>['step'] | 'unerwartet' }>
  | Readonly<{ type: 'fehler_gestellt'; plan: FaultPlan }>
  | Readonly<{ type: 'ungueltig'; capability: 'seed' | 'fehler' }>;

export type SeedHandler = (run: SeedRun) => Promise<SeedOutcome>;

export type TestInbox = {
  receive(link: TestLink): void;
  /** Führt eingereihte und künftige Seeds aus, bis die Rückgabe aufgerufen wird. */
  handleSeeds(handler: SeedHandler): () => void;
  status(): TestStatus;
  subscribe(listener: () => void): () => void;
};

export function createTestInbox(faults: FaultController): TestInbox {
  let current: TestStatus = { type: 'ruhe' };
  const listeners = new Set<() => void>();
  const queue: SeedRun[] = [];
  let handler: SeedHandler | null = null;
  let running = false;

  function setStatus(next: TestStatus) {
    current = next;
    for (const listener of listeners) listener();
  }

  async function drain() {
    const active = handler;
    const run = queue[0];
    if (running || active === null || run === undefined) return;
    queue.shift();
    running = true;
    setStatus({ type: 'seed_laeuft', run });
    try {
      const outcome = await active(run);
      setStatus(outcome.type === 'geseedet' ? { type: 'seed_fertig', outcome } : { type: 'seed_fehlgeschlagen', step: outcome.step });
    } catch {
      setStatus({ type: 'seed_fehlgeschlagen', step: 'unerwartet' });
    } finally {
      running = false;
      void drain();
    }
  }

  return {
    receive(link) {
      if (link.type === 'ungueltig') return setStatus(link);
      if (link.type === 'fehler') {
        if (Object.keys(link.plan).length === 0) faults.reset();
        else faults.set(link.plan);
        return setStatus({ type: 'fehler_gestellt', plan: faults.plan() });
      }
      queue.push({ scenario: link.scenario, installation: link.installation, target: link.target });
      void drain();
    },
    handleSeeds(next) {
      handler = next;
      void drain();
      return () => {
        if (handler === next) handler = null;
      };
    },
    status: () => current,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
