import { describe, expect, it } from 'vitest';

import { seedIds, seedManifests, type SeedRow } from '@abnehm/contracts/seeds';

import { dumpLocalDatabase } from '../../mobile/src/test-capabilities/seed/local-seed.ts';
import { dumpServer } from '../dev/seed/server-seed.ts';
import { runSteps, seeded, type SeedPhone } from './support/seed-world.ts';

// Nachweis für #116, fachlich: Was in den Mehrgeräte- und Sync-Szenarien tatsächlich passiert. Die Geräte
// pushen und pullen gegen die echte Hono-App; dieser Test zeigt an den Antworten des Servers und an den
// Gerätedaten, welche Operation wie endet und wer gewinnt. Ausgangs- und Sollzustand sowie wiederholtes
// Seeden prüft für jedes Manifest `seed-manifeste-app.test.ts`.

const iphone = 'philipp-iphone';
const ipad = 'philipp-ipad';
const ops = seedIds.operation;

const rowsOf = (phone: SeedPhone, table: string): SeedRow[] => dumpLocalDatabase(phone.database).rows[table] ?? [];
const rowOf = (rows: readonly SeedRow[] = [], id: string) => rows.find((row) => row.id === id);
const resultOf = (phone: SeedPhone, operationId: string) => phone.pushResults().find((result) => result.operationId === operationId);

describe('Szenario zwei_installationen', () => {
  it('beide Geräte erfüllen offline dasselbe Wasserziel: genau eine Erfüllung samt +1, das iPad ersetzt sein Duplikat', async () => {
    const world = await seeded(seedManifests.zwei_installationen);
    const { phones } = world;
    await runSteps(world);

    expect(resultOf(phones[iphone]!, ops.zweiInstallationen.iphone.erfuellung)).toMatchObject({ type: 'applied' });
    expect(resultOf(phones[ipad]!, ops.zweiInstallationen.ipad.erfuellung)).toMatchObject({ type: 'already_applied' });

    const server = await dumpServer(world.backend.database.db);
    expect(server.daily_goal_completion).toHaveLength(1);
    expect(server.daily_goal_completion![0]).toMatchObject({ slot: 2, baustein: 'wasserziel', first_completed_at: '2026-10-14T11:40:00.000Z' });
    expect(server.energy_booking).toHaveLength(1);
    for (const phone of [phones[iphone]!, phones[ipad]!]) {
      // Das iPad hatte um 11:50 erfüllt; es übernimmt den zuerst angenommenen Zeitpunkt des iPhones.
      expect(rowsOf(phone, 'daily_goal_completion')).toEqual(server.daily_goal_completion);
      expect(rowsOf(phone, 'energy_booking').reduce((sum, row) => sum + Number(row.amount), 0)).toBe(1);
    }
  });

  it('konkurrierende Gewichtskorrektur: Die später eingegangene des iPads gilt überall, obwohl sie auf dem Gerät früher entstand', async () => {
    const world = await seeded(seedManifests.zwei_installationen);
    const { phones } = world;
    await runSteps(world);

    const id = seedIds.weightEntry.philippGestern;
    const server = rowOf((await dumpServer(world.backend.database.db)).weight_entry, id);
    expect(server).toMatchObject({ weight_g: 91_700 });
    expect(rowOf(rowsOf(phones[iphone]!, 'weight_entry'), id)).toEqual(server);
    expect(rowOf(rowsOf(phones[ipad]!, 'weight_entry'), id)).toEqual(server);
    // Beide Offline-Wassereinträge zählen: 2000 ml vom Server und je 500 ml von beiden Geräten.
    const water = rowsOf(phones[iphone]!, 'water_entry').filter((row) => row.local_date === '2026-10-14' && row.deleted_at === null);
    expect(water.reduce((sum, row) => sum + Number(row.amount_ml), 0)).toBe(3_000);
  });
});

