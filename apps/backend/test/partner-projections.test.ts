import { eq, isNull } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { EntityId, Instant, LocalDate, type AreaKey, type SyncCursor } from '@abnehm/contracts/base';
import { PartnerDailyGoalStatus, PartnerSummaryEnvelope, RevocationNotice } from '@abnehm/contracts/partner';
import type { CanonicalChange } from '@abnehm/contracts/sync';

import { coupling, partnerDailyGoalStatus, partnerSummary, person, projectionInvalidation, waterEntry } from '../src/db/schema/index.ts';
import { invalidatePartnerSummaries } from '../src/partner-projections/invalidations.ts';
import type { AnyPartnerSummaryProjector, PartnerSummaryProjector } from '../src/partner-projections/projector.ts';
import { dataAsOfRefreshMs } from '../src/partner-projections/projections.ts';
import { revokeCoupling } from '../src/partner-projections/revocation.ts';
import { trackerPartnerSummaryProjectors } from '../src/trackers/partner-summaries.ts';
import { securityLogEntries } from './support/auth-client.ts';
import { coupledWorld, otherCouple, sharingId, worldStart, worldToday, type CoupledWorld, type WorldPerson } from './support/coupled-world.ts';
import { completeOp, insertDailyGoals } from './support/daily-goals.ts';
import { partnerProjectorConformanceCases } from './support/partner-projector-conformance.ts';
import { testNutritionProjector, testPlans, testRecorders } from './support/partner-projectors.ts';
import { pullAll, push, upsertOp } from './support/sync.ts';

// Projektionsmechanismus (Spezifikation 0, Abschnitt 5; #106) über die echte Hono-App: Vor dem Pull
// materialisiert das Fundament, was die abrufende Person über ihren Partner sehen darf. Den Mechanismus
// belegen die Projectors für Wasser und Sport aus Spezifikation 3 (#181) mit dem `PlanReader`-Fake aus
// #104; ihre eigenen Regeln prüft `tracker-partner-summaries.test.ts`.

const today = LocalDate.parse(worldToday);

type World = CoupledWorld & {
  plans: ReturnType<typeof testPlans>;
  /** Alle Seiten eines Pulls ab dem letzten Cursor der Person. */
  pull(who: WorldPerson): Promise<CanonicalChange[]>;
  /** Wasser der Eigentümerin samt Invalidierung, wie es der Wasserbereich bei der Push-Annahme schreibt. */
  drink(owner: WorldPerson, amountMl: number, localDate?: string): Promise<void>;
  setSharing(owner: WorldPerson, area: AreaKey | 'fotos', level: string): Promise<void>;
  summaries(changes: readonly CanonicalChange[]): PartnerSummaryEnvelope[];
};

type Plans = ReturnType<typeof testPlans>;

/** Der echte Projector eines Tracker-Bereichs über dem `PlanReader`-Fake. */
const trackerProjector = <A extends 'wasser' | 'sport'>(area: A, plans: Plans): PartnerSummaryProjector<A> =>
  trackerPartnerSummaryProjectors({ planReader: plans.planReader })[area];

async function world(projectors: (plans: Plans) => readonly AnyPartnerSummaryProjector[] = (plans) => [
  trackerProjector('wasser', plans),
  trackerProjector('sport', plans),
]): Promise<World> {
  const plans = testPlans();
  const base = await coupledWorld({ partnerSummaryProjectors: projectors(plans) });
  for (const member of [base.anna, base.philipp]) plans.set(member.personId, { validFrom: '2026-10-01', waterTargetMl: 1500, weeklySportTargetMinutes: 150 });
  const cursors = new Map<string, SyncCursor | null>();
  const db = base.backend.database.db;
  return {
    ...base,
    plans,
    async pull(who) {
      const { changes, cursor } = await pullAll(base.backend, who.device, cursors.get(who.personId) ?? null);
      cursors.set(who.personId, cursor);
      return changes;
    },
    async drink(owner, amountMl, localDate = worldToday) {
      await db.transaction(async (tx) => {
        await testRecorders.wasser.water(tx, owner.personId, localDate, amountMl);
        await invalidatePartnerSummaries(tx, { type: 'bereich', ownerPersonId: EntityId.parse(owner.personId), area: 'wasser', localDate: LocalDate.parse(localDate) }, new Date(base.clock.read().instant));
      });
    },
    async setSharing(owner, area, level) {
      const [result] = await push(base.backend, owner.device, [
        upsertOp(await sharingId(base, owner, area), { level }, { entityType: area === 'fotos' ? 'photo_sharing' : 'partner_sharing' }),
      ]);
      expect(result?.type).toBe('applied');
    },
    summaries: (changes) =>
      changes.flatMap((change) => (change.type === 'record' && change.entityType === 'partner_summary' ? [PartnerSummaryEnvelope.parse(change.data)] : [])),
  };
}

