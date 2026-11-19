import { eq, sql } from 'drizzle-orm';
import { describe, expect, it, onTestFinished } from 'vitest';

import { migrateDatabase } from '../src/db/migrate.ts';
import * as schema from '../src/db/schema/index.ts';
import type { Database } from '../src/database.ts';
import { createTestDatabase } from './support/postgres.ts';

// Datenbank-Invarianten des Postgres-Schemas (Spezifikation 0, Abschnitt 8, samt Präzisierungen der
// Spezifikationen 1–5) mit den echten Migrationen auf einem flüchtigen Postgres.

const at = new Date('2026-10-14T12:00:00.000Z');
const stamps = { createdAt: at, updatedAt: at, serverVersion: 1n };
const day = { localDate: '2026-10-14', timeZone: 'Europe/Berlin', utcOffsetMinutes: 120 };
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ME = uuid(1);
const PARTNER = uuid(2);
const OTHER = uuid(3);
/** Konten (Better-Auth-„user“) der drei Personen. */
const accountOf = (person: string) => person.replace('00000000-0000-4000-8000-', '00000000-0000-4000-9000-');

type Db = Database['db'];

async function migratedDatabase(): Promise<Db> {
  const database = await createTestDatabase();
  onTestFinished(() => database.drop());
  await migrateDatabase(database.handle);
  const { db } = database.handle;
  for (const id of [ME, PARTNER, OTHER]) {
    await db.insert(schema.user).values({ id: accountOf(id), name: '', email: `${id}@example.test`, emailVerified: false, createdAt: at, updatedAt: at });
    await db.insert(schema.person).values(personRow(id, accountOf(id)));
  }
  return db;
}

function personRow(id: string, accountId: string): typeof schema.person.$inferInsert {
  return { id, accountId, displayName: 'Testperson', onboardingStatus: 'begonnen', timeZone: 'Europe/Berlin', ...stamps };
}

/** Erwartet, dass `work` am genannten Constraint scheitert (Postgres meldet seinen Namen). */
async function expectViolation(constraint: string, work: Promise<unknown>) {
  const error: unknown = await work.then(
    () => undefined,
    (failure: unknown) => failure,
  );
  expect(error, `erwartet: Verletzung von ${constraint}`).toBeDefined();
  const cause = (error as { cause?: { constraint?: string; message?: string } }).cause;
  expect(cause?.constraint ?? cause?.message).toBe(constraint);
}

/** Kopplung samt ihren beiden Mitgliedern in einer Transaktion, wie bei der Annahme einer Einladung. */
function coupling(db: Db, id: string, low: string, high: string, status: 'aktiv' | 'archiviert' = 'aktiv') {
  return db.transaction(async (tx) => {
    await tx
      .insert(schema.coupling)
      .values({ id, personLowId: low, personHighId: high, status, startedAt: at, endedAt: status === 'archiviert' ? at : null, ...stamps });
    for (const personId of [low, high]) {
      await tx
        .insert(schema.couplingMember)
        .values({ id: `${id.slice(0, 24)}${personId.slice(-4)}${id.slice(-8)}`, couplingId: id, couplingStatus: status, personId, displayName: 'Anna', ...stamps });
    }
  });
}

async function dailyGoalWithCompletion(db: Db) {
  await db.insert(schema.dailyGoal).values({
    id: uuid(50),
    personId: ME,
    ...day,
    slot: 2,
    baustein: 'wasserziel',
    snapshot: {} as never,
    dayEndsAt: at,
    createdAt: at,
    serverVersion: 1n,
  });
  await db.insert(schema.dailyGoalCompletion).values({
    id: uuid(51),
    dailyGoalId: uuid(50),
    personId: ME,
    localDate: '2026-10-14',
    slot: 2,
    baustein: 'wasserziel',
    firstCompletedAt: at,
    completionKey: `tagesziel:${ME}:2026-10-14:2`,
    createdAt: at,
    serverVersion: 1n,
  });
}

