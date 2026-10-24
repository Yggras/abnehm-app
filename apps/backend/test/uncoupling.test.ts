import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { policies } from '../src/authorization/authorization.ts';
import type { UncouplingObserver } from '../src/coupling/uncoupling.ts';
import { coupling } from '../src/db/schema/index.ts';
import type { TestBackend } from './support/app.ts';
import { httpOutcome, resourceProbe } from './support/authorization.ts';
import { coupleByInvitation, worldStart } from './support/coupled-world.ts';
import { actionIdOf, decideOp, invitedCouple as setup, recordsOf, roleSwapRequest, uncoupleAs } from './support/shared-actions.ts';
import { pullAll, push } from './support/sync.ts';

// Nachweis für #107: der serverseitige Entkopplungs-Kern (Spezifikation 0, Abschnitte 9 und 10). Er nimmt
// eine gültige Entkopplung sofort an, archiviert Kopplung und Insel, beendet offene gemeinsame Aktionen,
// lässt registrierte Beobachter in derselben Transaktion enden und erzeugt die Revocation-Notices. Den
// Befehl `requestUncoupling` samt Intent und Sicherheitslog liefert Spezifikation 5 (#130).

const at = new Date('2026-10-14T13:00:00.000Z');

const uncouple = (backend: TestBackend, request: { couplingId: string; requesterPersonId: string; actionId?: string }) =>
  uncoupleAs(backend, { ...request, at });

describe('Entkopplungs-Kern', () => {
  it('Tracer Bullet: Nach angenommener Aktion entkoppelt Anna; Philipp verliert sofort den Zugriff und erhält nur Notice und Archivstatus', async () => {
    const { backend, anna, philipp, couplingId, cursors } = await setup();
    const accepted = roleSwapRequest();
    await push(backend, anna.device, [accepted]);
    await push(backend, philipp.device, [decideOp(actionIdOf(accepted), 'annehmen')]);
    const open = roleSwapRequest();
    await push(backend, anna.device, [open]);
    const before = (await pullAll(backend, philipp.device, cursors.philipp)).cursor;

    expect(await uncouple(backend, { couplingId, requesterPersonId: anna.personId })).toMatchObject({
      status: 'angenommen',
      partnerPersonId: philipp.personId,
    });

    const [request] = await push(backend, philipp.device, [roleSwapRequest()]);
    const [decision] = await push(backend, philipp.device, [decideOp(actionIdOf(open), 'ablehnen')]);
    expect(request).toMatchObject({ type: 'permanently_rejected', error: { code: 'forbidden' } });
    expect(decision).toMatchObject({ type: 'permanently_rejected', error: { code: 'forbidden' } });

    const { changes } = await pullAll(backend, philipp.device, before);
    expect(changes.filter((change) => change.type === 'record').map((change) => change.entityType).sort()).toEqual([
      'coupling',
      'revocation_notice',
    ]);
    expect(recordsOf(changes, 'coupling')[couplingId]).toMatchObject({ status: 'archiviert', endedAt: at.toISOString() });
    expect(Object.values(recordsOf(changes, 'revocation_notice'))).toEqual([
      expect.objectContaining({ recipientPersonId: philipp.personId, couplingId, target: { type: 'kopplung' }, reason: 'entkopplung' }),
    ]);
    // Der Partner-Tageszielstatus endet als inhaltsfreie Löschmarkierung.
    expect(changes.filter((change) => change.type === 'tombstone').map((change) => change.entityType)).toEqual(['partner_daily_goal_status']);
  });

  it('liefert der Antragstellerin ihre Entkopplung, sofort angenommen, samt Archivstatus; nur sie darf sie lesen', async () => {
    const { backend, anna, philipp, couplingId } = await setup();
    const actionId = randomUUID();

    const result = await uncouple(backend, { couplingId, requesterPersonId: anna.personId, actionId });

    expect(result.changes).toEqual([
      expect.objectContaining({ entityType: 'shared_action', entityId: actionId, data: expect.objectContaining({ type: 'entkoppeln', status: 'angenommen', decidedAt: at.toISOString() }) }),
      expect.objectContaining({ entityType: 'coupling', entityId: couplingId, data: expect.objectContaining({ status: 'archiviert' }) }),
    ]);
    const read = resourceProbe(backend, policies.resource('shared_action', 'lesen'));
    expect(httpOutcome(await read(anna.device, { id: actionId }))).toBe('erlaubt');
    expect(httpOutcome(await read(philipp.device, { id: actionId }))).toBe('verweigert');
  });

  it('lehnt eine zweite Entkopplung ab, ohne die Kopplung zu ändern oder neue Notices zu erzeugen', async () => {
    const { backend, anna, philipp, couplingId } = await setup();
    await uncouple(backend, { couplingId, requesterPersonId: anna.personId });
    const cursors = { anna: (await pullAll(backend, anna.device)).cursor, philipp: (await pullAll(backend, philipp.device)).cursor };

    const second = await uncouple(backend, { couplingId, requesterPersonId: philipp.personId });

    expect(second).toMatchObject({ status: 'abgelehnt', partnerPersonId: anna.personId });
    expect(second.changes.map((change) => change.type === 'record' && change.data.status)).toEqual(['abgelehnt', 'archiviert']);
    expect((await pullAll(backend, anna.device, cursors.anna)).changes).toEqual([]);
    expect((await pullAll(backend, philipp.device, cursors.philipp)).changes).toEqual([]);
    const [archived] = await backend.database.db.select({ endedAt: coupling.endedAt }).from(coupling).where(eq(coupling.id, couplingId));
    expect(archived?.endedAt).toEqual(at);
  });

  it('lässt registrierte Beobachter in derselben Transaktion enden; scheitert einer, bleibt die Kopplung aktiv', async () => {
    const { backend, anna, philipp, couplingId } = await setup();
    const seen: string[] = [];
    let fail = true;
    const observer: UncouplingObserver = async (tx, context) => {
      const [current] = await tx.select({ status: coupling.status }).from(coupling).where(eq(coupling.id, context.couplingId));
      seen.push(`${context.couplingId}:${current?.status}:${context.at.toISOString()}`);
      if (fail) throw new Error('Beobachter scheitert');
    };
    backend.uncoupling.registerObserver('test', observer);
    expect(() => backend.uncoupling.registerObserver('test', observer)).toThrow('schon angemeldet');

    await expect(uncouple(backend, { couplingId, requesterPersonId: anna.personId })).rejects.toThrow('Beobachter scheitert');
    expect((await push(backend, philipp.device, [roleSwapRequest()]))[0]?.type).toBe('applied');

    fail = false;
    expect((await uncouple(backend, { couplingId, requesterPersonId: anna.personId })).status).toBe('angenommen');
    expect(seen).toEqual([`${couplingId}:archiviert:${at.toISOString()}`, `${couplingId}:archiviert:${at.toISOString()}`]);
  });
});