const ofType = (changes: readonly CanonicalChange[], entityType: string) => changes.filter((change) => change.entityType === entityType);
const statuses = (changes: readonly CanonicalChange[]) =>
  ofType(changes, 'partner_daily_goal_status').flatMap((change) => (change.type === 'record' ? [PartnerDailyGoalStatus.parse(change.data)] : []));
const notices = (changes: readonly CanonicalChange[]) =>
  ofType(changes, 'revocation_notice').flatMap((change) => (change.type === 'record' ? [RevocationNotice.parse(change.data)] : []));

/** Entkopplung, wie sie der Entkopplungs-Kern (#107) in einer Transaktion ausführt. */
async function uncouple(w: World) {
  const at = new Date(w.clock.read().instant);
  await w.backend.database.db.transaction(async (tx) => {
    await tx.update(coupling).set({ status: 'archiviert', endedAt: at, updatedAt: at }).where(eq(coupling.id, w.couplingId));
    await revokeCoupling(tx, w.couplingId, at);
  });
}

async function completeGoals(w: World, owner: WorldPerson, completed: number) {
  const goals = await insertDailyGoals(w.backend, owner.personId, worldToday);
  for (const goal of goals.slice(0, completed)) expect((await push(w.backend, owner.device, [completeOp(goal)]))[0]?.type).toBe('applied');
}

describe('Partner-Tageszielstand', () => {
  it('Tracer Bullet: Anna erfüllt ein Tagesziel, Philipp sieht nach dem Pull „unterwegs“', async () => {
    const w = await world();
    expect(statuses(await w.pull(w.philipp))).toMatchObject([{ ownerPersonId: w.anna.personId, localDate: worldToday, stage: 'noch_nichts' }]);

    await completeGoals(w, w.anna, 1);

    expect(statuses(await w.pull(w.philipp))).toMatchObject([{ ownerPersonId: w.anna.personId, recipientPersonId: w.philipp.personId, stage: 'unterwegs' }]);
  });

  it.each([
    [2, 'fast_geschafft'],
    [3, 'geschafft'],
  ] as const)('nennt bei %i Erfüllungen nur die Stufe %s, nie eine Zahl', async (completed, stage) => {
    const w = await world();
    await completeGoals(w, w.anna, completed);

    const [status] = statuses(await w.pull(w.philipp));

    expect(status?.stage).toBe(stage);
    expect(Object.keys(status ?? {}).sort()).toEqual(['couplingId', 'dataAsOf', 'id', 'localDate', 'ownerPersonId', 'recipientPersonId', 'serverVersion', 'stage']);
  });

  it('ist bei aktiver Kopplung auch ohne jede Bereichsfreigabe sichtbar', async () => {
    const w = await world();
    for (const area of ['ernaehrung', 'wasser', 'sport', 'gewicht'] as const) await w.setSharing(w.anna, area, 'privat');

    const changes = await w.pull(w.philipp);

    expect(statuses(changes)).toHaveLength(1);
    expect(w.summaries(changes)).toEqual([]);
  });

  it('wechselt um Mitternacht der Eigentümerin zum neuen Tag und löscht den alten Stand', async () => {
    const w = await world();
    await completeGoals(w, w.anna, 3);
    const [yesterday] = statuses(await w.pull(w.philipp));

    // 22:30 UTC ist in Berlin schon der 15.10.
    w.clock.set(Instant.parse('2026-10-14T22:30:00.000Z'));
    const changes = await w.pull(w.philipp);

    expect(statuses(changes)).toMatchObject([{ localDate: '2026-10-15', stage: 'noch_nichts' }]);
    expect(ofType(changes, 'partner_daily_goal_status')).toContainEqual(expect.objectContaining({ type: 'tombstone', entityId: yesterday?.id }));
  });
});

