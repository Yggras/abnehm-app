import { describe, expect, it } from 'vitest';

import { EntityId } from '@abnehm/contracts/base';
import { summarizeEnergy } from '@abnehm/contracts/energy';

import { eq } from 'drizzle-orm';

import { islandObject as localObject } from '../../mobile/src/local-db/schema/index.ts';
import { sqliteOf } from '../../mobile/src/local-db/sqlite.ts';
import { coupling } from '../src/db/schema/index.ts';
import { readBookings } from '../src/energy/bookings.ts';
import { defaultPassword, newDevice, signIn } from './support/auth-client.ts';
import { worldToday } from './support/coupled-world.ts';
import { energize, fieldOn, gamePhone, hatchedPhones, islandOf, type GamePhone } from './support/game-phones.ts';
import { uncoupleAs } from './support/shared-actions.ts';

// Nachweis für #194 auf echten Geräten: Aufwerten, Umstellen, Einlagern und Platzieren im Spieldienst der App
// (Engine, Outbox und Adapter auf echtem SQLite) gegen die echte Hono-App mit Postgres (Spezifikation 4,
// Testnaht 3). Anna hat Natur, Philipp Bauen; Philipps Ecke beginnt bei `grundinsel:0:0`.

const days = [worldToday, '2026-10-13', '2026-10-12'] as const;

function built(phone: GamePhone, key: string, blueprintKey: string): EntityId {
  const outcome = phone.game.build({ fieldId: fieldOn(phone, key), blueprintKey });
  if (outcome.type !== 'gebaut') throw new Error(`Bau fehlgeschlagen: ${JSON.stringify(outcome)}`);
  return outcome.islandObjectId;
}

const onField = (phone: GamePhone, key: string) => ({ type: 'feld', fieldId: fieldOn(phone, key) }) as const;
const lager = { type: 'lager' } as const;
const placedAt = (phone: GamePhone) => islandOf(phone).objects.map(({ id, fieldKey, art }) => ({ id, fieldKey, art }));
const storedIds = (phone: GamePhone) => islandOf(phone).storage.map((object) => object.id);

/** Philipp mit einem zweiten Gerät; beide kennen seine Energie aus drei Tagen (12). */
async function twoDevices() {
  const world = await hatchedPhones();
  const second = (await signIn(world.backend, 'philipp@example.test', defaultPassword, newDevice())).device;
  const ipad = await gamePhone(world.backend, world.philipp.accountId, second);
  await ipad.sync();
  await energize(world, days, [world.philippsPhone, ipad]);
  return { ...world, iphone: world.philippsPhone, ipad };
}

