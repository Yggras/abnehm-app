import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { EntityId } from '@abnehm/contracts/base';
import { summarizeEnergy } from '@abnehm/contracts/energy';

import { energyBooking as localBooking, islandObject as localObject } from '../../mobile/src/local-db/schema/index.ts';
import { sqliteOf } from '../../mobile/src/local-db/sqlite.ts';
import { readBookings } from '../src/energy/bookings.ts';
import { islandObject } from '../src/db/schema/index.ts';
import { defaultPassword, newDevice, signIn } from './support/auth-client.ts';
import { lockBlueprint } from './support/building.ts';
import { worldToday } from './support/coupled-world.ts';
import { energize, fieldOn, gamePhone, hatchedPhones, islandOf, type GamePhone } from './support/game-phones.ts';

// Nachweis für #191 auf zwei Geräten: Bauen im Spieldienst der App (Engine, Outbox und Adapter auf echtem
// SQLite) gegen die echte Hono-App mit Postgres (Spezifikation 4, Testnaht 3). Die eigene Hälfte wächst
// offline sofort; Objekt, Buchung und Inselfortschritt bestätigt der Server mit dem Sync.

const days = ['2026-10-14', '2026-10-13', '2026-10-12'] as const;

const localRows = (phone: GamePhone) =>
  phone.database.read((tx) => ({ objects: sqliteOf(tx).select().from(localObject).all(), builds: sqliteOf(tx).select().from(localBooking).where(eq(localBooking.type, 'build_debit')).all() }));
const build = (phone: GamePhone, key: string, blueprintKey: string) => phone.game.build({ fieldId: fieldOn(phone, key), blueprintKey });