describe('Szenario offline_sync', () => {
  it('nach der dauerhaften Ablehnung wirkt die neuere offene Operation lokal weiter, bevor sie selbst den Server erreicht', async () => {
    const world = await seeded(seedManifests.offline_sync);
    const phone = world.phones[iphone]!;
    const sync = ops.offlineSync;

    // Der Fachbefehl der Erfüllung beendet den ersten Batch; die Korrektur bleibt dabei offen.
    expect(await phone.pushOnce()).toBe('pushed');

    expect(resultOf(phone, sync.tippfehler)).toMatchObject({ type: 'permanently_rejected', canonical: { type: 'record', data: { amountMl: 500 } } });
    expect(resultOf(phone, sync.korrektur)).toBeUndefined();
    const local = dumpLocalDatabase(phone.database);
    expect(local.outbox.map((operation) => operation.operationId)).toEqual([sync.korrektur, sync.gegenLoeschung, sync.ungesichert]);
    // Kanonisch 500 ml, darauf erneut die Korrektur: 550 ml, noch auf dem Stand des Servers vor der Korrektur.
    const server = rowOf((await dumpServer(world.backend.database.db)).water_entry, seedIds.waterEntry.philippHeute[0]);
    expect(rowOf(local.rows.water_entry, seedIds.waterEntry.philippHeute[0])).toMatchObject({
      amount_ml: 550, updated_at: '2026-10-14T11:06:00.000Z', server_version: server!.server_version,
    });
    expect(server).toMatchObject({ amount_ml: 500 });
  });

  it('die Korrektur nach dem Tippfehler nimmt die schon angelegte Erfüllung nicht zurück', async () => {
    const world = await seeded(seedManifests.offline_sync);
    await runSteps(world);

    expect(resultOf(world.phones[iphone]!, ops.offlineSync.erfuellung)).toMatchObject({ type: 'applied' });
    const server = await dumpServer(world.backend.database.db);
    expect(server.daily_goal_completion).toEqual([expect.objectContaining({ baustein: 'wasserziel', first_completed_at: '2026-10-14T11:05:00.000Z' })]);
    expect(server.energy_booking?.map((row) => row.amount)).toEqual([1]);
    // Heute zählen danach nur 550 ml und 250 ml.
    const water = rowsOf(world.phones[iphone]!, 'water_entry').filter((row) => row.local_date === '2026-10-14' && row.deleted_at === null);
    expect(water.reduce((sum, row) => sum + Number(row.amount_ml), 0)).toBe(800);
  });

  it('jede Operation endet mit ihrem erwarteten Gewinner', async () => {
    const world = await seeded(seedManifests.offline_sync);
    const phone = world.phones[iphone]!;
    await runSteps(world);

    const sync = ops.offlineSync;
    // Feldkonflikt: Das iPhone hat um 11:00 offline geändert, ein anderes Gerät um 11:10 online; es gilt, was zuletzt eingeht.
    expect(resultOf(phone, sync.gewicht)).toMatchObject({ type: 'applied' });
    // Dauerhafte Ablehnung mit neuerer Operation derselben Entität: Die Korrektur wirkt weiter.
    expect(resultOf(phone, sync.tippfehler)).toMatchObject({ type: 'permanently_rejected', error: { code: 'invalid_payload' }, canonical: { type: 'record' } });
    expect(resultOf(phone, sync.korrektur)).toMatchObject({ type: 'applied' });
    // Löschen gewinnt gegen ein späteres Offline-Update.
    expect(resultOf(phone, sync.gegenLoeschung)).toMatchObject({ type: 'permanently_rejected', error: { code: 'conflict' }, canonical: { type: 'tombstone' } });
    // Die ungesicherte Änderung erreicht den Server.
    expect(resultOf(phone, sync.ungesichert)).toMatchObject({ type: 'applied' });
    expect(phone.pushResults().map((result) => result.operationId)).toEqual([
      sync.gewicht, sync.tippfehler, sync.erfuellung, sync.korrektur, sync.gegenLoeschung, sync.ungesichert,
    ]);

    const local = dumpLocalDatabase(phone.database);
    const server = await dumpServer(world.backend.database.db);
    expect(local.outbox).toEqual([]);
    expect(rowOf(local.rows.weight_entry, seedIds.weightEntry.philippGestern)).toMatchObject({ weight_g: 91_600 });
    expect(rowOf(local.rows.water_entry, seedIds.waterEntry.philippHeute[0])).toMatchObject({ amount_ml: 550, deleted_at: null });
    expect(rowOf(local.rows.water_entry, seedIds.waterEntry.philippHeute[1])).toMatchObject({ deleted_at: '2026-10-14T11:30:00.000Z' });
    expect(rowOf(local.rows.water_entry, seedIds.waterEntry.philippUngesichert)).toEqual(rowOf(server.water_entry, seedIds.waterEntry.philippUngesichert));
    expect(rowOf(local.rows.weight_entry, seedIds.weightEntry.philippGestern)).toEqual(rowOf(server.weight_entry, seedIds.weightEntry.philippGestern));
    expect(rowOf(local.rows.water_entry, seedIds.waterEntry.philippHeute[0])).toEqual(rowOf(server.water_entry, seedIds.waterEntry.philippHeute[0]));
  });
});
