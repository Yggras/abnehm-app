import { and, asc, eq, inArray } from 'drizzle-orm';

import { EntityId, type Instant } from '@abnehm/contracts/base';
import { IslandRole, MomoAppearance, type IslandProgress } from '@abnehm/contracts/island';
import { SharedEventType } from '@abnehm/contracts/wir';
import { formAt } from '@abnehm/game-rules/unlocks';

import type { ReadContext } from '../local-db';
import { areaUnlock, couplingMember, island, islandEvent, islandField, islandProgress } from '../local-db/schema';
import { sqliteOf } from '../local-db/sqlite';
import { islandProgressOf } from './island-entities';

// Die geschlüpfte Insel aus den lokalen Daten (Spezifikation 4, Abschnitte 2.1, 6 und 7; #184): Rollen,
// Felder mit Besitzer, freigeschaltete Gebiete, Inselfortschritt, Momo und die gemeinsamen Ereignisse für
// „Wir“. Alles kommt per Pull vom Server; solange ein Teil fehlt, etwa zwischen zwei Seiten desselben
// Pulls, ist die Insel noch nicht lesbar.

/** Ein Feld der Insel mit Besitzer; `null` bei Strand, Lichtung und Gemeinschaftsplatz. */
export type IslandFieldOwner = Readonly<{ key: string; ownerPersonId: string | null }>;

/** Ein gemeinsames Ereignis für „Neu bei euch“, etwa „Momo ist geschlüpft“. */
export type SharedIslandEvent = Readonly<{ eventId: EntityId; type: SharedEventType; occurredAt: Instant }>;

export type HatchedIsland = Readonly<{
  islandId: EntityId;
  viewerPersonId: EntityId;
  partnerPersonId: EntityId;
  partnerDisplayName: string;
  ownRole: IslandRole;
  /** Angezeigte eigene Energie, mindestens 0. */
  energy: number;
  progress: IslandProgress;
  fields: readonly IslandFieldOwner[];
  unlockedAreas: readonly string[];
  appearance: MomoAppearance;
  sharedEvents: readonly SharedIslandEvent[];
}>;

/**
 * Momo, wie beide Personen es sehen: Form aus dem Level der Projektion. Stimmungen liefert „Momo-Reaktionen
 * und Stimmungen“ (#188), Accessoires „Momos Wunsch, Schrank und Ankleiden“ (#206); bis dahin ist Momo zufrieden
 * und trägt nichts.
 */
export function appearanceAt(level: number): MomoAppearance {
  return MomoAppearance.parse({ stage: 'geschluepft', formKey: formAt(level), moodKey: 'zufrieden', accessories: { kopf: null, hals: null } });
}

/** Die geschlüpfte Insel der Kopplung aus Sicht der Person; `null`, solange ein Teil noch fehlt. */
export function readHatchedIsland(tx: ReadContext, { couplingId, personId, energy }: Readonly<{ couplingId: EntityId; personId: EntityId; energy: number }>): HatchedIsland | null {
  const db = sqliteOf(tx);
  const found = db.select({ id: island.id }).from(island).where(eq(island.couplingId, couplingId)).get();
  const progressRow = found && db.select().from(islandProgress).where(eq(islandProgress.islandId, found.id)).get();
  const members = db.select().from(couplingMember).where(eq(couplingMember.couplingId, couplingId)).all();
  const own = members.find((member) => member.personId === personId);
  const partner = members.find((member) => member.personId !== personId);
  if (found === undefined || progressRow == null || own?.role == null || partner === undefined) return null;
  const islandId = EntityId.parse(found.id);
  const progress = islandProgressOf(progressRow);

  return {
    islandId,
    viewerPersonId: personId,
    partnerPersonId: EntityId.parse(partner.personId),
    partnerDisplayName: partner.displayName,
    ownRole: IslandRole.parse(own.role),
    energy,
    progress,
    fields: db
      .select({ key: islandField.fieldKey, ownerPersonId: islandField.ownerPersonId })
      .from(islandField)
      .where(eq(islandField.islandId, islandId))
      .orderBy(asc(islandField.fieldKey))
      .all(),
    unlockedAreas: db
      .select({ key: areaUnlock.areaKey })
      .from(areaUnlock)
      .where(eq(areaUnlock.islandId, islandId))
      .orderBy(asc(areaUnlock.level))
      .all()
      .map((row) => row.key),
    appearance: appearanceAt(progress.level),
    sharedEvents: db
      .select({ eventId: islandEvent.id, type: islandEvent.type, occurredAt: islandEvent.occurredAt })
      .from(islandEvent)
      .where(and(eq(islandEvent.islandId, islandId), inArray(islandEvent.type, SharedEventType.options)))
      .orderBy(asc(islandEvent.occurredAt))
      .all()
      .map((row) => ({ eventId: EntityId.parse(row.eventId), type: SharedEventType.parse(row.type), occurredAt: row.occurredAt as Instant })),
  };
}
