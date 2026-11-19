import { randomUUID } from 'node:crypto';

import { LocalDate, type AreaKey, type EntityId } from '@abnehm/contracts/base';

import type { DbExecutor } from '../database.ts';
import { projectionInvalidation } from '../db/schema/index.ts';
import type { ServerSyncEntity } from '../sync/registry.ts';

// Typisierte Projektions-Invalidierungen (Spezifikation 0, Abschnitte 5 und 10). Ein Fachmodul vermerkt
// sie in derselben Transaktion wie seine Fachänderung; Projectors beobachten keine Tabellen. Der nächste
// Partner-Pull rechnet jede Zusammenfassung neu, deren Zeitraum am oder nach dem betroffenen Tag endet.

export type ProjectionInvalidation =
  /** Ein Eintrag des Bereichs am lokalen Tag `localDate` ist entstanden, geändert oder gelöscht. */
  | Readonly<{ type: 'bereich'; ownerPersonId: EntityId; area: AreaKey; localDate: LocalDate }>
  /**
   * Eine Ziel- oder Wochenplanversion ab `validFrom` ist neu oder ersetzt; sie wirkt auf alle Bereiche.
   * Pflicht für `createGoalVersion` und `createWeeklyPlanVersion` (Spezifikation 1) in deren Transaktion.
   */
  | Readonly<{ type: 'plan'; ownerPersonId: EntityId; validFrom: LocalDate }>
  /** Eine Freigabe der Eigentümerin hat sich am lokalen Tag `localDate` geändert; nur das Fundament meldet das. */
  | Readonly<{ type: 'freigabe'; ownerPersonId: EntityId; localDate: LocalDate }>;

/** Ohne Bereich betrifft die Invalidierung alle Bereiche des Eigentümers. */
export async function invalidatePartnerSummaries(tx: DbExecutor, invalidation: ProjectionInvalidation, at: Date): Promise<void> {
  const scope: { area: AreaKey | null; fromDate: LocalDate } =
    invalidation.type === 'bereich' ? { area: invalidation.area, fromDate: invalidation.localDate }
      : invalidation.type === 'plan' ? { area: null, fromDate: invalidation.validFrom }
        : { area: null, fromDate: invalidation.localDate };
  await tx.insert(projectionInvalidation).values({ id: randomUUID(), ownerPersonId: invalidation.ownerPersonId, ...scope, createdAt: at });
}

/**
 * Die Sync-Entität eines Bereichs, die bei jeder Push-Annahme (Anlegen, Ändern, Löschen, auch Ausblenden
 * oder Reaktivieren als Änderung) in derselben Transaktion seine Zusammenfassungen invalidiert: für den
 * lokalen Tag vor und nach der Änderung, damit auch ein verschobener Eintrag seinen alten Zeitraum
 * verlässt. Der kanonische Datensatz der Entität muss ihren lokalen Tag als `localDate` tragen.
 */
export function invalidatingPartnerSummaries(area: AreaKey, entity: ServerSyncEntity): ServerSyncEntity {
  async function localDateOf(tx: DbExecutor, id: EntityId): Promise<LocalDate | null> {
    const stored = (await entity.read(tx, [id])).get(id);
    return stored === undefined ? null : LocalDate.parse(stored.data.localDate);
  }
  async function invalidate(tx: DbExecutor, ownerPersonId: EntityId, localDates: readonly (LocalDate | null)[], at: Date) {
    for (const localDate of new Set(localDates)) {
      if (localDate !== null) await invalidatePartnerSummaries(tx, { type: 'bereich', ownerPersonId, area, localDate }, at);
    }
  }
  return {
    ...entity,
    async write(tx, change) {
      const before = change.exists ? await localDateOf(tx, change.entityId) : null;
      await entity.write(tx, change);
      await invalidate(tx, change.ownerPersonId, [before, await localDateOf(tx, change.entityId)], change.at);
    },
    async remove(tx, removal) {
      const before = await localDateOf(tx, removal.entityId);
      await entity.remove(tx, removal);
      await invalidate(tx, removal.ownerPersonId, [before], removal.at);
    },
  };
}