describe('Reaktivierung nach dem Entkoppeln', () => {
  it('nimmt dasselbe Paar eine Einladung an, kehrt die Kopplung zurück, und die beim Entkoppeln beendeten Aktionen kommen entschieden an', async () => {
    const { backend, anna, philipp, couplingId } = await setup();
    const open = roleSwapRequest();
    await push(backend, anna.device, [open]);
    const uncouplingId = randomUUID();
    await uncouple(backend, { couplingId, requesterPersonId: anna.personId, actionId: uncouplingId });
    const cursors = { anna: (await pullAll(backend, anna.device)).cursor, philipp: (await pullAll(backend, philipp.device)).cursor };

    expect(await coupleByInvitation(backend, philipp.device, anna.device)).toEqual({ couplingId, reactivated: true });

    for (const [person, cursor] of [[anna, cursors.anna], [philipp, cursors.philipp]] as const) {
      const { changes } = await pullAll(backend, person.device, cursor);
      expect(recordsOf(changes, 'coupling')[couplingId]).toMatchObject({ status: 'aktiv', endedAt: null, reactivatedAt: worldStart.instant });
      expect(Object.values(recordsOf(changes, 'island'))).toEqual([expect.objectContaining({ state: 'wartet_auf_rollen' })]);
      const actions = recordsOf(changes, 'shared_action');
      expect(actions[actionIdOf(open)]).toMatchObject({ status: 'zurueckgezogen', decidedAt: at.toISOString() });
      // Entkoppeln ist nie ein offener Vorgang: Es ist sofort angenommen, und nur Anna liest es.
      expect(actions[uncouplingId]).toEqual(
        person === anna ? expect.objectContaining({ type: 'entkoppeln', requesterPersonId: anna.personId, status: 'angenommen' }) : undefined,
      );
    }
    // Der Partnerzugriff ist zurück; die beendete Aktion bleibt beendet.
    expect((await push(backend, philipp.device, [decideOp(actionIdOf(open), 'annehmen')]))[0]).toMatchObject({ error: { code: 'conflict' } });
    expect((await push(backend, philipp.device, [roleSwapRequest()]))[0]?.type).toBe('applied');
  });
});
