import { randomUUID } from 'node:crypto';

import { and, eq, isNotNull } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { Instant, type AreaKey, type SyncCursor } from '@abnehm/contracts/base';
import { PartnerSummaryEnvelope, RevocationNotice } from '@abnehm/contracts/partner';
import type { CanonicalChange } from '@abnehm/contracts/sync';

import { projectionInvalidation } from '../src/db/schema/index.ts';
import { coupledWorld, sharingId, worldToday, type CoupledWorld } from './support/coupled-world.ts';
import { goalVersionOp, weeklyPlanOp } from './support/plan.ts';
import { deleteOp, pullAll, push, upsertOp } from './support/sync.ts';

// Nachweis für #181 über Postgres und die echte Hono-App: Anna pusht Wasser-, Sport- und Gewichtseinträge
// wie die App, der Server invalidiert bei der Push-Annahme, und Philipp sieht nach seinem Pull Annas
// Zusammenfassungen aus den echten Projectors mit dem Postgres-`PlanReader` (Wasserziel 1500 ml,
// Sportwochenziel 150 min aus der Referenz-Zielversion ab heute).

type World = CoupledWorld & {
  /** Annas Operationen; jede muss angenommen werden. */
  annaPushes(...operations: Parameters<typeof push>[2]): Promise<void>;
  /** Philipps Pull ab seinem letzten Cursor: Annas Zusammenfassungen und alle Änderungen. */
  philippPulls(): Promise<{ changes: CanonicalChange[]; summaries: Map<AreaKey, PartnerSummaryEnvelope> }>;
  setAnnasSharing(area: AreaKey, level: 'privat' | 'zusammengefasst'): Promise<void>;
  at(instant: string): void;
};

async function world(): Promise<World> {
  const base = await coupledWorld();
  const annaPushes: World['annaPushes'] = async (...operations) => {
    const results = await push(base.backend, base.anna.device, operations);
    expect(results.map((result) => result.type)).toEqual(operations.map(() => 'applied'));
  };
  await annaPushes(goalVersionOp(base.anna.personId), weeklyPlanOp(base.anna.personId));
  let cursor: SyncCursor | null = null;
  return {
    ...base,
    annaPushes,
    async philippPulls() {
      const pulled = await pullAll(base.backend, base.philipp.device, cursor);
      cursor = pulled.cursor;
      const summaries = new Map<AreaKey, PartnerSummaryEnvelope>();
      for (const change of pulled.changes) {
        if (change.type === 'record' && change.entityType === 'partner_summary') {
          const summary = PartnerSummaryEnvelope.parse(change.data);
          expect(summary.ownerPersonId).toBe(base.anna.personId);
          summaries.set(summary.type, summary);
        }
      }
      return { changes: pulled.changes, summaries };
    },
    async setAnnasSharing(area, level) {
      await annaPushes(upsertOp(await sharingId(base, base.anna, area), { level }, { entityType: 'partner_sharing' }));
    },
    at(instant) {
      base.clock.set(Instant.parse(instant));
    },
  };
}

/** Tag, Zone und Offset eines Eintrags in Berlin; ab dem 25.10.2026 gilt Winterzeit. */
const berlin = (localDate: string) => ({ localDate, timeZone: 'Europe/Berlin', utcOffsetMinutes: localDate >= '2026-10-25' ? 60 : 120 });
const day = (offset: number) => new Date(Date.parse(`${worldToday}T00:00:00.000Z`) + offset * 86_400_000).toISOString().slice(0, 10);

const water = (id: string, amountMl: number, localDate = worldToday) =>
  upsertOp(id, { amountMl, origin: 'manuell', loggedAt: `${localDate}T08:00:00.000Z`, ...berlin(localDate) }, { entityType: 'water_entry' });

const manualSport = (id: string, localDate: string, minutes: number, { replacedBy = null as string | null, reactivatedAt = null as string | null } = {}) =>
  upsertOp(id, { activityType: 'laufen', startedAt: `${localDate}T16:00:00.000Z`, durationMinutes: minutes, activeMilliKcal: null, origin: 'manuell',
    replacedByEntryId: replacedBy, reactivatedAt, ...berlin(localDate) }, { entityType: 'sport_entry' });