describe('Aufwerten und Platzieren App ↔ Backend', { timeout: 30_000 }, () => {
  it('Tracer Bullet: Philipp wertet seine Laterne offline auf Stufe 2 auf, stellt sie um, lagert sie ein und platziert sie wieder', async () => {
    const world = await hatchedPhones();
    const { backend, philipp, philippsPhone, annasPhone } = world;
    await energize(world, days);
    philippsPhone.offline();
    const laterne = built(philippsPhone, 'grundinsel:0:0', 'laterne');

    expect(philippsPhone.game.upgrade(laterne)).toEqual({ type: 'aufgewertet', level: 2, price: 6 });
    // 12 − 3 − 6 = 3; 9/11 → 81 %, sofort und offline.
    expect(islandOf(philippsPhone)).toMatchObject({ energy: 3, halves: { own: { halfPercent: 81 } } });
    expect(placedAt(philippsPhone)).toEqual([{ id: laterne, fieldKey: 'grundinsel:0:0', art: 'laterne_2' }]);

    expect(philippsPhone.game.place(laterne, onField(philippsPhone, 'grundinsel:1:0'))).toEqual({ type: 'platziert' });
    expect(placedAt(philippsPhone)).toEqual([{ id: laterne, fieldKey: 'grundinsel:1:0', art: 'laterne_2' }]);
    expect(philippsPhone.game.place(laterne, lager)).toEqual({ type: 'platziert' });
    expect(placedAt(philippsPhone)).toEqual([]);
    expect(islandOf(philippsPhone).storage).toEqual([{ id: laterne, catalogKey: 'laterne', origin: 'gebaut', level: 2, art: 'laterne_2', giftFrom: null }]);
    expect(philippsPhone.game.place(laterne, onField(philippsPhone, 'grundinsel:2:0'))).toEqual({ type: 'platziert' });
    // Platzieren ist kostenlos; die verbaute Energie bleibt der Insel auch im Lager.
    expect(islandOf(philippsPhone)).toMatchObject({ energy: 3, halves: { own: { halfPercent: 81 } }, storage: [] });
    expect(philippsPhone.outbox().map((operation) => operation.type)).toEqual(['buildObject', 'upgradeObject', 'placeObject', 'placeObject', 'placeObject']);

    philippsPhone.online();
    await philippsPhone.sync();
    await annasPhone.sync();

    expect(philippsPhone.outbox()).toEqual([]);
    const server = (await readBookings(backend.database.db, [EntityId.parse(philipp.personId)])).get(EntityId.parse(philipp.personId))!;
    expect(summarizeEnergy(server).balance).toBe(3);
    expect(islandOf(philippsPhone).progress.members.find((member) => member.personId === philipp.personId)?.halfPercent).toBe(81);
    expect(placedAt(annasPhone)).toEqual([{ id: laterne, fieldKey: 'grundinsel:2:0', art: 'laterne_2' }]);
    expect(islandOf(annasPhone).halves).toMatchObject({ partner: { halfPercent: 81 } });
  });

  it('das Gerät wertet nur bei ausreichendem Bestand auf und platziert nur eigene Objekte auf freie eigene Felder nach den Platzierungsregeln', async () => {
    const world = await hatchedPhones();
    const { philippsPhone, annasPhone, anna } = world;
    await energize(world, [worldToday]);
    const laterne = built(philippsPhone, 'grundinsel:0:0', 'laterne');
    const apfelbaum = built(philippsPhone, 'grundinsel:1:0', 'blumenwiese');
    await energize({ ...world, philipp: anna }, [worldToday], [annasPhone]);
    const annas = built(annasPhone, 'grundinsel:12:0', 'blumenwiese');
    await annasPhone.sync();
    await philippsPhone.sync();

    // 4 − 3 − 1 = 0; Stufe 2 kostet 6.
    expect(philippsPhone.game.upgrade(laterne)).toEqual({ type: 'verboten', reason: 'zu_wenig_energie', price: 6, missing: 6 });
    expect(philippsPhone.game.place(laterne, onField(philippsPhone, 'grundinsel:1:0'))).toEqual({ type: 'verboten', reason: 'feld_belegt' });
    expect(philippsPhone.game.place(laterne, onField(philippsPhone, 'grundinsel:12:1'))).toEqual({ type: 'verboten', reason: 'fremdes_feld' });
    expect(philippsPhone.game.place(laterne, onField(philippsPhone, 'grundinsel:6:0'))).toEqual({ type: 'verboten', reason: 'gemeinsamer_bereich' });
    expect(philippsPhone.game.place(apfelbaum, onField(philippsPhone, 'grundinsel:4:0'))).toEqual({ type: 'verboten', reason: 'falsche_rolle' });
    expect(philippsPhone.game.place(annas, lager)).toEqual({ type: 'verboten', reason: 'kein_eigenes_objekt' });
    expect(philippsPhone.game.upgrade(annas)).toEqual({ type: 'verboten', reason: 'kein_eigenes_objekt' });
    expect(philippsPhone.outbox()).toEqual([]);
  });

  it('Feldkonflikt: Zwei eigene Geräte stellen offline auf dasselbe Feld; das zuerst platzierte Objekt liegt nach dem Pull auf beiden im Lager', async () => {
    const { iphone, ipad } = await twoDevices();
    const laterne = built(iphone, 'grundinsel:0:0', 'laterne');
    const holzweg = built(iphone, 'grundinsel:1:0', 'holzweg');
    await iphone.sync();
    await ipad.sync();

    iphone.offline();
    ipad.offline();
    expect(iphone.game.place(laterne, onField(iphone, 'grundinsel:2:0'))).toEqual({ type: 'platziert' });
    expect(ipad.game.place(holzweg, onField(ipad, 'grundinsel:2:0'))).toEqual({ type: 'platziert' });
    iphone.online();
    ipad.online();
    await iphone.sync();
    await ipad.sync();
    await iphone.sync();

    for (const phone of [iphone, ipad]) {
      expect(placedAt(phone)).toEqual([{ id: holzweg, fieldKey: 'grundinsel:2:0', art: 'holzweg_1' }]);
      expect(storedIds(phone)).toEqual([laterne]);
      // Keine Energie geht verloren: 12 − 3 − 1.
      expect(islandOf(phone).energy).toBe(8);
      expect(phone.outbox()).toEqual([]);
    }
  });

  it('ein Pull bringt ein Objekt auf ein Feld, dessen Objekt lokal noch eine offene Operation hat: Es weicht lokal ins Lager', async () => {
    const { iphone, ipad } = await twoDevices();
    const laterne = built(iphone, 'grundinsel:0:0', 'laterne');
    const holzweg = built(iphone, 'grundinsel:1:0', 'holzweg');
    await iphone.sync();
    await ipad.sync();
    // Das iPhone lagert die Laterne ein und stellt den Holzweg auf ihr Feld.
    expect(iphone.game.place(laterne, lager)).toEqual({ type: 'platziert' });
    expect(iphone.game.place(holzweg, onField(iphone, 'grundinsel:0:0'))).toEqual({ type: 'platziert' });
    await iphone.sync();

    // Das iPad wertet die Laterne auf; der Server verarbeitet das, die Antwort geht verloren, der Pull läuft.
    expect(ipad.game.upgrade(laterne)).toMatchObject({ type: 'aufgewertet' });
    ipad.dropNextPushResponse();
    await ipad.syncWithFailedPush();
    expect(placedAt(ipad)).toEqual([{ id: holzweg, fieldKey: 'grundinsel:0:0', art: 'holzweg_1' }]);
    expect(storedIds(ipad)).toEqual([laterne]);

    await ipad.sync();
    expect(islandOf(ipad).storage).toMatchObject([{ id: laterne, level: 2 }]);
    expect(ipad.outbox()).toEqual([]);
  });

  it('dieselbe Aufwertung auf zwei Geräten: Das zweite übernimmt die Stufe des Servers, seine Buchung verschwindet', async () => {
    const { backend, philipp, iphone, ipad } = await twoDevices();
    const laterne = built(iphone, 'grundinsel:0:0', 'laterne');
    await iphone.sync();
    await ipad.sync();

    iphone.offline();
    ipad.offline();
    expect(iphone.game.upgrade(laterne)).toMatchObject({ type: 'aufgewertet', level: 2 });
    expect(ipad.game.upgrade(laterne)).toMatchObject({ type: 'aufgewertet', level: 2 });
    iphone.online();
    ipad.online();
    await iphone.sync();
    await ipad.sync();
    await iphone.sync();

    const server = (await readBookings(backend.database.db, [EntityId.parse(philipp.personId)])).get(EntityId.parse(philipp.personId))!;
    expect(server.filter((booking) => booking.type === 'upgrade_debit')).toHaveLength(1);
    for (const phone of [iphone, ipad]) {
      // 12 − 3 − 6 = 3, nur einmal bezahlt.
      expect(islandOf(phone)).toMatchObject({ energy: 3, halves: { own: { halfPercent: 81 } } });
      expect(placedAt(phone)).toEqual([{ id: laterne, fieldKey: 'grundinsel:0:0', art: 'laterne_2' }]);
      expect(phone.outbox()).toEqual([]);
    }
  });

  it('eine Platzierung, die der Server ohne kanonischen Datensatz ablehnt, setzt das Objekt lokal zurück', async () => {
    const world = await hatchedPhones();
    const { backend, anna, philippsPhone } = world;
    await energize(world, [worldToday]);
    const laterne = built(philippsPhone, 'grundinsel:0:0', 'laterne');
    await philippsPhone.sync();
    const fieldOf = () => philippsPhone.database.read((tx) => sqliteOf(tx).select({ fieldId: localObject.fieldId }).from(localObject).where(eq(localObject.id, laterne)).get()?.fieldId);
    const before = fieldOf();

    philippsPhone.offline();
    expect(philippsPhone.game.place(laterne, lager)).toEqual({ type: 'platziert' });
    expect(fieldOf()).toBeNull();
    // Anna entkoppelt, bevor Philipps Platzierung ankommt: Die archivierte Kopplung ist `forbidden`, ohne Datensatz.
    const [current] = await backend.database.db.select({ id: coupling.id }).from(coupling);
    await uncoupleAs(backend, { couplingId: current!.id, requesterPersonId: anna.personId });
    philippsPhone.online();
    await philippsPhone.sync();

    expect(philippsPhone.outbox()).toEqual([]);
    expect(fieldOf()).toBe(before);
  });
});
