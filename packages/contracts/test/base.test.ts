import { describe, expect, it } from 'vitest';

import { Instant, LocalDate, TimeZone } from '../src/base.ts';

describe('Instant', () => {
  it.each(['2026-10-14T12:00:00.000Z', '2026-10-14T12:00:00Z', '2026-10-14T12:00:00.123456Z'])(
    'akzeptiert UTC-ISO-8601 %s',
    (value) => {
      expect(Instant.safeParse(value).success).toBe(true);
    },
  );

  it.each(['2026-10-14T14:00:00+02:00', '2026-10-14 12:00:00Z', '2026-10-14', '2026-13-01T00:00:00Z', ''])(
    'lehnt %s ab',
    (value) => {
      expect(Instant.safeParse(value).success).toBe(false);
    },
  );
});

describe('LocalDate', () => {
  it.each(['2026-10-14', '2028-02-29', '2026-12-31'])('akzeptiert %s', (value) => {
    expect(LocalDate.safeParse(value).success).toBe(true);
  });

  it.each(['2026-02-29', '2026-10-32', '2026-1-14', '14.10.2026', '2026-10-14T00:00:00Z'])(
    'lehnt %s ab',
    (value) => {
      expect(LocalDate.safeParse(value).success).toBe(false);
    },
  );
});

describe('TimeZone', () => {
  it.each(['Europe/Berlin', 'America/Argentina/Buenos_Aires', 'Etc/GMT+5', 'UTC', 'Pacific/Kiritimati'])(
    'akzeptiert die IANA-Kennung %s',
    (value) => {
      expect(TimeZone.safeParse(value).success).toBe(true);
    },
  );

  it.each(['+02:00', 'Mars/Olympus_Mons', 'Europe/', 'europe berlin', ''])('lehnt %s ab', (value) => {
    expect(TimeZone.safeParse(value).success).toBe(false);
  });
});
