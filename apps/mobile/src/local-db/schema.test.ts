/**
 * @jest-environment node
 */
import { eq, sql } from 'drizzle-orm';

import type { LocalDatabase, TransactionContext } from '.';
import { createLocalDatabases, type LocalDatabases } from './local-databases';
import * as schema from './schema';
import { sqliteOf, type SqliteDatabase } from './sqlite';
import { createBetterSqliteFiles } from './testing/better-sqlite';
import { personRow, waterRow } from './testing/rows';

// Datenbank-Invarianten des SQLite-Schemas (Spezifikation 0, Abschnitt 8, samt Präzisierungen der
// Spezifikationen 1–5) mit denselben gebündelten Migrationen wie in der App.

const at = '2026-10-14T12:00:00.000Z';
const stamps = { createdAt: at, updatedAt: at };
const day = { localDate: '2026-10-14', timeZone: 'Europe/Berlin', utcOffsetMinutes: 120 };
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ME = uuid(1);
const PARTNER = uuid(2);
const OTHER = uuid(3);

let files: ReturnType<typeof createBetterSqliteFiles>;
let databases: LocalDatabases;
let db: LocalDatabase;

beforeEach(async () => {
  files = createBetterSqliteFiles();
  databases = createLocalDatabases({ openSqlite: files.openSqlite, onError: (error) => { throw error; } });
  db = await databases.open('konto_a');
  write((s) => s.insert(schema.person).values(personRow(ME, 'konto_a')).run());
});

afterEach(() => {
  databases.lock();
  files.remove();
});

function write(work: (s: SqliteDatabase, tx: TransactionContext) => unknown) {
  return db.transaction((tx) => work(sqliteOf(tx), tx));
}

function expectViolation(constraint: RegExp, work: (s: SqliteDatabase) => unknown) {
  expect(() => write(work)).toThrow(constraint);
}

function coupling(s: SqliteDatabase, id: string, low: string, high: string, status: 'aktiv' | 'archiviert' = 'aktiv') {
  s.insert(schema.coupling)
    .values({ id, personLowId: low, personHighId: high, status, startedAt: at, endedAt: status === 'archiviert' ? at : null, ...stamps })
    .run();
}

function member(s: SqliteDatabase, id: string, couplingId: string, personId: string) {
  const { status } = s.select({ status: schema.coupling.status }).from(schema.coupling).where(eq(schema.coupling.id, couplingId)).get()!;
  s.insert(schema.couplingMember).values({ id, couplingId, couplingStatus: status, personId, displayName: 'Anna', ...stamps }).run();
}

function dailyGoalWithCompletion(s: SqliteDatabase) {
  s.insert(schema.dailyGoal)
    .values({
      id: uuid(50),
      personId: ME,
      ...day,
      slot: 2,
      baustein: 'wasserziel',
      snapshot: {
        type: 'wasserziel',
        personId: ME,
        localDate: '2026-10-14',
        slot: 2,
        timeZone: 'Europe/Berlin',
        dayEndsAt: '2026-10-14T22:00:00.000Z',
        targetMl: 1500,
      } as never,
      dayEndsAt: '2026-10-14T22:00:00.000Z',
      createdAt: at,
    })
    .run();
  s.insert(schema.dailyGoalCompletion)
    .values({
      id: uuid(51),
      dailyGoalId: uuid(50),
      personId: ME,
      localDate: '2026-10-14',
      slot: 2,
      baustein: 'wasserziel',
      firstCompletedAt: at,
      completionKey: `tagesziel:${ME}:2026-10-14:2`,
      createdAt: at,
    })
    .run();
}

function booking(id: string, values: Partial<typeof schema.energyBooking.$inferInsert>) {
  return {
    id,
    personId: ME,
    type: 'daily_goal_credit',
    amount: 1,
    localDate: '2026-10-14',
    bookingKey: `tagesziel:${ME}:2026-10-14:2`,
    trigger: {},
    dailyGoalCompletionId: uuid(51),
    createdAt: at,
    ...values,
  } satisfies typeof schema.energyBooking.$inferInsert;
}

function nutritionEntry(values: Partial<typeof schema.nutritionEntry.$inferInsert>) {
  return {
    id: uuid(60),
    personId: ME,
    consumedAt: at,
    ...day,
    meal: 'mittagessen',
    captureMethod: 'suche',
    foodRefType: 'bls',
    foodRefKey: 'B123',
    baseAmount: 150_000,
    displayUnit: 'g',
    displayAmountMilli: 150_000,
    snapshotName: 'Haferflocken',
    snapshotBaseUnit: 'g',
    snapshotReferenceAmount: 100_000,
    snapshotMilliKcal: 370_000,
    snapshotProteinMg: 13_000,
    snapshotCarbsMg: 59_000,
    snapshotFatMg: 7_000,
    snapshotPortions: [],
    snapshotSource: 'bls',
    totalMilliKcal: 555_000,
    totalProteinMg: 19_500,
    totalCarbsMg: 88_500,
    totalFatMg: 10_500,
    ...stamps,
    ...values,
  } satisfies typeof schema.nutritionEntry.$inferInsert;
}