describe('Bauen App ↔ Backend', { timeout: 30_000 }, () => {
  it('Tracer Bullet: Philipp baut offline, seine Hälfte wächst sofort; nach dem Push steht das Objekt kanonisch, und Annas Gerät zeigt es nach dem Pull', async () => {
    const world = await hatchedPhones();
    const { backend, philipp, philippsPhone, annasPhone } = world;
    await energize(world, [worldToday]);
    expect(islandOf(philippsPhone).energy).toBe(4);

    philippsPhone.offline();
    const built = build(philippsPhone, 'grundinsel:0:0', 'laterne');

    expect(built).toMatchObject({ type: 'gebaut' });
    const offline = islandOf(philippsPhone);
    // Laterne 3: Bedarf(1) = 11, 3/11 → 27 %. Kein Levelaufstieg ohne Projektion.
    expect(offline).toMatchObject({ energy: 1, halves: { level: 1, own: { halfPercent: 27, halfFull: false }, partner: { halfPercent: 0 }, waitingForPartner: false } });
    expect(offline.progress.members.find((member) => member.personId === philipp.personId)?.halfPercent).toBe(0);
    expect(offline.objects).toEqual([{
      id: built.type === 'gebaut' ? built.islandObjectId : '',
      fieldKey: 'grundinsel:0:0',
      catalogKey: 'laterne',
      origin: 'gebaut',
      level: 1,
      art: 'laterne_1',
      ownerPersonId: philipp.personId,
    }]);
    expect(philippsPhone.character()).toMatchObject({ type: 'ready', data: { energy: 1, level: 1, ownHalfPercent: 27, waitingForPartner: false } });
    expect(philippsPhone.outbox()).toHaveLength(1);

    philippsPhone.online();
    await philippsPhone.sync();
    await annasPhone.sync();

    expect(philippsPhone.outbox()).toEqual([]);
    expect(await backend.database.db.select().from(islandObject)).toHaveLength(1);
    expect(islandOf(philippsPhone).progress.members.find((member) => member.personId === philipp.personId)?.halfPercent).toBe(27);
    const annas = islandOf(annasPhone);
    expect(annas.objects).toEqual(offline.objects);
    expect(annas.halves).toMatchObject({ own: { halfPercent: 0 }, partner: { halfPercent: 27 } });
    expect(annasPhone.character()).toMatchObject({ data: { partnerHalfPercent: 27 } });
  });

  it('das Gerät baut nur bei ausreichendem Bestand, auf freie eigene Felder und mit freigeschalteten Bauplänen', async () => {
    const world = await hatchedPhones();
    const { philippsPhone } = world;
    await energize(world, [worldToday]);

    expect(build(philippsPhone, 'grundinsel:0:0', 'laterne')).toMatchObject({ type: 'gebaut' });
    expect(build(philippsPhone, 'grundinsel:1:0', 'sitzbank')).toEqual({ type: 'verboten', reason: 'zu_wenig_energie', missing: 1 });
    expect(build(philippsPhone, 'grundinsel:0:0', 'holzweg')).toEqual({ type: 'verboten', reason: 'feld_belegt' });
    expect(build(philippsPhone, 'grundinsel:12:0', 'holzweg')).toEqual({ type: 'verboten', reason: 'fremdes_feld' });
    expect(build(philippsPhone, 'grundinsel:4:0', 'blumenwiese')).toEqual({ type: 'verboten', reason: 'falsche_rolle' });
    expect(localRows(philippsPhone).objects).toHaveLength(1);
    expect(philippsPhone.outbox()).toHaveLength(1);
  });

  it('„Deine Hälfte ist voll“: Momo wartet auf Anna, weitere Ausgaben zählen als Überschuss, und Anna sieht nicht, was ihr fehlt', async () => {
    const world = await hatchedPhones();
    const { philippsPhone, annasPhone } = world;
    await energize(world, days);

    // 3 + 3 + 3 + 2 = 11 = Bedarf(1).
    for (const [key, blueprint] of [['grundinsel:0:0', 'laterne'], ['grundinsel:1:0', 'laterne'], ['grundinsel:2:0', 'laterne'], ['grundinsel:3:0', 'sitzbank']] as const) {
      expect(build(philippsPhone, key, blueprint)).toMatchObject({ type: 'gebaut' });
    }
    expect(islandOf(philippsPhone).halves).toMatchObject({ level: 1, own: { halfPercent: 100, halfFull: true }, waitingForPartner: true });
    expect(philippsPhone.character()).toEqual({
      type: 'ready',
      data: expect.objectContaining({ energy: 1, level: 1, ownHalfPercent: 100, waitingForPartner: true, partnerDisplayName: 'Anna' }),
    });

    expect(build(philippsPhone, 'grundinsel:0:1', 'holzweg')).toMatchObject({ type: 'gebaut' });
    expect(islandOf(philippsPhone)).toMatchObject({ energy: 0, halves: { own: { halfPercent: 100 }, waitingForPartner: true } });

    await philippsPhone.sync();
    await annasPhone.sync();
    // Erst wenn auch Anna ihre Hälfte füllt, steigt Momo; bis dahin bleibt Level 1.
    expect(islandOf(philippsPhone).halves).toMatchObject({ level: 1, waitingForPartner: true });
    expect(islandOf(annasPhone).halves).toMatchObject({ level: 1, own: { halfPercent: 0 }, partner: { halfPercent: 100, halfFull: true }, waitingForPartner: false });
    expect(annasPhone.character()).toMatchObject({ data: { waitingForPartner: false, partnerDisplayName: 'Philipp' } });
  });

  it('kanonisches Duplikat: Geht die Antwort verloren, ersetzt der Retry die lokalen Zeilen, und nichts zählt doppelt', async () => {
    const world = await hatchedPhones();
    const { philippsPhone } = world;
    await energize(world, [worldToday]);
    build(philippsPhone, 'grundinsel:0:0', 'laterne');

    philippsPhone.dropNextPushResponse();
    await philippsPhone.syncWithFailedPush();
    expect(localRows(philippsPhone).builds.map((row) => row.serverVersion)).toEqual([null]);
    await philippsPhone.sync();

    const { objects, builds } = localRows(philippsPhone);
    expect(objects).toHaveLength(1);
    expect(builds).toHaveLength(1);
    expect(objects[0]!.serverVersion).not.toBeNull();
    expect(builds[0]!.serverVersion).not.toBeNull();
    expect(islandOf(philippsPhone)).toMatchObject({ energy: 1, halves: { own: { halfPercent: 27 } } });
    expect(philippsPhone.outbox()).toEqual([]);
  });

  it('Doppelausgabe auf zwei Geräten: Der Server nimmt beide an, der negative Zwischenstand erscheint als 0', async () => {
    const world = await hatchedPhones();
    const { backend, philipp, philippsPhone } = world;
    const second = (await signIn(backend, 'philipp@example.test', defaultPassword, newDevice())).device;
    const ipad = await gamePhone(backend, philipp.accountId, second);
    await ipad.sync();
    await energize(world, [worldToday], [philippsPhone, ipad]);

    philippsPhone.offline();
    ipad.offline();
    expect(build(philippsPhone, 'grundinsel:0:0', 'laterne')).toMatchObject({ type: 'gebaut' });
    expect(build(ipad, 'grundinsel:1:0', 'laterne')).toMatchObject({ type: 'gebaut' });
    philippsPhone.online();
    ipad.online();
    await philippsPhone.sync();
    await ipad.sync();
    await philippsPhone.sync();

    const server = (await readBookings(backend.database.db, [EntityId.parse(philipp.personId)])).get(EntityId.parse(philipp.personId))!;
    expect(summarizeEnergy(server).balance).toBe(-2);
    for (const phone of [philippsPhone, ipad]) {
      // 6/11 → 54 %; beide Objekte stehen.
      expect(islandOf(phone)).toMatchObject({ energy: 0, halves: { own: { halfPercent: 54 } } });
      expect(islandOf(phone).objects).toHaveLength(2);
      expect(phone.character()).toMatchObject({ data: { energy: 0 } });
    }
  });

  it('ein dauerhaft abgelehnter Bau verschwindet samt Buchung, und die eigene Hälfte fällt zurück', async () => {
    const world = await hatchedPhones();
    const { backend, philippsPhone } = world;
    await energize(world, [worldToday]);
    // Der Server kennt die Sitzbank nicht mehr als freigeschaltet, das Gerät schon.
    await lockBlueprint({ backend, islandId: islandOf(philippsPhone).islandId }, 'sitzbank');

    expect(build(philippsPhone, 'grundinsel:0:0', 'sitzbank')).toMatchObject({ type: 'gebaut' });
    expect(islandOf(philippsPhone)).toMatchObject({ energy: 2, halves: { own: { halfPercent: 18 } } });
    await philippsPhone.sync();

    expect(localRows(philippsPhone)).toEqual({ objects: [], builds: [] });
    expect(islandOf(philippsPhone)).toMatchObject({ energy: 4, halves: { own: { halfPercent: 0 } }, objects: [] });
    expect(philippsPhone.outbox()).toEqual([]);
  });
});
