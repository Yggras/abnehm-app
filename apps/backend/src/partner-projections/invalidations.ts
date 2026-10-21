import { randomUUID } from 'node:crypto';

import type { AreaKey, EntityId, LocalDate } from '@abnehm/contracts/base';

import type { DbExecutor } from '../database.ts';
import { projectionInvalidation } from '../db/schema/index.ts';

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