describe('Migrationen', () => {
  it('laufen beim erneuten Öffnen nicht noch einmal', async () => {
    databases.lock();
    db = await databases.open('konto_a');

    const applied = db.read((tx) => sqliteOf(tx).all(sql`select hash from __drizzle_migrations`));
    expect(applied).toHaveLength(1);
    expect(db.read((tx) => sqliteOf(tx).select().from(schema.person).all())).toHaveLength(1);
  });

  it('schalten Fremdschlüssel danach wieder ein', () => {
    expect(db.read((tx) => sqliteOf(tx).get<{ foreign_keys: number }>(sql`PRAGMA foreign_keys`))).toEqual({ foreign_keys: 1 });
  });
});

describe('natürliche Unique-Keys', () => {
  it('Person je Konto', () => {
    expectViolation(/UNIQUE constraint failed: person.account_id/, (s) => s.insert(schema.person).values(personRow(OTHER, 'konto_a')).run());
  });

  it('eine Kopplung je ungeordnetem Personenpaar, sortiert gespeichert', () => {
    write((s) => coupling(s, uuid(10), ME, PARTNER, 'archiviert'));
    expectViolation(/UNIQUE constraint failed: coupling.person_low_id, coupling.person_high_id/, (s) => coupling(s, uuid(11), ME, PARTNER));
    expectViolation(/coupling_pair_order_check/, (s) => coupling(s, uuid(11), PARTNER, ME));
  });

  it('höchstens eine aktive Kopplung je Person; archivieren gibt die Person frei', () => {
    write((s) => {
      coupling(s, uuid(10), ME, PARTNER);
      member(s, uuid(20), uuid(10), ME);
      coupling(s, uuid(11), ME, OTHER);
    });
    expectViolation(/UNIQUE constraint failed: coupling_member.person_id/, (s) => member(s, uuid(21), uuid(11), ME));

    write((s) => s.update(schema.coupling).set({ status: 'archiviert', endedAt: at }).where(eq(schema.coupling.id, uuid(10))).run());
    const mirrored = db.read((tx) => sqliteOf(tx).select({ status: schema.couplingMember.couplingStatus }).from(schema.couplingMember).get());
    expect(mirrored).toEqual({ status: 'archiviert' });
    write((s) => member(s, uuid(21), uuid(11), ME));
  });

  it('Tagesziel je Person, Tag und Platz sowie je Baustein', () => {
    write(dailyGoalWithCompletion);
    const goal = { id: uuid(52), personId: ME, ...day, snapshot: {} as never, dayEndsAt: at, createdAt: at };
    expectViolation(/daily_goal.slot/, (s) => s.insert(schema.dailyGoal).values({ ...goal, slot: 2, baustein: 'gewogen' }).run());
    expectViolation(/daily_goal.baustein/, (s) => s.insert(schema.dailyGoal).values({ ...goal, slot: 3, baustein: 'wasserziel' }).run());
  });

  it('Energiebuchung je Buchungsschlüssel', () => {
    write((s) => {
      dailyGoalWithCompletion(s);
      s.insert(schema.energyBooking).values(booking(uuid(70), {})).run();
    });
    expectViolation(/energy_booking.booking_key/, (s) => s.insert(schema.energyBooking).values(booking(uuid(71), {})).run());
  });

  it('Partner-Zusammenfassung: eine nicht gelöschte je natürlichem Schlüssel, Generation steigt', () => {
    const summary = (id: string, generation: number) => ({
      id,
      couplingId: uuid(10),
      ownerPersonId: PARTNER,
      recipientPersonId: ME,
      area: 'wasser',
      periodFrom: '2026-10-14',
      periodTo: '2026-10-14',
      generation,
      content: { progressPercent: 40 },
      dataAsOf: at,
      ...stamps,
    });
    write((s) => {
      coupling(s, uuid(10), ME, PARTNER);
      s.insert(schema.partnerSummary).values(summary(uuid(80), 1)).run();
    });
    expectViolation(/UNIQUE constraint failed: partner_summary/, (s) => s.insert(schema.partnerSummary).values(summary(uuid(81), 2)).run());

    write((s) => {
      s.update(schema.partnerSummary).set({ deletedAt: at }).where(eq(schema.partnerSummary.id, uuid(80))).run();
      s.insert(schema.partnerSummary).values(summary(uuid(81), 2)).run();
    });
    expectViolation(/UNIQUE constraint failed: partner_summary/, (s) =>
      s.insert(schema.partnerSummary).values({ ...summary(uuid(82), 2), deletedAt: at }).run(),
    );
  });

  it('höchstens ein offener Vorschlag oder eine aktive Challenge je Kopplung', () => {
    const challenge = (id: string, status: 'vorgeschlagen' | 'aktiv' | 'abgelehnt') => ({
      id,
      couplingId: uuid(10),
      templateKey: 'gemeinsam_dranbleiben',
      proposerPersonId: PARTNER,
      status,
      proposedAt: at,
      proposalExpiresAt: at,
      startedAt: status === 'aktiv' ? at : null,
      endsAt: status === 'aktiv' ? at : null,
      endedAt: status === 'abgelehnt' ? at : null,
      ...stamps,
    });
    write((s) => {
      coupling(s, uuid(10), ME, PARTNER);
      s.insert(schema.challenge).values(challenge(uuid(90), 'abgelehnt')).run();
      s.insert(schema.challenge).values(challenge(uuid(91), 'vorgeschlagen')).run();
    });
    expectViolation(/UNIQUE constraint failed: challenge.coupling_id/, (s) => s.insert(schema.challenge).values(challenge(uuid(92), 'aktiv')).run());
  });

  it('eigenes Lebensmittel je Barcode, Lebensmittelfavorit je Referenz, Import je externem Schlüssel', () => {
    const food = (id: string) => ({
      id,
      personId: ME,
      name: 'Joghurt',
      baseUnit: 'g',
      referenceAmount: 100_000,
      milliKcal: 60_000,
      proteinMg: 4_000,
      carbsMg: 5_000,
      fatMg: 3_000,
      portions: [],
      originType: 'off',
      originKey: '4001234567890',
      ...stamps,
    });
    const favorite = (id: string) => ({ id, personId: ME, foodRefType: 'bls', foodRefKey: 'B123', snapshot: {}, ...stamps });
    const workout = (id: string) => ({
      id,
      personId: ME,
      activityType: 'laufen',
      startedAt: at,
      durationMinutes: 30,
      origin: 'apple_health',
      externalKey: 'hk-1',
      ...day,
      ...stamps,
    });
    write((s) => {
      s.insert(schema.ownFood).values(food(uuid(100))).run();
      s.insert(schema.foodFavorite).values(favorite(uuid(101))).run();
      s.insert(schema.sportEntry).values(workout(uuid(102))).run();
    });
    expectViolation(/own_food.person_id, own_food.origin_key/, (s) => s.insert(schema.ownFood).values(food(uuid(110))).run());
    expectViolation(/food_favorite/, (s) => s.insert(schema.foodFavorite).values(favorite(uuid(111))).run());
    expectViolation(/sport_entry.person_id, sport_entry.origin, sport_entry.external_key/, (s) =>
      s.insert(schema.sportEntry).values(workout(uuid(112))).run(),
    );
  });
});

