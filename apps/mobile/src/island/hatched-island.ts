import { and, asc, eq, inArray, isNotNull, isNull } from 'drizzle-orm';

import { EntityId, Instant } from '@abnehm/contracts/base';
import { IslandRole, MomoAppearance, type IslandProgress } from '@abnehm/contracts/island';
import { SharedEventType } from '@abnehm/contracts/wir';
import { indexCatalog, type ArtKey } from '@abnehm/game-rules/catalog';
import { gameCatalog } from '@abnehm/game-rules/content';
import type { IslandFieldOwner } from '@abnehm/game-rules/hatching';
import { spentOnIsland } from '@abnehm/game-rules/progress';
import { formAt } from '@abnehm/game-rules/unlocks';

import { bookingsOf } from '../energy';
import type { ReadContext } from '../local-db';
import { areaUnlock, communityProject, couplingMember, island, islandEvent, islandField, islandObject, islandProgress } from '../local-db/schema';
import { sqliteOf } from '../local-db/sqlite';
import { halvesFor, type IslandHalves } from './halves';
import { islandProgressOf } from './island-entities';

// Die geschlüpfte Insel aus den lokalen Daten (Spezifikation 4, Abschnitte 2.1, 6, 7 und 11; #184, #191):
// Rollen, Felder mit Besitzer, Objekte auf den Feldern, freigeschaltete Gebiete, Inselfortschritt samt
// Levelbalken, Momo und die gemeinsamen Ereignisse für „Wir“. Fast alles kommt per Pull vom Server; nur
// eigene Bauten und damit die eigene Hälfte sind lokal sofort wirksam. Solange ein Teil fehlt, etwa
// zwischen zwei Seiten desselben Pulls, ist die Insel noch nicht lesbar.

const catalog = indexCatalog(gameCatalog);

/**
 * Ein Objekt auf seinem Feld mit der Grafik seiner Stufe, in der Form, die das Szenenmodell zeichnet
 * (`SceneObject`). Das Lesemodell importiert das Szenenmodell nicht, weil es Design-Tokens zieht.
 */
export type PlacedObject = Readonly<{ id: string; fieldKey: string; art: ArtKey; ownerPersonId: string }>;

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
  /** Levelbalken: Level und Partner aus der Projektion, die eigene Hälfte aus den eigenen Buchungen. */
  halves: IslandHalves;
  fields: readonly IslandFieldOwner[];
  /** Objekte auf Feldern; was im Lager liegt, steht nicht auf der Insel. */
  objects: readonly PlacedObject[];
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
  // Verbaute Energie dieser Insel: alle ihre Objekte und Projekte, auch eingelagerte Objekte.
  const holdings = {
    objectIds: new Set(db.select({ id: islandObject.id }).from(islandObject).where(eq(islandObject.islandId, islandId)).all().map((row) => row.id)),
    projectIds: new Set(db.select({ id: communityProject.id }).from(communityProject).where(eq(communityProject.islandId, islandId)).all().map((row) => row.id)),
  };

  return {
    islandId,
    viewerPersonId: personId,
    partnerPersonId: EntityId.parse(partner.personId),
    partnerDisplayName: partner.displayName,
    ownRole: IslandRole.parse(own.role),
    energy,
    progress,
    halves: halvesFor(progress, personId, spentOnIsland(bookingsOf(tx, personId), holdings)),
    fields: db
      .select({ key: islandField.fieldKey, ownerPersonId: islandField.ownerPersonId })
      .from(islandField)
      .where(eq(islandField.islandId, islandId))
      .orderBy(asc(islandField.fieldKey))
      .all(),
    objects: db
      .select({ id: islandObject.id, fieldKey: islandField.fieldKey, catalogKey: islandObject.catalogKey, level: islandObject.level, ownerPersonId: islandObject.ownerPersonId })
      .from(islandObject)
      .innerJoin(islandField, eq(islandField.id, islandObject.fieldId))
      .where(and(eq(islandObject.islandId, islandId), isNotNull(islandObject.fieldId), isNull(islandObject.deletedAt)))
      .orderBy(asc(islandField.fieldKey))
      .all()
      .map(({ id, fieldKey, catalogKey, level, ownerPersonId }) => ({ id, fieldKey, art: artOf(catalogKey, level), ownerPersonId })),
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
      .map((row) => ({ eventId: EntityId.parse(row.eventId), type: SharedEventType.parse(row.type), occurredAt: Instant.parse(row.occurredAt) })),
  };
}

/** Grafik eines Objekts: die Stufe eines Bauplans oder die Deko; einen unbekannten Schlüssel zeichnet die Insel neutral. */
function artOf(catalogKey: string, level: number): string {
  const blueprint = catalog.find('bauplan', catalogKey);
  if (blueprint.type === 'found') return blueprint.entry.art[level - 1] ?? catalogKey;
  const deko = catalog.find('deko', catalogKey);
  return deko.type === 'found' ? deko.entry.art : catalogKey;
}
