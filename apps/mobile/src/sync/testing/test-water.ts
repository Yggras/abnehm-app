import { and, asc, eq, isNull } from 'drizzle-orm';

import type { EntityId, Instant, ServerVersion } from '@abnehm/contracts/base';
import { TestWaterRecord, TestWaterUpsert } from '@abnehm/contracts/fixtures';

import type { ReadContext, TransactionContext } from '../../local-db';
import { person, waterEntry } from '../../local-db/schema';
import { sqliteOf } from '../../local-db/sqlite';
import type { SyncWriter } from '../outbox';
import { sqliteEntity } from '../sqlite-entity';

// Test-Entität auf `water_entry` (#99): Sie steht für einen Bereich, der eine eigene Entität anmeldet.
// Den echten Wassereintrag liefert Spezifikation 3; diese Fassung gibt es nur in Tests.

/** Die einzige lokale Person; Eigentümerin neuer Einträge. */
function ownPersonId(tx: ReadContext): string {
  const own = sqliteOf(tx).select({ id: person.id }).from(person).get();
  if (own === undefined) throw new Error('Die eigene Person ist noch nicht synchronisiert');
  return own.id;
}

function writeLocal(tx: TransactionContext, entityId: EntityId, payload: TestWaterUpsert, at: Instant) {
  const fields = { ...payload, origin: 'manuell', updatedAt: at };
  sqliteOf(tx)
    .insert(waterEntry)
    .values({ ...fields, id: entityId, personId: ownPersonId(tx), createdAt: at })
    .onConflictDoUpdate({ target: waterEntry.id, set: fields })
    .run();
}

function deleteLocal(tx: TransactionContext, entityId: EntityId, at: Instant) {
  sqliteOf(tx).update(waterEntry).set({ deletedAt: at, updatedAt: at }).where(eq(waterEntry.id, entityId)).run();
}

export const testWaterEntity = sqliteEntity({
  entityType: 'water_entry',
  ownerField: 'personId',
  upsert: TestWaterUpsert,
  deletable: true,
  record: TestWaterRecord,
  table: waterEntry,
  row: (entityId, data) => ({ ...data, id: entityId, origin: 'manuell' }),
  replay(tx, entityId, change) {
    if (change.type === 'upsert_entity') writeLocal(tx, entityId, change.payload, change.createdAt);
    else deleteLocal(tx, entityId, change.createdAt);
  },
});

/** Wie ein Bereichs-Repository: Fachänderung und Outbox-Operation in derselben Transaktion. */
export function testWaterRepository(writer: SyncWriter, now: () => Instant) {
  function knownVersion(tx: ReadContext, entityId: EntityId): ServerVersion | null {
    const row = sqliteOf(tx).select({ serverVersion: waterEntry.serverVersion }).from(waterEntry).where(eq(waterEntry.id, entityId)).get();
    return (row?.serverVersion ?? null) as ServerVersion | null;
  }
  return {
    save(tx: TransactionContext, entityId: EntityId, payload: TestWaterUpsert) {
      writeLocal(tx, entityId, payload, now());
      writer.upsert(tx, { entityType: 'water_entry', entityId, payload, knownServerVersion: knownVersion(tx, entityId) });
    },
    remove(tx: TransactionContext, entityId: EntityId) {
      deleteLocal(tx, entityId, now());
      writer.delete(tx, { entityType: 'water_entry', entityId, knownServerVersion: knownVersion(tx, entityId) });
    },
    /** Sichtbare (nicht gelöschte) Einträge. */
    visible(tx: ReadContext) {
      return sqliteOf(tx)
        .select({ id: waterEntry.id, amountMl: waterEntry.amountMl, serverVersion: waterEntry.serverVersion })
        .from(waterEntry)
        .where(isNull(waterEntry.deletedAt))
        .orderBy(asc(waterEntry.createdAt), asc(waterEntry.id))
        .all();
    },
    /** Eine Zeile samt Löschmarkierung, auch wenn sie gelöscht ist. */
    row(tx: ReadContext, entityId: EntityId) {
      return sqliteOf(tx).select().from(waterEntry).where(and(eq(waterEntry.id, entityId))).get();
    },
  };
}
