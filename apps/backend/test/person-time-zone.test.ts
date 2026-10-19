import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { changeLog, person } from '../src/db/schema/index.ts';
import { authorizationCases } from './support/authorization.ts';
import { personTimeZoneScenario, timeZoneOp } from './support/person-time-zone.ts';
import { pullAll, push, pushRaw } from './support/sync.ts';

// `updatePersonTimeZone` am Server (#110): ändert nur `time_zone`, schreibt eine Änderungsposition für
// die anderen Geräte und ist je Operation idempotent. Das Zusammenspiel zweier App-Installationen
// prüft test/person-sync-app.test.ts.

const personOf = async (world: Awaited<ReturnType<typeof personTimeZoneScenario.arrange>>) => {
  const [row] = await world.backend.database.db.select().from(person).where(eq(person.id, world.personId));
  return row!;
};

describe('updatePersonTimeZone', () => {
  it('ändert ausschließlich die Zeitzone und meldet die Person mit der Änderung', async () => {
    const world = await personTimeZoneScenario.arrange();
    const before = await personOf(world);
    const { cursor } = await pullAll(world.backend, world.actor);

    const [result] = await push(world.backend, world.actor, [timeZoneOp(world.personId, 'America/New_York')]);

    const after = await personOf(world);
    expect(after).toEqual({ ...before, timeZone: 'America/New_York', updatedAt: after.updatedAt, serverVersion: after.serverVersion });
    expect(after.serverVersion).toBeGreaterThan(before.serverVersion);
    expect(result).toMatchObject({
      type: 'applied',
      changes: [{ type: 'record', entityType: 'person', entityId: world.personId, serverVersion: after.serverVersion.toString(),
        data: { displayName: 'Anna', timeZone: 'America/New_York' } }],
      idMappings: [],
    });
    const { changes } = await pullAll(world.backend, world.actor, cursor);
    expect(changes).toMatchObject([{ entityType: 'person', data: { timeZone: 'America/New_York' } }]);
  });

  it('vergibt für dieselbe Zone keine neue Version', async () => {
    const world = await personTimeZoneScenario.arrange();
    const before = await personOf(world);
    const positions = (await world.backend.database.db.select().from(changeLog)).length;

    const [result] = await push(world.backend, world.actor, [timeZoneOp(world.personId, 'Europe/Berlin')]);

    expect(result).toMatchObject({ type: 'applied', changes: [{ serverVersion: before.serverVersion.toString() }] });
    expect(await personOf(world)).toEqual(before);
    expect(await world.backend.database.db.select().from(changeLog)).toHaveLength(positions);
  });

  it('wiederholt eine Operation idempotent und behandelt jede neue Änderung als eigenen Befehl', async () => {
    const world = await personTimeZoneScenario.arrange();
    const toTokyo = timeZoneOp(world.personId, 'Asia/Tokyo');
    const [first] = await push(world.backend, world.actor, [toTokyo]);
    await push(world.backend, world.actor, [timeZoneOp(world.personId, 'Europe/Berlin')]);

    expect(await push(world.backend, world.actor, [toTokyo])).toEqual([{ ...first, type: 'already_applied' }]);
    expect((await personOf(world)).timeZone).toBe('Europe/Berlin');
  });

  it('lehnt einen Schlüssel ohne Person, einen Versatz statt Zone und weitere Felder ab', async () => {
    const world = await personTimeZoneScenario.arrange();
    const valid = timeZoneOp(world.personId, 'Asia/Tokyo');
    const results = await push(world.backend, world.actor, [
      { ...valid, businessKey: `person:${world.personId}` },
      { ...timeZoneOp(world.personId, 'Asia/Tokyo'), payload: { timeZone: '+09:00' } },
      { ...timeZoneOp(world.personId, 'Asia/Tokyo'), payload: { timeZone: 'Asia/Tokyo', displayName: 'Mallory' } },
    ]);

    expect(results.map((result) => result.type === 'permanently_rejected' && result.error.code)).toEqual(['forbidden', 'invalid_payload', 'invalid_payload']);
    expect(await personOf(world)).toMatchObject({ timeZone: 'Europe/Berlin', displayName: 'Anna' });
    expect((await pushRaw(world.backend, world.actor, [valid])).status).toBe(200);
  });

  for (const testCase of authorizationCases({ ...personTimeZoneScenario, command: 'updatePersonTimeZone' })) {
    it(`Autorisierung · ${testCase.name}`, () => testCase.run());
  }
});
