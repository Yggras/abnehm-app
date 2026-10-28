// Gemeinsame IDs, Konten und Installationen aller Seed-Szenarien (Spezifikation 0, Abschnitt 12).
// Bereiche ergänzen Szenarien unter Wiederverwendung dieser Werte; eigene IDs eines Bereichs folgen
// demselben Muster `5eed<art>-0000-4000-8000-<laufende nummer>`. Alles ist synthetisch.

/** Feste Uhr aller Szenarien: Mittwoch, 14.10.2026, 14:00 Uhr in Berlin. */
export const seedClock = { instant: '2026-10-14T12:00:00.000Z', timeZone: 'Europe/Berlin' } as const;

/** Benannte lokale Tage in `Europe/Berlin` relativ zur festen Uhr. */
export const seedDays = {
  heute: '2026-10-14',
  gestern: '2026-10-13',
  vorgestern: '2026-10-12',
  zielstart: '2026-10-01',
} as const;

/** Beginn des Folgetags in Berlin (Sommerzeit, UTC+2), etwa für `day_ends_at` von heute. */
export const seedDayEnds = {
  heute: '2026-10-14T22:00:00.000Z',
} as const;

/** UTC-Offset in Berlin am 14.10.2026 (Sommerzeit). */
export const seedUtcOffsetMinutes = 120;

const id = (kind: string, n: number) => `5eed${kind}-0000-4000-8000-${n.toString().padStart(12, '0')}`;

export const seedIds = {
  account: { philipp: id('0001', 1), anna: id('0001', 2) },
  person: { philipp: id('0002', 1), anna: id('0002', 2) },
  installation: { philippIphone: id('0003', 1), annaAndroid: id('0003', 2) },
  goalVersion: { philipp: id('0010', 1), anna: id('0010', 2) },
  weeklyPlanVersion: { philipp: id('0011', 1), anna: id('0011', 2) },
  dailyGoal: {
    philippHeute: [id('0012', 1), id('0012', 2), id('0012', 3)],
    annaHeute: [id('0012', 4), id('0012', 5), id('0012', 6)],
  },
  // 0020/5–7 sind Philipps Einträge 3–5, nur in den Varianten `solo-wasser-*` (#171); 0020/3–4 gehören Anna (#117).
  waterEntry: {
    philippHeute: [id('0020', 1), id('0020', 2), id('0020', 5), id('0020', 6), id('0020', 7)],
    annaHeute: [id('0020', 3), id('0020', 4)],
  },
  weightEntry: { philippVorgestern: id('0021', 1), philippHeute: id('0021', 2), annaGestern: id('0021', 3) },
  sportEntry: { philippGestern: id('0022', 1), philippHeute: id('0022', 2), annaHeute: id('0022', 3) },
  nutritionEntry: { philippMittag: id('0031', 1), annaMittag: id('0031', 2) },
  mealPhoto: { philippHeute: id('0032', 1), annaHeute: id('0032', 2) },
  coupling: { philippAnna: id('0040', 1) },
  couplingMember: { philipp: id('0041', 1), anna: id('0041', 2) },
  island: { philippAnna: id('0042', 1) },
  partnerSharing: {
    philipp: { ernaehrung: id('0043', 1), wasser: id('0043', 2), sport: id('0043', 3), gewicht: id('0043', 4) },
    anna: { ernaehrung: id('0043', 5), wasser: id('0043', 6), sport: id('0043', 7), gewicht: id('0043', 8) },
  },
  photoSharing: { philipp: id('0044', 1), anna: id('0044', 2) },
  sharedAction: { dekoGeschenk: id('0045', 1), annasEntkopplung: id('0045', 2) },
  /** Zusammenfassungen je Eigentümer, also an den jeweils anderen Partner. */
  partnerSummary: {
    philipp: { ernaehrung: id('0050', 1), wasser: id('0050', 2), sport: id('0050', 3), gewicht: id('0050', 4) },
    anna: { wasser: id('0050', 6), sport: id('0050', 7), gewicht: id('0050', 8) },
  },
  /** Tageszielstand je Eigentümer, also an den jeweils anderen Partner. */
  partnerDailyGoalStatus: { philipp: id('0051', 1), anna: id('0051', 2) },
} as const;

/** Dokumentiertes Testpasswort aller Seed-Konten; nur in Development- und Testartefakten. */
export const seedPassword = 'momo-insel-testpasswort';

export const seedAccounts = {
  philipp: { key: 'philipp', accountId: seedIds.account.philipp, personId: seedIds.person.philipp, email: 'philipp@example.test', password: seedPassword },
  anna: { key: 'anna', accountId: seedIds.account.anna, personId: seedIds.person.anna, email: 'anna@example.test', password: seedPassword },
} as const;

export const seedInstallations = {
  philippIphone: { key: 'philipp-iphone', installationId: seedIds.installation.philippIphone, account: 'philipp', platform: 'ios' },
  annaAndroid: { key: 'anna-android', installationId: seedIds.installation.annaAndroid, account: 'anna', platform: 'android' },
} as const;
