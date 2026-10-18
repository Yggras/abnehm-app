import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { EntityId } from '@abnehm/contracts/base';

import { waterEntry } from '../src/db/schema/index.ts';
import { nextServerVersion, recordChange } from '../src/sync/change-log.ts';
import { createTestBackend } from './support/app.ts';
import { personWithSession } from './support/authorization.ts';
import { deleteOp, installationB, pullAll, pullPage, pullRaw, push, testWaterEntity, upsertOp, water } from './support/sync.ts';

// Pull über die echte Hono-App mit Postgres (Spezifikation 0, Abschnitt 10; #99): vollständiger Pull,
// Cursor, Seiten mit fester Obergrenze bei gleichzeitigem Schreiben, Löschmarkierungen, Sichtbarkeit,
// Seitentoken und Installationskennung als bloße Sync-Metadaten sowie Vor-Pull-Schritte.

async function setup(options: { syncPullPageSize?: number } = {}) {
  const backend = await createTestBackend(options);
  backend.sync.registerEntity(testWaterEntity);
  const anna = await personWithSession(backend, 'anna@example.test', 'Anna');
  return { backend, anna };
}

const ids = (changes: { entityType: string; entityId: string }[]) => changes.map((change) => `${change.entityType}:${change.entityId}`);

describe('Pull', () => {
  it('liefert ohne Cursor alles Eigene, danach ab dem Cursor nur Neues', async () => {
    const { backend, anna } = await setup();
    const [a, b] = [randomUUID(), randomUUID()];
    await push(backend, anna.device, [upsertOp(a, water(250)), upsertOp(b, water(300))]);

    const full = await pullAll(backend, anna.device);
    expect(ids(full.changes)).toEqual([`person:${anna.personId}`, `water_entry:${a}`, `water_entry:${b}`]);
    expect(full.changes[0]).toMatchObject({ type: 'record', data: { displayName: 'Anna', timeZone: 'Europe/Berlin', accountId: anna.accountId } });

    await push(backend, anna.device, [upsertOp(a, water(400)), deleteOp(b)]);
    const next = await pullAll(backend, anna.device, full.cursor);
    expect(next.changes).toEqual([
      expect.objectContaining({ type: 'record', entityId: a, data: expect.objectContaining({ amountMl: 400 }) }),
      expect.objectContaining({ type: 'tombstone', entityId: b }),
    ]);
    expect(BigInt(next.cursor)).toBeGreaterThan(BigInt(full.cursor));
    expect((await pullAll(backend, anna.device, next.cursor)).changes).toEqual([]);
  });

  it('liest mehrere Seiten bis zur festen Obergrenze; gleichzeitige Änderungen kommen vollständig im nächsten Pull', async () => {
    const { backend, anna } = await setup({ syncPullPageSize: 2 });
    const entries = Array.from({ length: 5 }, () => randomUUID());
    await push(
      backend,
      anna.device,
      entries.map((id, index) => upsertOp(id, water(100 + index))),
    );

    const first = await pullPage(backend, anna.device);
    expect(first.next.type).toBe('page');
    // Während des Pulls: ein neuer Eintrag und eine Änderung an einem Eintrag der späteren Seiten.
    const late = randomUUID();
    await push(backend, anna.device, [upsertOp(late, water(900)), upsertOp(entries[4]!, water(999))]);

    const changes = [...first.changes];
    let next = first.next;
    let pages = 1;
    while (next.type === 'page') {
      const page = await pullPage(backend, anna.device, { pageToken: next.pageToken });
      changes.push(...page.changes);
      next = page.next;
      pages++;
    }
    expect(pages).toBe(3);
    // Der geänderte Eintrag liegt jetzt oberhalb der Obergrenze und kommt nicht in seinem alten Stand.
    expect(ids(changes)).toEqual([`person:${anna.personId}`, ...entries.slice(0, 4).map((id) => `water_entry:${id}`)]);
    if (next.type !== 'complete') throw new Error('Pull nicht abgeschlossen');

    const following = await pullAll(backend, anna.device, next.cursor);
    expect(following.changes.map((change) => [change.entityId, change.type === 'record' && change.data.amountMl])).toEqual([
      [late, 900],
      [entries[4], 999],
    ]);
  });

  it('zeigt Änderungen anderer Personen nie, auch nicht mit fremder Installationskennung', async () => {
    const { backend, anna } = await setup();
    const philipp = await personWithSession(backend, 'philipp@example.test', 'Philipp');
    const foreign = randomUUID();
    await push(backend, philipp.device, [upsertOp(foreign, water(250))], installationB);

    const own = await pullAll(backend, anna.device);
    expect(ids(own.changes)).toEqual([`person:${anna.personId}`]);
    const withForeignInstallation = await pullRaw(backend, anna.device, { installationId: installationB });
    expect(withForeignInstallation.status).toBe(200);
    expect(JSON.stringify(withForeignInstallation.body)).not.toContain(foreign);
    expect(JSON.stringify(withForeignInstallation.body)).not.toContain(philipp.personId);
  });

  it('bindet das Seitentoken an die Person und lässt es nie Zugriff begründen', async () => {
    const { backend, anna } = await setup({ syncPullPageSize: 1 });
    const philipp = await personWithSession(backend, 'philipp@example.test', 'Philipp');
    const foreign = randomUUID();
    await push(backend, philipp.device, [upsertOp(foreign, water(250))]);
    await push(backend, anna.device, [upsertOp(randomUUID(), water(300))]);
    const page = await pullPage(backend, anna.device);
    if (page.next.type !== 'page') throw new Error('Erwartet eine weitere Seite');
    const [, , upper] = page.next.pageToken.split('.');

    // Annas Token in Philipps Sitzung, ein Token mit Obergrenze in der Zukunft und eines ab Position 0.
    expect((await pullRaw(backend, philipp.device, { pageToken: page.next.pageToken })).body).toEqual({ code: 'invalid_payload', retryable: false });
    const future = `v1.${anna.personId}.${BigInt(upper!) + 100n}.0`;
    expect(await pullRaw(backend, anna.device, { pageToken: future })).toMatchObject({ status: 400, body: { code: 'invalid_payload' } });
    const fromStart = await pullAll(backend, anna.device);
    const forged = await pullRaw(backend, anna.device, { pageToken: `v1.${anna.personId}.${upper}.0` });
    expect(forged.status).toBe(200);
    expect(JSON.stringify(forged.body)).not.toContain(foreign);
    expect(JSON.stringify(fromStart.changes)).not.toContain(foreign);
  });

  it('verlangt einen vollständigen Pull, wenn der Cursor jenseits der Sync-Clock liegt', async () => {
    const { backend, anna } = await setup();
    const reply = await pullRaw(backend, anna.device, { cursor: '999999' });
    expect(reply).toMatchObject({ status: 409, body: { code: 'full_resync_required', retryable: false } });
  });

  it('führt Vor-Pull-Schritte in eigener Transaktion aus; ihre Änderung kommt im selben Pull an', async () => {
    const { backend, anna } = await setup();
    const { cursor } = await pullAll(backend, anna.device);
    const stepEntry = EntityId.parse(randomUUID());
    const calls: unknown[] = [];
    backend.sync.registerPrePullStep('test_schritt', async (tx, context) => {
      calls.push(context);
      // Idempotent: nur beim ersten Lauf ein Eintrag.
      const [existing] = await tx.select().from(waterEntry).where(eq(waterEntry.id, stepEntry));
      if (existing !== undefined) return;
      const position = await nextServerVersion(tx);
      const at = new Date(context.now);
      await testWaterEntity.write(tx, { entityId: stepEntry, payload: water(150), ownerPersonId: context.personId, exists: false, serverVersion: position, at });
      await recordChange(tx, { position, entityType: 'water_entry', entityId: stepEntry, operation: 'upsert', ownerPersonId: context.personId, createdAt: at });
    });

    const pulled = await pullAll(backend, anna.device, cursor);
    expect(ids(pulled.changes)).toEqual([`water_entry:${stepEntry}`]);
    expect(calls).toEqual([{ personId: anna.personId, now: expect.any(String) }]);
    expect((await pullAll(backend, anna.device, pulled.cursor)).changes).toEqual([]);
  });

  it('meldet eine Änderung ohne angemeldete Entität als Fehler statt sie still auszulassen', async () => {
    const backend = await createTestBackend();
    const anna = await personWithSession(backend, 'anna@example.test', 'Anna');
    const id = randomUUID();
    // Ohne angemeldete Test-Entität: direkt geschriebener Eintrag samt Änderungsprotokoll.
    await backend.database.db.transaction(async (tx) => {
      const position = await nextServerVersion(tx);
      const at = new Date('2026-10-14T12:00:00.000Z');
      await testWaterEntity.write(tx, { entityId: EntityId.parse(id), payload: water(150), ownerPersonId: EntityId.parse(anna.personId), exists: false, serverVersion: position, at });
      await recordChange(tx, { position, entityType: 'water_entry', entityId: id, operation: 'upsert', ownerPersonId: anna.personId, createdAt: at });
    });
    expect((await pullRaw(backend, anna.device)).status).toBe(503);
  });
});
