import { Instant, TimeZone } from '@abnehm/contracts/base';

import type { Clock, ClockReading } from './clock.ts';

/**
 * Steuert einen Uhr-Adapter für das Konformitäts-Testkit. Der Adapter startet
 * auf `start`; der Test stellt Zeitpunkt und eigene Zone danach über diese Hülle.
 */
export type ClockHarness = {
  clock: Clock;
  setInstant(instant: Instant): void;
  setTimeZone(timeZone: TimeZone): void;
};

export type ClockHarnessFactory = (start: { instant: Instant; timeZone: TimeZone }) => ClockHarness;

export type ClockConformanceCase = { name: string; run(): void };

/**
 * Gemeinsames Konformitäts-Testkit für alle Uhr-Adapter (Produktion und Test).
 * Es hängt von keinem Testrunner ab: Jeder Fall wirft bei Abweichung einen Fehler,
 * Jest und Vitest registrieren die Fälle mit `it(name, run)`.
 */
export function clockConformanceCases(createHarness: ClockHarnessFactory): ClockConformanceCase[] {
  const start = (instant: string, timeZone: string) =>
    createHarness({ instant: Instant.parse(instant), timeZone: TimeZone.parse(timeZone) });

  /** Stellt nacheinander jeden Zeitpunkt ein und prüft den lokalen Tag in der eigenen Zone. */
  const expectDays = (timeZone: string, expectations: ReadonlyArray<readonly [instant: string, localDate: string]>) => {
    const [first, ...rest] = expectations;
    if (first === undefined) throw new Error('Mindestens ein Zeitpunkt nötig');
    const harness = start(first[0], timeZone);
    expectReading(harness.clock.read(), { instant: first[0], timeZone, localDate: first[1] });
    for (const [instant, localDate] of rest) {
      harness.setInstant(Instant.parse(instant));
      expectReading(harness.clock.read(), { instant, timeZone, localDate });
    }
  };

  return [
    {
      name: 'liest Zeitpunkt, Zone und lokalen Tag in einem Schritt',
      run: () => {
        const reading = start('2026-10-14T12:00:00.000Z', 'Europe/Berlin').clock.read();
        expectReading(reading, {
          instant: '2026-10-14T12:00:00.000Z',
          timeZone: 'Europe/Berlin',
          localDate: '2026-10-14',
        });
        check(Instant.safeParse(reading.instant).success, `Kein gültiger Instant: ${reading.instant}`);
      },
    },
    {
      name: 'wechselt den Tag genau um lokale Mitternacht',
      run: () =>
        expectDays('Europe/Berlin', [
          ['2026-10-14T21:59:59.999Z', '2026-10-14'],
          ['2026-10-14T22:00:00.000Z', '2026-10-15'],
        ]),
    },
    {
      name: 'richtet den Tag nach der Zone, nicht nach UTC',
      run: () =>
        expectDays('America/New_York', [
          ['2026-10-15T03:59:59.999Z', '2026-10-14'],
          ['2026-10-15T04:00:00.000Z', '2026-10-15'],
        ]),
    },
    {
      name: 'Sommerzeitbeginn: Der Tag hat 23 Stunden',
      run: () =>
        expectDays('Europe/Berlin', [
          ['2026-03-28T22:59:59.999Z', '2026-03-28'],
          ['2026-03-28T23:00:00.000Z', '2026-03-29'],
          ['2026-03-29T01:00:00.000Z', '2026-03-29'],
          ['2026-03-29T21:59:59.999Z', '2026-03-29'],
          ['2026-03-29T22:00:00.000Z', '2026-03-30'],
        ]),
    },
    {
      name: 'Sommerzeitende: Der Tag hat 25 Stunden, die doppelte Stunde bleibt am selben Tag',
      run: () =>
        expectDays('Europe/Berlin', [
          ['2026-10-24T21:59:59.999Z', '2026-10-24'],
          ['2026-10-24T22:00:00.000Z', '2026-10-25'],
          ['2026-10-25T00:30:00.000Z', '2026-10-25'],
          ['2026-10-25T01:30:00.000Z', '2026-10-25'],
          ['2026-10-25T22:59:59.999Z', '2026-10-25'],
          ['2026-10-25T23:00:00.000Z', '2026-10-26'],
        ]),
    },
    {
      name: 'Sommerzeit auf der Südhalbkugel',
      run: () =>
        expectDays('Australia/Sydney', [
          ['2026-10-03T13:59:59.999Z', '2026-10-03'],
          ['2026-10-03T14:00:00.000Z', '2026-10-04'],
          ['2026-10-04T12:59:59.999Z', '2026-10-04'],
          ['2026-10-04T13:00:00.000Z', '2026-10-05'],
        ]),
    },
    {
      name: 'der Tag beginnt auch, wenn Mitternacht durch die Umstellung ausfällt',
      run: () =>
        expectDays('America/Santiago', [
          ['2026-09-06T03:59:59.999Z', '2026-09-05'],
          ['2026-09-06T04:00:00.000Z', '2026-09-06'],
        ]),
    },
    {
      name: 'Zone mit halbstündigem Versatz',
      run: () =>
        expectDays('Asia/Kolkata', [
          ['2026-10-14T18:29:59.999Z', '2026-10-14'],
          ['2026-10-14T18:30:00.000Z', '2026-10-15'],
        ]),
    },
    {
      name: 'Jahreswechsel und Schalttag',
      run: () => {
        expectDays('Europe/Berlin', [
          ['2026-12-31T22:59:59.999Z', '2026-12-31'],
          ['2026-12-31T23:00:00.000Z', '2027-01-01'],
        ]);
        expectDays('Europe/Berlin', [
          ['2028-02-28T23:00:00.000Z', '2028-02-29'],
          ['2028-02-29T23:00:00.000Z', '2028-03-01'],
        ]);
      },
    },
    {
      name: 'Reise: Ein Zonenwechsel wirkt sofort, der Zeitpunkt bleibt',
      run: () => {
        const harness = start('2026-10-14T23:30:00.000Z', 'Europe/Berlin');
        expectReading(harness.clock.read(), {
          instant: '2026-10-14T23:30:00.000Z',
          timeZone: 'Europe/Berlin',
          localDate: '2026-10-15',
        });
        harness.setTimeZone(TimeZone.parse('America/New_York'));
        expectReading(harness.clock.read(), {
          instant: '2026-10-14T23:30:00.000Z',
          timeZone: 'America/New_York',
          localDate: '2026-10-14',
        });
      },
    },
    {
      name: 'liest auf Wunsch in einer anderen Zone, ohne die eigene zu ändern',
      run: () => {
        const harness = start('2026-10-14T10:00:00.000Z', 'Europe/Berlin');
        expectReading(harness.clock.read(TimeZone.parse('Pacific/Kiritimati')), {
          instant: '2026-10-14T10:00:00.000Z',
          timeZone: 'Pacific/Kiritimati',
          localDate: '2026-10-15',
        });
        expectReading(harness.clock.read(TimeZone.parse('Pacific/Pago_Pago')), {
          instant: '2026-10-14T10:00:00.000Z',
          timeZone: 'Pacific/Pago_Pago',
          localDate: '2026-10-13',
        });
        expectReading(harness.clock.read(), {
          instant: '2026-10-14T10:00:00.000Z',
          timeZone: 'Europe/Berlin',
          localDate: '2026-10-14',
        });
      },
    },
    {
      name: 'lehnt eine ungültige Zone beim Ablesen ab',
      run: () => {
        const harness = start('2026-10-14T12:00:00.000Z', 'Europe/Berlin');
        check(throws(() => harness.clock.read('Mars/Olympus_Mons' as TimeZone)), 'Ungültige Zone wurde angenommen');
      },
    },
  ];
}

function expectReading(actual: ClockReading, expected: { instant: string; timeZone: string; localDate: string }) {
  const same =
    actual.instant === expected.instant &&
    actual.timeZone === expected.timeZone &&
    actual.localDate === expected.localDate;
  check(same, `Erwartet ${JSON.stringify(expected)}, gelesen ${JSON.stringify(actual)}`);
}

function check(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function throws(action: () => unknown): boolean {
  try {
    action();
    return false;
  } catch {
    return true;
  }
}