function booking(id: string, values: Partial<typeof schema.energyBooking.$inferInsert> = {}) {
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
    serverVersion: 2n,
    ...values,
  } satisfies typeof schema.energyBooking.$inferInsert;
}

describe('Migrationen', () => {
  it('laufen ein zweites Mal folgenlos und legen die Sync-Clock bei 0 an', async () => {
    const database = await createTestDatabase();
    onTestFinished(() => database.drop());

    await migrateDatabase(database.handle);
    await migrateDatabase(database.handle);

    expect(await database.handle.db.select().from(schema.syncClock)).toEqual([{ id: 1, position: 0n }]);
  });

  it('legen außerhalb der Better-Auth-Tabellen keine E-Mail-Spalte an', async () => {
    const db = await migratedDatabase();

    const columns = await db.execute<{ table_name: string; column_name: string }>(
      sql`select table_name, column_name from information_schema.columns where table_schema = 'public' and column_name ~* 'e_?mail' and table_name not in ('user', 'account', 'session', 'verification')`,
    );
    expect(columns.rows).toEqual([]);
  });
});

describe('natürliche Unique-Keys', () => {
  it('Person je Konto', async () => {
    const db = await migratedDatabase();
    await expectViolation('person_account_uq', db.insert(schema.person).values(personRow(uuid(9), accountOf(ME))));
  });

  it('eine Kopplung je ungeordnetem Personenpaar, sortiert gespeichert', async () => {
    const db = await migratedDatabase();
    await coupling(db, uuid(10), ME, PARTNER, 'archiviert');
    await expectViolation('coupling_pair_uq', coupling(db, uuid(11), ME, PARTNER));
    await expectViolation('coupling_pair_order_check', coupling(db, uuid(11), PARTNER, ME));
  });

  it('höchstens eine aktive Kopplung je Person, auch bei paralleler Annahme; archivieren gibt frei', async () => {
    const db = await migratedDatabase();
    await coupling(db, uuid(10), ME, PARTNER);
    await expectViolation('coupling_member_active_person_uq', coupling(db, uuid(11), ME, OTHER));

    await db.update(schema.coupling).set({ status: 'archiviert', endedAt: at }).where(eq(schema.coupling.id, uuid(10)));
    expect(await db.select({ status: schema.couplingMember.couplingStatus }).from(schema.couplingMember)).toEqual([
      { status: 'archiviert' },
      { status: 'archiviert' },
    ]);
    await coupling(db, uuid(11), ME, OTHER);
  });

  it('eine Kopplung hat genau die beiden Personen ihres Paars als Mitglieder', async () => {
    const db = await migratedDatabase();
    const couplingRow = { id: uuid(10), personLowId: ME, personHighId: PARTNER, status: 'aktiv', startedAt: at, ...stamps };
    const memberRow = (n: number, personId: string) => ({
      id: uuid(n),
      couplingId: uuid(10),
      couplingStatus: 'aktiv',
      personId,
      displayName: 'Anna',
      ...stamps,
    });

    // Ohne Mitglieder, mit nur einem oder mit einer fremden Person scheitert der Commit.
    await expectViolation('coupling_members_check', db.insert(schema.coupling).values(couplingRow));
    for (const members of [[memberRow(20, ME)], [memberRow(20, ME), memberRow(21, OTHER)]]) {
      await expectViolation(
        'coupling_members_check',
        db.transaction(async (tx) => {
          await tx.insert(schema.coupling).values(couplingRow);
          await tx.insert(schema.couplingMember).values(members);
        }),
      );
    }
    await coupling(db, uuid(10), ME, PARTNER);
    await expectViolation('coupling_members_check', db.delete(schema.couplingMember).where(eq(schema.couplingMember.personId, ME)));
  });

  it('Konto einer Person ist unveränderlich', async () => {
    const db = await migratedDatabase();
    const error = await db
      .update(schema.person)
      .set({ accountId: accountOf(uuid(9)) })
      .where(eq(schema.person.id, ME))
      .then(
        () => undefined,
        (failure: { cause?: { code?: string } }) => failure.cause,
      );
    expect(error?.code).toBe('23001');
    await db.update(schema.person).set({ displayName: 'Neu' }).where(eq(schema.person.id, ME));
  });

  it('Tagesziel je Person, Tag und Platz sowie je Baustein', async () => {
    const db = await migratedDatabase();
    await dailyGoalWithCompletion(db);
    const goal = { id: uuid(52), personId: ME, ...day, snapshot: {} as never, dayEndsAt: at, createdAt: at, serverVersion: 3n };
    await expectViolation('daily_goal_slot_uq', db.insert(schema.dailyGoal).values({ ...goal, slot: 2, baustein: 'gewogen' }));
    await expectViolation('daily_goal_baustein_uq', db.insert(schema.dailyGoal).values({ ...goal, slot: 3, baustein: 'wasserziel' }));
  });

  it('Energiebuchung je Buchungsschlüssel', async () => {
    const db = await migratedDatabase();
    await dailyGoalWithCompletion(db);
    await db.insert(schema.energyBooking).values(booking(uuid(70)));
    await expectViolation('energy_booking_key_uq', db.insert(schema.energyBooking).values(booking(uuid(71))));
  });

  it('Partner-Zusammenfassung: eine nicht gelöschte je natürlichem Schlüssel, Generation steigt', async () => {
    const db = await migratedDatabase();
    await coupling(db, uuid(10), ME, PARTNER);
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
    await db.insert(schema.partnerSummary).values(summary(uuid(80), 1));
    await expectViolation('partner_summary_live_uq', db.insert(schema.partnerSummary).values(summary(uuid(81), 2)));

    await db.update(schema.partnerSummary).set({ deletedAt: at }).where(eq(schema.partnerSummary.id, uuid(80)));
    await db.insert(schema.partnerSummary).values(summary(uuid(81), 2));
    await expectViolation('partner_summary_generation_uq', db.insert(schema.partnerSummary).values({ ...summary(uuid(82), 2), deletedAt: at }));
  });

  it('höchstens ein offener Vorschlag oder eine aktive Challenge je Kopplung', async () => {
    const db = await migratedDatabase();
    await coupling(db, uuid(10), ME, PARTNER);
    const challenge = (id: string, status: 'vorgeschlagen' | 'aktiv') => ({
      id,
      couplingId: uuid(10),
      templateKey: 'gemeinsam_dranbleiben',
      proposerPersonId: PARTNER,
      status,
      proposedAt: at,
      proposalExpiresAt: at,
      startedAt: status === 'aktiv' ? at : null,
      endsAt: status === 'aktiv' ? at : null,
      ...stamps,
    });
    await db.insert(schema.challenge).values(challenge(uuid(90), 'vorgeschlagen'));
    await expectViolation('challenge_open_uq', db.insert(schema.challenge).values(challenge(uuid(91), 'aktiv')));
  });

  it('offener Einladungscode ist eindeutig, verbrauchte Codes geben ihn frei', async () => {
    const db = await migratedDatabase();
    const invitation = (id: string) => ({ id, inviterPersonId: ME, codeHmac: 'hmac-1', expiresAt: at, createdAt: at });
    await db.insert(schema.invitation).values(invitation(uuid(30)));
    await expectViolation('invitation_open_code_uq', db.insert(schema.invitation).values(invitation(uuid(31))));
    await expectViolation(
      'invitation_consumed_check',
      db.update(schema.invitation).set({ consumedAt: at }).where(eq(schema.invitation.id, uuid(30))),
    );

    await db.update(schema.invitation).set({ consumedAt: at, consumedByPersonId: PARTNER }).where(eq(schema.invitation.id, uuid(30)));
    await db.insert(schema.invitation).values(invitation(uuid(31)));
  });
});