describe('Partner-Zusammenfassungen', () => {
  it('materialisiert fehlende Zusammenfassungen des aktuellen Zeitraums und übernimmt Invalidierungen', async () => {
    const w = await world();
    await w.drink(w.anna, 750);

    const first = w.summaries(await w.pull(w.philipp));
    expect(first).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'wasser', period: { type: 'tag', localDate: worldToday }, content: { progressPercent: 50 }, generation: 1 }),
        expect.objectContaining({ type: 'sport', period: { type: 'woche', from: '2026-10-12', to: '2026-10-18' }, content: { countedMinutes: 0, weeklyTargetMinutes: 150 } }),
      ]),
    );
    expect(w.summaries(await w.pull(w.philipp))).toEqual([]);

    await w.drink(w.anna, 375);
    const [water] = w.summaries(await w.pull(w.philipp));
    expect(water).toMatchObject({ type: 'wasser', id: first.find((summary) => summary.type === 'wasser')?.id, content: { progressPercent: 75 } });
  });

  it('liefert jeder Person nur die Zusammenfassungen über ihren Partner, einer fremden Person nichts davon', async () => {
    const w = await world();
    const others = await otherCouple(w);
    await w.drink(w.anna, 750);

    const forPhilipp = w.summaries(await w.pull(w.philipp));
    const forAnna = w.summaries(await w.pull(w.anna));
    const forStranger = await pullAll(w.backend, others.anna.device);

    expect(forPhilipp.map((summary) => [summary.ownerPersonId, summary.recipientPersonId])).toEqual([
      [w.anna.personId, w.philipp.personId],
      [w.anna.personId, w.philipp.personId],
    ]);
    expect(forAnna.every((summary) => summary.ownerPersonId === w.philipp.personId)).toBe(true);
    expect(JSON.stringify(forStranger.changes)).not.toContain(w.anna.personId);
  });

  it('enthält keine Rohdatensatz-IDs', async () => {
    const w = await world();
    await w.drink(w.anna, 750);
    const entryIds = (await w.backend.database.db.select({ id: waterEntry.id }).from(waterEntry)).map((row) => row.id);

    const serialized = JSON.stringify(await w.pull(w.philipp));

    expect(entryIds).not.toHaveLength(0);
    for (const id of entryIds) expect(serialized).not.toContain(id);
  });

  it('übernimmt eine mitten in der Woche ersetzte Planversion im nächsten Partner-Pull', async () => {
    const w = await world();
    const [before] = w.summaries(await w.pull(w.philipp)).filter((summary) => summary.type === 'sport');
    expect(before?.content).toEqual({ countedMinutes: 0, weeklyTargetMinutes: 150 });

    // Spezifikation 1 ersetzt die Fassung ab heute (Mittwoch) und invalidiert in derselben Transaktion.
    w.plans.set(w.anna.personId, { validFrom: worldToday, waterTargetMl: 1500, weeklySportTargetMinutes: 180 });
    await w.backend.database.db.transaction((tx) =>
      invalidatePartnerSummaries(tx, { type: 'plan', ownerPersonId: EntityId.parse(w.anna.personId), validFrom: today }, new Date(w.clock.read().instant)),
    );

    const after = w.summaries(await w.pull(w.philipp)).filter((summary) => summary.type === 'sport');
    expect(after).toMatchObject([{ id: before?.id, content: { countedMinutes: 0, weeklyTargetMinutes: 180 } }]);
  });

  it('hält eine künftige Planinvalidierung offen, bis ihr Tag erreicht ist', async () => {
    const w = await world();
    await w.pull(w.philipp);
    await w.backend.database.db.transaction((tx) =>
      invalidatePartnerSummaries(tx, { type: 'plan', ownerPersonId: EntityId.parse(w.anna.personId), validFrom: LocalDate.parse('2026-10-16') }, new Date(w.clock.read().instant)),
    );
    const open = () => w.backend.database.db.select().from(projectionInvalidation).where(isNull(projectionInvalidation.processedAt));

    await w.pull(w.philipp);
    expect(await open()).toHaveLength(1);

    w.clock.set(Instant.parse('2026-10-16T08:00:00.000Z'));
    await w.pull(w.philipp);
    expect(await open()).toEqual([]);
  });

  it('rechnet den aktuellen Tag in der Zeitzone der Eigentümerin, auch direkt nach einem Wechsel', async () => {
    const w = await world();
    // 22:30 UTC: in Berlin schon der 15.10., in New York noch der 14.10.
    w.clock.set(Instant.parse('2026-10-14T22:30:00.000Z'));
    const berlin = w.summaries(await w.pull(w.philipp)).find((summary) => summary.type === 'wasser');
    expect(berlin?.period).toEqual({ type: 'tag', localDate: '2026-10-15' });

    await w.backend.database.db.update(person).set({ timeZone: 'America/New_York' }).where(eq(person.id, w.anna.personId));

    const changes = await w.pull(w.philipp);
    expect(w.summaries(changes).find((summary) => summary.type === 'wasser')?.period).toEqual({ type: 'tag', localDate: '2026-10-14' });
    expect(ofType(changes, 'partner_summary')).toContainEqual(expect.objectContaining({ type: 'tombstone', entityId: berlin?.id }));
  });

  it('wechselt den Zeitraum ohne neue Eingabe und hält je Bereich genau eine Zusammenfassung', async () => {
    const w = await world();
    await w.drink(w.anna, 750);
    const before = w.summaries(await w.pull(w.philipp));

    w.clock.set(Instant.parse('2026-10-19T08:00:00.000Z'));
    const changes = await w.pull(w.philipp);

    expect(w.summaries(changes).map((summary) => [summary.type, summary.period])).toEqual(
      expect.arrayContaining([
        ['wasser', { type: 'tag', localDate: '2026-10-19' }],
        ['sport', { type: 'woche', from: '2026-10-19', to: '2026-10-25' }],
      ]),
    );
    expect(ofType(changes, 'partner_summary').filter((change) => change.type === 'tombstone').map((change) => change.entityId).sort())
      .toEqual(before.map((summary) => summary.id).sort());
    const live = await w.backend.database.db.select().from(partnerSummary).where(isNull(partnerSummary.deletedAt));
    expect(live.map((row) => row.area).sort()).toEqual(['sport', 'wasser']);
  });

  it('bestätigt einen unveränderten Stand nach 10 Minuten mit neuem dataAsOf', async () => {
    const w = await world();
    await w.drink(w.anna, 750);
    const [water] = w.summaries(await w.pull(w.philipp)).filter((summary) => summary.type === 'wasser');

    const after = (ms: number) => Instant.parse(new Date(Date.parse(worldStart.instant) + ms).toISOString());
    w.clock.set(after(dataAsOfRefreshMs - 1000));
    expect(w.summaries(await w.pull(w.philipp))).toEqual([]);

    w.clock.set(after(dataAsOfRefreshMs));
    const [confirmed] = w.summaries(await w.pull(w.philipp)).filter((summary) => summary.type === 'wasser');
    expect(confirmed).toMatchObject({ id: water?.id, generation: 1, content: water?.content, dataAsOf: after(dataAsOfRefreshMs) });
  });

  it('speichert nichts von einem Projector, der zusätzliche Werte liefert, und liefert den Rest trotzdem', async () => {
    const leaky: PartnerSummaryProjector<'wasser'> = {
      area: 'wasser',
      project: async () => ({ progressPercent: 50, amountMl: 750 }) as never,
    };
    const w = await world(() => [leaky]);

    const changes = await w.pull(w.philipp);

    expect(w.summaries(changes)).toEqual([]);
    expect(statuses(changes)).toHaveLength(1);
    expect(JSON.stringify(changes)).not.toContain('amountMl');
  });

  it('lässt nur einen Projector je Bereich zu', async () => {
    const w = await world();

    expect(() => w.backend.partnerProjections.registerProjector(trackerProjector('wasser', w.plans))).toThrow('wasser');
  });

  it('hält keine Zusammenfassung, solange der Projector noch nichts zu zeigen hat, und liefert den Rest trotzdem (#181)', async () => {
    let showing = true;
    const w = await world((plans) => {
      const water = trackerProjector('wasser', plans);
      return [{ area: 'wasser', project: async (tx, input) => (showing ? water.project(tx, input) : null) } satisfies PartnerSummaryProjector<'wasser'>];
    });
    await w.drink(w.anna, 750);
    const [shown] = w.summaries(await w.pull(w.philipp));

    showing = false;
    await w.drink(w.anna, 375);
    const hidden = await w.pull(w.philipp);

    expect(ofType(hidden, 'partner_summary')).toEqual([expect.objectContaining({ type: 'tombstone', entityId: shown?.id })]);
    expect(await w.backend.database.db.select().from(partnerSummary).where(isNull(partnerSummary.deletedAt))).toEqual([]);
    expect(w.summaries(await w.pull(w.philipp))).toEqual([]);

    showing = true;
    await w.drink(w.anna, 375);
    const [again] = w.summaries(await w.pull(w.philipp));
    expect(again).toMatchObject({ type: 'wasser', content: { progressPercent: 100 }, generation: 2 });
    expect(again?.id).not.toBe(shown?.id);
  });
});

