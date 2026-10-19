import { describe, expect, it } from 'vitest';

import { EntityId } from '../src/base.ts';
import { CommandType, OutboxOperation, PushResult } from '../src/sync.ts';

const id = EntityId.parse('0b3f9a52-6c1e-4d7a-9f20-1a5e8c4d2b01');
const other = EntityId.parse('0b3f9a52-6c1e-4d7a-9f20-1a5e8c4d2b02');
const command = {
  type: 'completeDailyGoal', operationId: id, businessKey: 'goal:2026-10-14:1', payload: { completionId: other },
  knownServerVersion: null, schemaVersion: 1, createdAt: '2026-10-14T12:00:00.000Z',
};

describe('Fachbefehl-Vertrag', () => {
  it('akzeptiert den geschlossenen Katalog, nicht beliebige Operationstypen', () => {
    expect(CommandType.safeParse('completeDailyGoal').success).toBe(true);
    expect(OutboxOperation.safeParse(command).success).toBe(true);
    expect(OutboxOperation.safeParse({ ...command, type: 'inventSomething' }).success).toBe(false);
  });

  it('liefert bei kanonischen Duplikaten eine explizite Zuordnung und alle Ergebnisse', () => {
    const canonical = { type: 'record', entityType: 'daily_goal_completion', entityId: other, serverVersion: '2', data: {} };
    expect(PushResult.safeParse({ type: 'already_applied', operationId: id, canonical, idMappings: [{ entityType: 'daily_goal_completion', from: id, to: other }], changes: [canonical] }).success).toBe(true);
    expect(PushResult.safeParse({ type: 'already_applied', operationId: id, canonical, idMappings: [{ entityType: 'daily_goal_completion', from: id, to: 'invalid' }], changes: [canonical] }).success).toBe(false);
  });
});