describe('CHECK-Constraints', () => {
  it('Energiebuchung: Betrag und Verweis passen zur Art', async () => {
    const db = await migratedDatabase();
    await dailyGoalWithCompletion(db);
    await expectViolation('energy_booking_amount_check', db.insert(schema.energyBooking).values(booking(uuid(70), { amount: 2 })));
    await expectViolation(
      'energy_booking_reference_check',
      db.insert(schema.energyBooking).values(booking(uuid(70), { type: 'daily_bonus_credit', bookingKey: 'tagesbonus' })),
    );
  });

  it('Onboarding-Stand verlangt Abschlusszeitpunkt und alle Körperangaben', async () => {
    const db = await migratedDatabase();
    const update = (values: Partial<typeof schema.person.$inferInsert>) =>
      db.update(schema.person).set(values).where(eq(schema.person.id, ME));
    await expectViolation('person_onboarding_completed_check', update({ onboardingCompletedAt: at }));
    await expectViolation('person_onboarding_fields_check', update({ onboardingStatus: 'abgeschlossen', onboardingCompletedAt: at }));
  });

  it('Wasser, Gewicht und Sport innerhalb ihrer Grenzen, Felder je Herkunft', async () => {
    const db = await migratedDatabase();
    const water = { id: uuid(40), personId: ME, origin: 'manuell', loggedAt: at, ...day, ...stamps };
    await expectViolation('water_entry_amount_check', db.insert(schema.waterEntry).values({ ...water, amountMl: 0 }));
    const weight = { id: uuid(41), personId: ME, measuredAt: at, ...day, ...stamps };
    await expectViolation('weight_entry_weight_check', db.insert(schema.weightEntry).values({ ...weight, origin: 'manuell', weightG: 350_001 }));
    await expectViolation(
      'weight_entry_origin_fields_check',
      db.insert(schema.weightEntry).values({ ...weight, origin: 'health_connect', weightG: 80_000 }),
    );
  });

  it('Benachrichtigungs-Intent: Kennung aus Quellereignis, Empfänger und Typ', async () => {
    const db = await migratedDatabase();
    const intent = {
      sourceEventId: uuid(60),
      recipientPersonId: ME,
      type: 'levelaufstieg' as const,
      messageKey: 'levelaufstieg',
      payload: { level: 2 },
      status: 'offen' as const,
      createdAt: at,
      statusChangedAt: at,
    };
    await expectViolation('notification_intent_id_check', db.insert(schema.notificationIntent).values({ ...intent, intentId: 'falsch' }));
    await db.insert(schema.notificationIntent).values({ ...intent, intentId: `${uuid(60)}:${ME}:levelaufstieg` });

    // Nur der Zustellstatus ändert sich, der Inhalt nie.
    await db.update(schema.notificationIntent).set({ status: 'zugestellt', statusChangedAt: at });
    const error = await db
      .update(schema.notificationIntent)
      .set({ payload: { level: 3 } })
      .then(
        () => undefined,
        (failure: { cause?: { code?: string } }) => failure.cause,
      );
    expect(error?.code).toBe('23001');
  });

  it('ein manueller Sporteintrag wird nur durch einen Import derselben Person ersetzt', async () => {
    const db = await migratedDatabase();
    const workout = (n: number, values: Partial<typeof schema.sportEntry.$inferInsert>) => ({
      id: uuid(n),
      personId: ME,
      activityType: 'laufen',
      startedAt: at,
      durationMinutes: 30,
      origin: 'manuell',
      ...day,
      ...stamps,
      ...values,
    });
    await db.insert(schema.sportEntry).values([
      workout(40, {}),
      workout(41, { origin: 'apple_health', externalKey: 'hk-1' }),
      workout(42, { personId: PARTNER, origin: 'apple_health', externalKey: 'hk-2' }),
    ]);

    await expectViolation('sport_entry_replaced_by_import_check', db.insert(schema.sportEntry).values(workout(43, { replacedByEntryId: uuid(40) })));
    await expectViolation('sport_entry_replaced_by_fk', db.insert(schema.sportEntry).values(workout(43, { replacedByEntryId: uuid(42) })));
    await db.update(schema.sportEntry).set({ replacedByEntryId: uuid(41) }).where(eq(schema.sportEntry.id, uuid(40)));
  });
});