describe('Freigaben', () => {
  it('Abschalten widerruft die Zusammenfassung in derselben Transaktion; erneutes Freigeben erzeugt eine neue ID und Generation', async () => {
    const w = await world();
    await w.drink(w.anna, 750);
    const [water] = w.summaries(await w.pull(w.philipp)).filter((summary) => summary.type === 'wasser');

    await w.setSharing(w.anna, 'wasser', 'privat');
    const revoked = await w.pull(w.philipp);

    expect(ofType(revoked, 'partner_summary')).toEqual([expect.objectContaining({ type: 'tombstone', entityId: water?.id })]);
    expect(notices(revoked)).toEqual([
      expect.objectContaining({ recipientPersonId: w.philipp.personId, couplingId: w.couplingId, target: { type: 'partner_summary', projectionId: water?.id }, reason: 'freigabe_entzogen' }),
    ]);

    await w.setSharing(w.anna, 'wasser', 'zusammengefasst');
    const [again] = w.summaries(await w.pull(w.philipp)).filter((summary) => summary.type === 'wasser');

    expect(again).toMatchObject({ generation: 2, content: { progressPercent: 50 } });
    expect(again?.id).not.toBe(water?.id);
    const [old] = await w.backend.database.db.select().from(partnerSummary).where(eq(partnerSummary.id, water!.id));
    expect(old?.deletedAt).not.toBeNull();
  });

  it('entsteht nur für Bereiche mit Freigabestufe `zusammengefasst`', async () => {
    const w = await world();
    await w.setSharing(w.anna, 'sport', 'privat');

    expect(w.summaries(await w.pull(w.philipp)).map((summary) => summary.type)).toEqual(['wasser']);
  });

  it('schreibt jede Änderung einer Partner- oder Fotofreigabe ins Sicherheitslog, ohne Werte', async () => {
    const w = await world();
    await w.setSharing(w.anna, 'gewicht', 'privat');
    await w.setSharing(w.anna, 'gewicht', 'privat');
    await w.setSharing(w.anna, 'fotos', 'privat');

    const entries = (await securityLogEntries(w.backend)).filter((entry) => entry.eventType === 'freigabeaenderung');

    expect(entries.map((entry) => entry.details)).toEqual([
      { accountId: w.anna.accountId, couplingId: w.couplingId, scope: 'gewicht', level: 'privat' },
      { accountId: w.anna.accountId, couplingId: w.couplingId, scope: 'fotos', level: 'privat' },
    ]);
  });

  it('sind Upsert-Entitäten mit Last-Write-Wins, die nur die Eigentümerin liest und schreibt', async () => {
    const w = await world();
    const id = await sharingId(w, w.anna, 'wasser');
    await w.setSharing(w.anna, 'wasser', 'privat');
    await w.setSharing(w.anna, 'wasser', 'zusammengefasst');

    const own = (await w.pull(w.anna)).filter((change) => change.entityType === 'partner_sharing');
    expect(own).toEqual([expect.objectContaining({ type: 'record', entityId: id, data: expect.objectContaining({ area: 'wasser', level: 'zusammengefasst' }) })]);

    const [byPartner] = await push(w.backend, w.philipp.device, [upsertOp(id, { level: 'privat' }, { entityType: 'partner_sharing' })]);
    expect(byPartner).toMatchObject({ type: 'permanently_rejected', error: { code: 'forbidden' }, canonical: { type: 'absent' } });
    expect(JSON.stringify(await w.pull(w.philipp))).not.toContain(id);
  });

  it('weist eine Nutzlast mit Eigentums-, Kopplungs- oder Bereichsfeld ab', async () => {
    const w = await world();
    const id = await sharingId(w, w.anna, 'wasser');

    const results = await push(w.backend, w.anna.device, [
      upsertOp(id, { level: 'privat', area: 'gewicht' }, { entityType: 'partner_sharing' }),
      upsertOp(id, { level: 'privat', couplingId: w.couplingId }, { entityType: 'partner_sharing' }),
    ]);

    expect(results.map((result) => result.type)).toEqual(['permanently_rejected', 'permanently_rejected']);
    expect(w.summaries(await w.pull(w.philipp)).map((summary) => summary.type)).toContain('wasser');
  });
});

