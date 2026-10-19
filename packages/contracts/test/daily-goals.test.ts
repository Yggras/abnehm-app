import { describe, expect, it } from 'vitest';

import { LocalDate } from '../src/base.ts';
import { planChangeDays } from '../src/daily-goals.ts';

// Nachweis für #105: Plan-Änderungen melden die Tage von max(valid_from, heute) bis heute + 13
// (Spezifikation 0, Abschnitt 3).

const day = (value: string) => LocalDate.parse(value);

describe('planChangeDays', () => {
  it('ab heute, wenn die Fassung schon gilt: 14 Tage bis heute + 13, auch über den Monatswechsel', () => {
    expect(planChangeDays(day('2026-09-01'), day('2026-10-25'))).toEqual([
      '2026-10-25', '2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31',
      '2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07',
    ]);
  });

  it('ab `valid_from`, wenn die Fassung erst künftig gilt', () => {
    expect(planChangeDays(day('2026-10-25'), day('2026-10-14'))).toEqual(['2026-10-25', '2026-10-26', '2026-10-27']);
    expect(planChangeDays(day('2026-10-27'), day('2026-10-14'))).toEqual(['2026-10-27']);
  });

  it('nichts, wenn die Fassung erst nach heute + 13 gilt', () => {
    expect(planChangeDays(day('2026-10-28'), day('2026-10-14'))).toEqual([]);
  });
});