const importedSport = (id: string, localDate: string, minutes: number, { hiddenAt = null as string | null } = {}) =>
  upsertOp(id, { activityType: 'radfahren', overrideActivityType: null, startedAt: `${localDate}T15:55:00.000Z`, durationMinutes: minutes,
    activeMilliKcal: 310_000, origin: 'health_connect', externalKey: `workout-${id}`, sourceAppId: 'com.fitbit.FitbitMobile', sourceAppName: 'Fitbit',
    hiddenAt, ...berlin(localDate) }, { entityType: 'sport_entry' });

const importedWeight = (id: string, localDate: string, weightG: number, { time = '05:30', hiddenAt = null as string | null } = {}) =>
  upsertOp(id, { weightG, measuredAt: `${localDate}T${time}:00.000Z`, origin: 'health_connect', externalKey: `weight-${id}`,
    sourceAppId: 'com.fitbit.FitbitMobile', sourceAppName: 'Fitbit', hiddenAt, ...berlin(localDate) }, { entityType: 'weight_entry' });

const manualWeight = (id: string, localDate: string, weightG: number, time = '05:30') =>
  upsertOp(id, { weightG, measuredAt: `${localDate}T${time}:00.000Z`, origin: 'manuell', ...berlin(localDate) }, { entityType: 'weight_entry' });

const tombstones = (changes: readonly CanonicalChange[]) =>
  changes.filter((change) => change.type === 'tombstone' && change.entityType === 'partner_summary').map((change) => change.entityId);