describe('Entkopplung', () => {
  it('beendet den Inhaltszugriff sofort und adressiert inhaltsfreie Notices an beide früheren Empfänger', async () => {
    const w = await world();
    await w.drink(w.anna, 750);
    const before = await w.pull(w.philipp);
    await w.pull(w.anna);
    const projectionIds = [...w.summaries(before).map((summary) => summary.id), ...statuses(before).map((status) => status.id)];

    await uncouple(w);
    const forPhilipp = await w.pull(w.philipp);
    const forAnna = await w.pull(w.anna);

    expect(ofType(forPhilipp, 'partner_summary').every((change) => change.type === 'tombstone')).toBe(true);
    expect(forPhilipp.filter((change) => change.type === 'tombstone').map((change) => change.entityId)).toEqual(expect.arrayContaining(projectionIds));
    for (const [who, changes] of [[w.philipp, forPhilipp], [w.anna, forAnna]] as const) {
      expect(notices(changes)).toEqual([expect.objectContaining({ recipientPersonId: who.personId, target: { type: 'kopplung' }, reason: 'entkopplung' })]);
    }
    const live = await w.backend.database.db.select().from(partnerDailyGoalStatus).where(isNull(partnerDailyGoalStatus.deletedAt));
    expect(live).toEqual([]);
  });

  it('materialisiert danach nichts mehr, der Notice-Feed bleibt aber für frühere Empfänger lesbar', async () => {
    const w = await world();
    await w.pull(w.philipp);
    await uncouple(w);
    await w.drink(w.anna, 750);
    await completeGoals(w, w.anna, 1);

    const full = await pullAll(w.backend, w.philipp.device);

    expect(full.changes.filter((change) => change.type === 'record' && change.entityType.startsWith('partner_'))).toEqual([]);
    expect(notices(full.changes)).toHaveLength(1);
  });
});

