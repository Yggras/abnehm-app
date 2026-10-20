import type { ClockReading } from '@abnehm/clock';

import type { AppTestClock } from './clock';
import type { DeviceSuitePhase, DeviceSuiteReport } from './device-suite/suite';
import type { FaultController, FaultPlan } from './faults';
import type { TestLink, TestLinkPath } from './links';
import type { SeedOutcome, SeedRun } from './seed/seed-flow';

// Eingang der Testfähigkeiten (#112, #114): nimmt Deep Links an, stellt Fehler-Adapter und Testuhr
// sofort und reiht Seeds ein, bis die App-Shell sie ausführt. Ein Seed läuft nie doppelt; ein neuer
// Link wartet, bis der laufende fertig ist. Phasen der On-Device-Suite laufen ebenso nacheinander. Der
// Zustand ist für den Hinweis in Test-Artefakten beobachtbar; Maestro liest ihn dort ab.

export type TestStatus =
  | Readonly<{ type: 'ruhe' }>
  | Readonly<{ type: 'seed_laeuft'; run: SeedRun }>
  | Readonly<{ type: 'seed_fertig'; outcome: Extract<SeedOutcome, { type: 'geseedet' }> }>
  | Readonly<{ type: 'seed_fehlgeschlagen'; step: Extract<SeedOutcome, { type: 'fehlgeschlagen' }>['step'] | 'unerwartet' }>
  | Readonly<{ type: 'fehler_gestellt'; plan: FaultPlan }>
  | Readonly<{ type: 'uhr_gestellt'; reading: ClockReading }>
  | Readonly<{ type: 'geraetetest_laeuft'; phase: DeviceSuitePhase }>
  | Readonly<{ type: 'geraetetest_fertig'; report: DeviceSuiteReport }>
  | Readonly<{ type: 'ungueltig'; capability: TestLinkPath }>;

export type SeedHandler = (run: SeedRun) => Promise<SeedOutcome>;

export type TestInboxOptions = {
  faults: FaultController;
  clock: AppTestClock;
  /** Führt eine Phase der On-Device-Suite auf den Dateien des Geräts aus. */
  deviceSuite(phase: DeviceSuitePhase): Promise<DeviceSuiteReport>;
};

export type TestInbox = {
  receive(link: TestLink): void;
  /** Führt eingereihte und künftige Seeds aus, bis die Rückgabe aufgerufen wird. */
  handleSeeds(handler: SeedHandler): () => void;
  status(): TestStatus;
  subscribe(listener: () => void): () => void;
};

export function createTestInbox({ faults, clock, deviceSuite }: TestInboxOptions): TestInbox {
  let current: TestStatus = { type: 'ruhe' };
  const listeners = new Set<() => void>();
  const queue: SeedRun[] = [];
  let handler: SeedHandler | null = null;
  let running = false;
  let suiteRuns: Promise<void> = Promise.resolve();

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

  function runSuite(phase: DeviceSuitePhase) {
    suiteRuns = suiteRuns.then(async () => {
      setStatus({ type: 'geraetetest_laeuft', phase });
      const report = await deviceSuite(phase).catch(
        (error: unknown): DeviceSuiteReport => ({ phase, results: [{ key: 'suite', title: 'On-Device-Suite', error: String(error) }] }),
      );
      setStatus({ type: 'geraetetest_fertig', report });
    });
  }

  return {
    receive(link) {
      switch (link.type) {
        case 'ungueltig':
          return setStatus(link);
        case 'fehler':
          if (Object.keys(link.plan).length === 0) faults.reset();
          else faults.set(link.plan);
          return setStatus({ type: 'fehler_gestellt', plan: faults.plan() });
        case 'uhr':
          clock.adjust(link.adjustment);
          return setStatus({ type: 'uhr_gestellt', reading: clock.read() });
        case 'geraetetest':
          return runSuite(link.phase);
        case 'seed':
          queue.push({ scenario: link.scenario, installation: link.installation, target: link.target });
          void drain();
      }
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