describe('Rollback', () => {
  it('verwirft alle Zeilen einer Transaktion, wenn eine davon einen Constraint verletzt', async () => {
    const db = await migratedDatabase();
    const water = (id: string, amountMl: number) => ({ id, personId: ME, origin: 'manuell', amountMl, loggedAt: at, ...day, ...stamps });

    await expect(
      db.transaction(async (tx) => {
        await tx.insert(schema.waterEntry).values(water(uuid(40), 250));
        await tx.insert(schema.waterEntry).values(water(uuid(41), 5000));
      }),
    ).rejects.toThrow();

    expect(await db.select().from(schema.waterEntry)).toEqual([]);
  });
});

describe('unveränderliche Ereignisse', () => {
  it('Energiebuchung, Erfüllung und Tagesziel lassen weder Update noch Delete zu', async () => {
    const db = await migratedDatabase();
    await dailyGoalWithCompletion(db);
    await db.insert(schema.energyBooking).values(booking(uuid(70)));
    const immutable = 'Unveränderliche Entität';

    for (const work of [
      db.update(schema.energyBooking).set({ amount: 1 }),
      db.delete(schema.energyBooking),
      db.update(schema.dailyGoalCompletion).set({ firstCompletedAt: at }),
      db.delete(schema.dailyGoal),
    ]) {
      const error = await work.then(
        () => undefined,
        (failure: { cause?: { message?: string; code?: string } }) => failure.cause,
      );
      expect(error?.code).toBe('23001');
      expect(error?.message).toContain(immutable);
    }
  });

  it('Fremdschlüssel unveränderlicher Ereignisse und Buchungen sind RESTRICT', async () => {
    const db = await migratedDatabase();
    const immutableTables = [
      'daily_goal',
      'daily_goal_completion',
      'energy_booking',
      'project_contribution',
      'blueprint_unlock',
      'area_unlock',
      'island_field',
      'momo_accessory',
    ];

    const foreignKeys = await db.execute<{ table_name: string; constraint_name: string; on_delete: string }>(sql`
      select conrelid::regclass::text as table_name, conname as constraint_name, confdeltype as on_delete
      from pg_constraint where contype = 'f' and conrelid::regclass::text in ${immutableTables}`);
    expect(foreignKeys.rows.length).toBeGreaterThanOrEqual(immutableTables.length);
    expect(foreignKeys.rows.filter((row) => row.on_delete !== 'r')).toEqual([]);

    await dailyGoalWithCompletion(db);
    await db.insert(schema.energyBooking).values(booking(uuid(70)));
    await expectViolation('daily_goal_person_id_person_id_fk', db.delete(schema.person).where(eq(schema.person.id, ME)));
  });

  it('Erfüllung übernimmt Person, Tag, Platz und Baustein aus ihrem Tagesziel', async () => {
    const db = await migratedDatabase();
    await db.insert(schema.dailyGoal).values({
      id: uuid(52),
      personId: ME,
      ...day,
      slot: 3,
      baustein: 'gewogen',
      snapshot: {} as never,
      dayEndsAt: at,
      createdAt: at,
      serverVersion: 1n,
    });

    await expectViolation(
      'daily_goal_completion_goal_fk',
      db.insert(schema.dailyGoalCompletion).values({
        id: uuid(53),
        dailyGoalId: uuid(52),
        personId: ME,
        localDate: '2026-10-14',
        slot: 2,
        baustein: 'gewogen',
        firstCompletedAt: at,
        completionKey: 'anderer',
        createdAt: at,
        serverVersion: 4n,
      }),
    );
  });
});