describe('Nebenläufigkeit', () => {
  it('eine committete Projektion liegt vollständig im aktuellen Snapshot oder vollständig im nächsten Pull', async () => {
    let release: () => void = () => {};
    let entered: () => void = () => {};
    const inside = new Promise<void>((resolve) => (entered = resolve));
    const gate = new Promise<void>((resolve) => (release = resolve));
    let blocking = true;
    const w = await world((plans) => {
      const water = trackerProjector('wasser', plans);
      return [{
        area: 'wasser',
        // Rechnet zuerst und hängt dann, bevor das Fundament speichert.
        async project(tx, input) {
          const content = await water.project(tx, input);
          if (blocking) {
            blocking = false;
            entered();
            await gate;
          }
          return content;
        },
      } satisfies PartnerSummaryProjector<'wasser'>];
    });
    await w.drink(w.anna, 300);

    // Der Pull hängt in der Projektionsaktualisierung, während Anna schreibt und committet.
    const pulling = w.pull(w.philipp);
    await inside;
    await w.drink(w.anna, 450);
    release();
    const first = w.summaries(await pulling);
    const second = w.summaries(await w.pull(w.philipp));

    // Der Snapshot enthält die committete Projektion vollständig; Annas Schreiben kommt vollständig im nächsten Pull.
    expect(first).toMatchObject([{ type: 'wasser', content: { progressPercent: 20 } }]);
    expect(second).toMatchObject([{ type: 'wasser', id: first[0]?.id, content: { progressPercent: 50 } }]);
    expect(BigInt(second[0]!.serverVersion)).toBeGreaterThan(BigInt(first[0]!.serverVersion));
    expect(await w.backend.database.db.select().from(projectionInvalidation).where(isNull(projectionInvalidation.processedAt))).toEqual([]);
  });

  it('legt bei zwei gleichzeitigen Pulls desselben Empfängers jede Projektion nur einmal an', async () => {
    const w = await world();
    await w.drink(w.anna, 750);

    const [a, b] = await Promise.all([pullAll(w.backend, w.philipp.device), pullAll(w.backend, w.philipp.device)]);

    expect(w.summaries(a.changes).length + w.summaries(b.changes).length).toBeGreaterThanOrEqual(2);
    const rows = await w.backend.database.db.select().from(partnerSummary);
    expect(rows.map((row) => row.area).sort()).toEqual(['sport', 'wasser']);
  });
});

// Wasser, Sport und Gewicht laufen mit ihren echten Projectors in `tracker-partner-summaries.test.ts` durchs Kit.
describe('Konformitäts-Testkit mit dem Test-Projector für Ernährung', () => {
  for (const { name, run } of partnerProjectorConformanceCases('ernaehrung', { projector: () => testNutritionProjector(), record: testRecorders.ernaehrung })) it(name, run);
});