describe('CHECK-Constraints', () => {
  it('Onboarding-Stand und erreichtes Zielgewicht', () => {
    const update = (values: Partial<typeof schema.person.$inferInsert>) => (s: SqliteDatabase) =>
      s.update(schema.person).set(values).where(eq(schema.person.id, ME)).run();
    expectViolation(/person_onboarding_completed_check/, update({ onboardingCompletedAt: at }));
    expectViolation(/person_onboarding_fields_check/, update({ onboardingStatus: 'abgeschlossen', onboardingCompletedAt: at }));
    expectViolation(/person_goal_weight_reached_check/, update({ goalWeightReachedG: 75_000 }));
    write(update({ goalWeightReachedG: 75_000, goalWeightReachedAt: at }));
  });

  it('Energiebuchung: Betrag und Verweis passen zur Art', () => {
    write(dailyGoalWithCompletion);
    expectViolation(/energy_booking_amount_check/, (s) => s.insert(schema.energyBooking).values(booking(uuid(70), { amount: 2 })).run());
    expectViolation(/energy_booking_reference_check/, (s) =>
      s.insert(schema.energyBooking).values(booking(uuid(70), { type: 'daily_bonus_credit', bookingKey: 'tagesbonus' })).run(),
    );
  });

  it('Wasser 1–3000 ml, Gewicht 20–350 kg, Sport 1–1440 Minuten und Felder je Herkunft', () => {
    expectViolation(/water_entry_amount_check/, (s) => s.insert(schema.waterEntry).values(waterRow(uuid(30), ME, 3001)).run());
    expectViolation(/water_entry_origin_check/, (s) =>
      s.insert(schema.waterEntry).values({ ...waterRow(uuid(30), ME), origin: 'apple_health' }).run(),
    );
    const weight = { id: uuid(31), personId: ME, measuredAt: at, origin: 'manuell', ...day, ...stamps };
    expectViolation(/weight_entry_weight_check/, (s) => s.insert(schema.weightEntry).values({ ...weight, weightG: 19_999 }).run());
    expectViolation(/weight_entry_origin_fields_check/, (s) =>
      s.insert(schema.weightEntry).values({ ...weight, weightG: 80_000, externalKey: 'hk-1' }).run(),
    );
    const workout = { id: uuid(32), personId: ME, activityType: 'laufen', startedAt: at, origin: 'manuell', ...day, ...stamps };
    expectViolation(/sport_entry_duration_check/, (s) => s.insert(schema.sportEntry).values({ ...workout, durationMinutes: 1441 }).run());
    expectViolation(/sport_entry_activity_type_check/, (s) =>
      s.insert(schema.sportEntry).values({ ...workout, durationMinutes: 30, activityType: 'tanzen' }).run(),
    );
    expectViolation(/sport_entry_origin_fields_check/, (s) =>
      s.insert(schema.sportEntry).values({ ...workout, durationMinutes: 30, hiddenAt: at }).run(),
    );
  });

  it('Ernährungseintrag: Referenz nur ohne KI, KI nur aus Fotos, Menge bis 5 kg', () => {
    write((s) => s.insert(schema.nutritionEntry).values(nutritionEntry({})).run());
    expectViolation(/nutrition_entry_ref_check/, (s) =>
      s.insert(schema.nutritionEntry).values(nutritionEntry({ id: uuid(61), snapshotSource: 'ki', captureMethod: 'foto' })).run(),
    );
    expectViolation(/nutrition_entry_ai_capture_check/, (s) =>
      s.insert(schema.nutritionEntry).values(nutritionEntry({ id: uuid(61), snapshotSource: 'ki', foodRefType: null, foodRefKey: null })).run(),
    );
    expectViolation(/nutrition_entry_amount_check/, (s) =>
      s.insert(schema.nutritionEntry).values(nutritionEntry({ id: uuid(61), baseAmount: 5_000_001 })).run(),
    );
    expectViolation(/nutrition_entry_capture_method_check/, (s) =>
      s.insert(schema.nutritionEntry).values(nutritionEntry({ id: uuid(61), captureMethod: 'raten' })).run(),
    );
    expectViolation(/nutrition_entry_macros_check/, (s) =>
      s.insert(schema.nutritionEntry).values(nutritionEntry({ id: uuid(61), snapshotCarbsMg: 90_000 })).run(),
    );
  });

  it('Benachrichtigungseinstellung: Uhrzeiten HH:MM, Abend nach Mittag', () => {
    const setting = {
      id: uuid(40),
      personId: ME,
      middayEnabled: true,
      eveningEnabled: true,
      trackerErnaehrung: true,
      trackerWasser: true,
      trackerSport: true,
      trackerGewicht: true,
      partnerPushEnabled: true,
      ...stamps,
    };
    expectViolation(/notification_setting_time_order_check/, (s) =>
      s.insert(schema.notificationSetting).values({ ...setting, middayTime: '19:00', eveningTime: '13:00' }).run(),
    );
    expectViolation(/notification_setting_time_format_check/, (s) =>
      s.insert(schema.notificationSetting).values({ ...setting, middayTime: '13:00', eveningTime: '24:00' }).run(),
    );
    write((s) => s.insert(schema.notificationSetting).values({ ...setting, middayTime: '13:00', eveningTime: '19:00' }).run());
  });
});

describe('unveränderliche Ereignisse', () => {
  it('Erfüllung übernimmt Person, Tag, Platz und Baustein unverändert aus dem Tagesziel', () => {
    write(dailyGoalWithCompletion);
    expectViolation(/FOREIGN KEY constraint failed/, (s) =>
      s.update(schema.dailyGoalCompletion).set({ slot: 3 }).where(eq(schema.dailyGoalCompletion.id, uuid(51))).run(),
    );
  });

  it('Tagesziel, Erfüllung und Buchung lassen sich nicht unter ihren Verweisen weglöschen', () => {
    write((s) => {
      dailyGoalWithCompletion(s);
      s.insert(schema.energyBooking).values(booking(uuid(70), {})).run();
    });
    expectViolation(/FOREIGN KEY constraint failed/, (s) => s.delete(schema.dailyGoalCompletion).run());
    expectViolation(/FOREIGN KEY constraint failed/, (s) => s.delete(schema.dailyGoal).run());
    expectViolation(/FOREIGN KEY constraint failed/, (s) => s.delete(schema.person).run());
  });
});