describe('Partner-Zusammenfassungen Wasser, Sport und Gewicht (#181)', () => {
  it('ohne Daten: 0 % Wasser, 0 Minuten zum Wochenziel, Gewicht noch nicht verfügbar', async () => {
    const w = await world();

    const { summaries } = await w.philippPulls();

    expect(summaries.get('wasser')).toMatchObject({ period: { type: 'tag', localDate: worldToday }, content: { progressPercent: 0 } });
    expect(summaries.get('sport')).toMatchObject({ period: { type: 'woche', from: '2026-10-12', to: '2026-10-18' }, content: { countedMinutes: 0, weeklyTargetMinutes: 150 } });
    expect(summaries.get('gewicht')).toMatchObject({ period: { type: 'vierzehn_tage', from: '2026-10-01', to: worldToday },
      content: { changeKg: null, direction: 'noch_nicht_verfuegbar' } });
  });

  it('Wasser: Anlegen, Ändern, Verschieben und Löschen kommen beim nächsten Pull an; über dem Ziel bei 100 % gedeckelt', async () => {
    const w = await world();
    const [first, second] = [randomUUID(), randomUUID()];
    const progress = async () => (await w.philippPulls()).summaries.get('wasser')?.content;

    await w.annaPushes(water(first, 750));
    expect(await progress()).toEqual({ progressPercent: 50 });
    await w.annaPushes(water(second, 1500));
    expect(await progress()).toEqual({ progressPercent: 100 });
    await w.annaPushes(water(second, 300));
    expect(await progress()).toEqual({ progressPercent: 70 });
    await w.annaPushes(water(first, 750, day(-1)));
    expect(await progress()).toEqual({ progressPercent: 20 });
    await w.annaPushes(deleteOp(second, { entityType: 'water_entry' }));
    expect(await progress()).toEqual({ progressPercent: 0 });
  });

  it('invalidiert bei der Push-Annahme den Tag vor und nach der Änderung, in derselben Transaktion', async () => {
    const w = await world();
    const entry = randomUUID();
    // Ohne Bereich sind es die Planinvalidierungen der Zielversion und des Wochenplans aus `world`.
    const invalidations = async () => (await w.backend.database.db
      .select({ area: projectionInvalidation.area, fromDate: projectionInvalidation.fromDate })
      .from(projectionInvalidation)
      .where(and(eq(projectionInvalidation.ownerPersonId, w.anna.personId), isNotNull(projectionInvalidation.area))))
      .map(({ area, fromDate }) => `${area} ${fromDate}`)
      .sort();

    // Anlegen (heute), Verschieben auf gestern (heute und gestern), Löschen (gestern).
    await w.annaPushes(water(entry, 500), water(entry, 500, day(-1)), deleteOp(entry, { entityType: 'water_entry' }));
    await w.annaPushes(manualSport(randomUUID(), worldToday, 30), manualWeight(randomUUID(), worldToday, 80_000));

    expect(await invalidations()).toEqual([
      `gewicht ${worldToday}`,
      `sport ${worldToday}`,
      `wasser ${day(-1)}`,
      `wasser ${day(-1)}`,
      `wasser ${worldToday}`,
      `wasser ${worldToday}`,
    ]);
  });

  it('Sport: ausgeblendete Importe und ersetzte Einheiten zählen nicht; Ausblenden, Einblenden und Reaktivieren kommen an', async () => {
    const w = await world();
    const [monday, workout, replaced, hiddenToday] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    const minutes = async () => (await w.philippPulls()).summaries.get('sport')?.content;

    await w.annaPushes(
      manualSport(monday, day(-2), 30),
      importedSport(workout, day(-1), 45),
      manualSport(replaced, day(-1), 40, { replacedBy: workout }),
      importedSport(hiddenToday, worldToday, 25, { hiddenAt: '2026-10-14T09:00:00.000Z' }),
    );
    expect(await minutes()).toEqual({ countedMinutes: 30 + 45, weeklyTargetMinutes: 150 });

    // Ausgeblendet zählt der Import nicht mehr, dafür wieder die von ihm ersetzte Einheit.
    await w.annaPushes(importedSport(workout, day(-1), 45, { hiddenAt: '2026-10-14T10:00:00.000Z' }));
    expect(await minutes()).toEqual({ countedMinutes: 30 + 40, weeklyTargetMinutes: 150 });

    await w.annaPushes(importedSport(workout, day(-1), 45));
    expect(await minutes()).toEqual({ countedMinutes: 30 + 45, weeklyTargetMinutes: 150 });

    await w.annaPushes(manualSport(replaced, day(-1), 40, { replacedBy: workout, reactivatedAt: '2026-10-14T10:30:00.000Z' }));
    expect(await minutes()).toEqual({ countedMinutes: 30 + 45 + 40, weeklyTargetMinutes: 150 });
  });

  it('Sport: die Woche endet am Sonntag um Mitternacht in der Zeitzone der Eigentümerin und wechselt ohne neue Eingabe', async () => {
    const w = await world();
    await w.annaPushes(manualSport(randomUUID(), '2026-10-18', 50), manualSport(randomUUID(), '2026-10-19', 20));

    // 21:30 UTC ist in Berlin Sonntag, 23:30.
    w.at('2026-10-18T21:30:00.000Z');
    const sunday = (await w.philippPulls()).summaries.get('sport');
    expect(sunday).toMatchObject({ period: { from: '2026-10-12', to: '2026-10-18' }, content: { countedMinutes: 50 } });

    // 22:30 UTC ist in Berlin schon Montag, in UTC noch Sonntag.
    w.at('2026-10-18T22:30:00.000Z');
    const pulled = await w.philippPulls();
    expect(pulled.summaries.get('sport')).toMatchObject({ period: { from: '2026-10-19', to: '2026-10-25' }, content: { countedMinutes: 20, weeklyTargetMinutes: 150 } });
    expect(tombstones(pulled.changes)).toContain(sunday?.id);
  });

  it('Wasser wechselt ohne neue Eingabe zum neuen Tag, Gewicht in den neuen 14-Tage-Zeitraum', async () => {
    const w = await world();
    await w.annaPushes(
      water(randomUUID(), 750),
      ...[[-10, 80_000], [-5, 79_600], [0, 79_200]].map(([offset, weightG]) => manualWeight(randomUUID(), day(offset!), weightG!)),
    );
    const today = await w.philippPulls();
    expect(today.summaries.get('wasser')?.content).toEqual({ progressPercent: 50 });
    expect(today.summaries.get('gewicht')?.content).toMatchObject({ direction: 'sinkend' });

    w.at('2026-10-15T06:00:00.000Z');
    const tomorrow = await w.philippPulls();
    expect(tomorrow.summaries.get('wasser')).toMatchObject({ period: { type: 'tag', localDate: '2026-10-15' }, content: { progressPercent: 0 } });
    expect(tombstones(tomorrow.changes)).toContain(today.summaries.get('wasser')?.id);

    // 14 Tage nach der letzten Messung liegt kein Tagesgewicht mehr im Zeitraum D − 13 bis D.
    w.at('2026-10-28T08:00:00.000Z');
    const later = await w.philippPulls();
    expect(later.summaries.get('gewicht')).toMatchObject({ period: { type: 'vierzehn_tage', from: '2026-10-15', to: '2026-10-28' },
      content: { changeKg: null, direction: 'noch_nicht_verfuegbar' } });
  });

  it('Gewicht: zählt Importe, aber keine ausgeblendeten und je Tag nur die früheste Messung; die Zusammenfassung enthält kein absolutes Gewicht und keinen Rohdatensatz', async () => {
    const w = await world();
    const entries = {
      d16: { id: randomUUID(), localDate: day(-16), weightG: 80_013 },
      d14: { id: randomUUID(), localDate: day(-14), weightG: 80_027 },
      d7: { id: randomUUID(), localDate: day(-7), weightG: 79_041 },
      hidden: { id: randomUUID(), localDate: day(-7), weightG: 61_234 },
      today: { id: randomUUID(), localDate: worldToday, weightG: 78_519 },
      laterToday: { id: randomUUID(), localDate: worldToday, weightG: 71_111 },
    };
    await w.annaPushes(
      importedWeight(entries.d16.id, entries.d16.localDate, entries.d16.weightG),
      importedWeight(entries.d14.id, entries.d14.localDate, entries.d14.weightG),
      importedWeight(entries.d7.id, entries.d7.localDate, entries.d7.weightG),
      importedWeight(entries.hidden.id, entries.hidden.localDate, entries.hidden.weightG, { hiddenAt: '2026-10-14T09:00:00.000Z' }),
      importedWeight(entries.today.id, entries.today.localDate, entries.today.weightG, { time: '04:00' }),
      importedWeight(entries.laterToday.id, entries.laterToday.localDate, entries.laterToday.weightG, { time: '17:00' }),
    );

    const { changes, summaries } = await w.philippPulls();

    // Trend (gerundet) 80 013 → 80 016 (D − 14) → 79 507 → 78 992 (D); 78 992 − 80 016 = −1 024 g → −1,0 kg.
    const weight = summaries.get('gewicht');
    expect(weight?.content).toEqual({ changeKg: -1, direction: 'sinkend' });
    expect(Object.keys(weight?.content ?? {}).sort()).toEqual(['changeKg', 'direction']);
    // Alles im Pull außer Philipps eigener Person betrifft Anna.
    const serialized = JSON.stringify(changes.filter((change) => !(change.entityType === 'person' && change.entityId === w.philipp.personId)));
    for (const entry of Object.values(entries)) {
      expect(serialized).not.toContain(entry.id);
      expect(serialized).not.toContain(String(entry.weightG));
    }
    // Weder Gewichte in kg mit Nachkommastelle noch Trendwerte, Zielgewicht oder Felder eines Rohdatensatzes.
    for (const forbidden of ['78.5', '71.1', '61.2', '80016', '79507', '78992', '79.5', 'weightG', 'trend', 'goalWeight', 'measuredAt', 'externalKey', 'sourceApp']) {
      expect(serialized, forbidden).not.toContain(forbidden);
    }
  });

  it('Entzug der Freigabe widerruft die Zusammenfassung; danach entsteht ohne Freigabe keine neue', async () => {
    const w = await world();
    await w.annaPushes(...[[-10, 80_000], [-5, 79_600], [0, 79_200]].map(([offset, weightG]) => manualWeight(randomUUID(), day(offset!), weightG!)));
    const shared = (await w.philippPulls()).summaries.get('gewicht');
    expect(shared?.content).toMatchObject({ direction: 'sinkend' });

    await w.setAnnasSharing('gewicht', 'privat');
    const revoked = await w.philippPulls();
    expect(tombstones(revoked.changes)).toEqual([shared?.id]);
    expect(revoked.changes.flatMap((change) => (change.type === 'record' && change.entityType === 'revocation_notice' ? [RevocationNotice.parse(change.data)] : [])))
      .toEqual([expect.objectContaining({ target: { type: 'partner_summary', projectionId: shared?.id }, reason: 'freigabe_entzogen' })]);

    await w.annaPushes(manualWeight(randomUUID(), day(0), 78_800, '18:00'));
    expect((await w.philippPulls()).summaries.has('gewicht')).toBe(false);

    await w.setAnnasSharing('gewicht', 'zusammengefasst');
    const again = (await w.philippPulls()).summaries.get('gewicht');
    expect(again).toMatchObject({ generation: 2, content: { direction: 'sinkend' } });
    expect(again?.id).not.toBe(shared?.id);
  });
});
