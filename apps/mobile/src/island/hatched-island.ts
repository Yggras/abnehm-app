import { and, asc, eq, inArray, isNotNull, isNull } from 'drizzle-orm';

import { EntityId, Instant } from '@abnehm/contracts/base';
import { IslandRole, MomoAppearance, type IslandProgress } from '@abnehm/contracts/island';
import { IslandObjectOrigin } from '@abnehm/contracts/island-records';
import { SharedEventType } from '@abnehm/contracts/wir';
import { indexCatalog, type ArtKey } from '@abnehm/game-rules/catalog';
import { gameCatalog } from '@abnehm/game-rules/content';
import type { IslandFieldOwner } from '@abnehm/game-rules/hatching';
import { spentOnIsland } from '@abnehm/game-rules/progress';
import { formAt } from '@abnehm/game-rules/unlocks';

import { bookingsOf } from '../energy';
import type { ReadContext } from '../local-db';
import { areaUnlock, blueprintUnlock, communityProject, couplingMember, island, islandEvent, islandField, islandObject, islandProgress, sharedAction } from '../local-db/schema';
import { sqliteOf } from '../local-db/sqlite';
import { halvesFor, type IslandHalves } from './halves';
import { islandProgressOf } from './island-entities';
import { readIslandEvents, type IslandEvents } from './island-events';

// Die geschlüpfte Insel aus den lokalen Daten (Spezifikation 4, Abschnitte 2.1, 6, 7 und 11; #184, #191):
// Rollen, Felder mit Besitzer, Objekte auf den Feldern, das eigene Lager (#194), freigeschaltete Gebiete, Inselfortschritt samt
// Levelbalken, Momo, die gemeinsamen Ereignisse für „Wir“ und die offenen Insel-Ereignisse der Person (#202). Fast alles kommt per Pull vom Server; nur
// eigene Bauten und damit die eigene Hälfte sind lokal sofort wirksam. Solange ein Teil fehlt, etwa
// zwischen zwei Seiten desselben Pulls, ist die Insel noch nicht lesbar.

const catalog = indexCatalog(gameCatalog);

/** Was ein Inselobjekt ist: Katalogschlüssel, Herkunft und Stufe (#194). */
export type ObjectFacts = Readonly<{ catalogKey: string; origin: IslandObjectOrigin; level: number }>;

/**
 * Ein Objekt auf seinem Feld mit der Grafik seiner Stufe, in der Form, die das Szenenmodell zeichnet
 * (`SceneObject`). Das Lesemodell importiert das Szenenmodell nicht, weil es Design-Tokens zieht.
 */
export type PlacedObject = ObjectFacts & Readonly<{ id: EntityId; fieldKey: string; art: ArtKey; ownerPersonId: string }>;

/**
 * Ein Objekt im eigenen Lager (#194): eingelagert oder verdrängt, Deko und Challenge-Deko. Ein Geschenk
 * nennt, wer es geschenkt hat; das ist ein angenommenes `deko_schenken` des Partners für dieses Stück (#198).
 */
export type StoredObject = ObjectFacts & Readonly<{ id: EntityId; art: ArtKey; giftFrom: string | null }>;

/** Ein materialisiertes Inselfeld; über seine ID baut der Spieldienst darauf. */
export type IslandField = IslandFieldOwner & Readonly<{ id: EntityId }>;

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
  fields: readonly IslandField[];
  /** Objekte auf Feldern; was im Lager liegt, steht nicht auf der Insel. */
  objects: readonly PlacedObject[];
  /** Das eigene Lager, älteste Objekte zuerst (#194). */
  storage: readonly StoredObject[];
  unlockedAreas: readonly string[];
  /** Schlüssel der Baupläne, die die Insel freigeschaltet hat (#192). */
  unlockedBlueprints: readonly string[];
  appearance: MomoAppearance;
  sharedEvents: readonly SharedIslandEvent[];
  /** Was für die betrachtende Person auf der Insel wartet: Besucher mit Wunsch (#202). */
  events: IslandEvents;
}>;

/**
 * Momo, wie beide Personen es sehen: Form aus dem Level der Projektion. Die Stimmung gehört nur der
 * betrachtenden Person; der Spieldienst leitet sie je Ansicht ab und ersetzt den Standard „zufrieden“ (#188).
 * Accessoires liefert „Momos Wunsch, Schrank und Ankleiden“ (#206); bis dahin trägt Momo nichts.
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
      .select({ id: islandField.id, key: islandField.fieldKey, ownerPersonId: islandField.ownerPersonId })
      .from(islandField)
      .where(eq(islandField.islandId, islandId))
      .orderBy(asc(islandField.fieldKey))
      .all()
      .map((field) => ({ ...field, id: EntityId.parse(field.id) })),
    objects: db
      .select({
        id: islandObject.id,
        fieldKey: islandField.fieldKey,
        catalogKey: islandObject.catalogKey,
        origin: islandObject.origin,
        level: islandObject.level,
        ownerPersonId: islandObject.ownerPersonId,
      })
      .from(islandObject)
      .innerJoin(islandField, eq(islandField.id, islandObject.fieldId))
      .where(and(eq(islandObject.islandId, islandId), isNotNull(islandObject.fieldId), isNull(islandObject.deletedAt)))
      .orderBy(asc(islandField.fieldKey))
      .all()
      .map(({ id, origin, ...object }) => ({ ...object, id: EntityId.parse(id), origin: IslandObjectOrigin.parse(origin), art: artOf(object.catalogKey, object.level) })),
    storage: readStorage(tx, { islandId, couplingId, personId, partnerPersonId: partner.personId, partnerDisplayName: partner.displayName }),
    unlockedAreas: db
      .select({ key: areaUnlock.areaKey })
      .from(areaUnlock)
      .where(eq(areaUnlock.islandId, islandId))
      .orderBy(asc(areaUnlock.level))
      .all()
      .map((row) => row.key),
    unlockedBlueprints: db
      .select({ key: blueprintUnlock.catalogKey })
      .from(blueprintUnlock)
      .where(eq(blueprintUnlock.islandId, islandId))
      .orderBy(asc(blueprintUnlock.catalogKey))
      .all()
      .map((row) => row.key),
    appearance: appearanceAt(progress.level),
    // Die Entdeckung eines Gebiets ist zugleich das gemeinsame Ereignis „neues Gebiet“ (#204).
    sharedEvents: db
      .select({ eventId: islandEvent.id, type: islandEvent.type, occurredAt: islandEvent.occurredAt })
      .from(islandEvent)
      .where(and(eq(islandEvent.islandId, islandId), inArray(islandEvent.type, [...SharedEventType.options, 'entdeckung'])))
      .orderBy(asc(islandEvent.occurredAt))
      .all()
      .map((row) => ({
        eventId: EntityId.parse(row.eventId),
        type: row.type === 'entdeckung' ? 'gebiet' : SharedEventType.parse(row.type),
        occurredAt: Instant.parse(row.occurredAt),
      })),
    events: readIslandEvents(tx, { islandId, personId }),
  };
}

/** Das eigene Lager: eigene, nicht gelöschte Objekte ohne Feld, Geschenke mit dem Namen des Partners. */
function readStorage(
  tx: ReadContext,
  { islandId, couplingId, personId, partnerPersonId, partnerDisplayName }: Readonly<{ islandId: EntityId; couplingId: EntityId; personId: EntityId; partnerPersonId: string; partnerDisplayName: string }>,
): StoredObject[] {
  const db = sqliteOf(tx);
  const gifts = new Set(
    db
      .select({ requester: sharedAction.requesterPersonId, payload: sharedAction.payload })
      .from(sharedAction)
      .where(and(eq(sharedAction.couplingId, couplingId), eq(sharedAction.kind, 'deko_schenken'), eq(sharedAction.status, 'angenommen')))
      .all()
      .filter((action) => action.requester === partnerPersonId)
      .map((action) => action.payload.islandObjectId),
  );
  return db
    .select({ id: islandObject.id, catalogKey: islandObject.catalogKey, origin: islandObject.origin, level: islandObject.level })
    .from(islandObject)
    .where(and(eq(islandObject.islandId, islandId), eq(islandObject.ownerPersonId, personId), isNull(islandObject.fieldId), isNull(islandObject.deletedAt)))
    .orderBy(asc(islandObject.createdAt), asc(islandObject.id))
    .all()
    .map(({ id, catalogKey, origin, level }) => ({
      id: EntityId.parse(id),
      catalogKey,
      origin: IslandObjectOrigin.parse(origin),
      level,
      art: artOf(catalogKey, level),
      giftFrom: gifts.has(id) ? partnerDisplayName : null,
    }));
}

/** Grafik eines Objekts: die Stufe eines Bauplans oder die Deko; einen unbekannten Schlüssel zeichnet die Insel neutral. */
function artOf(catalogKey: string, level: number): string {
  const blueprint = catalog.find('bauplan', catalogKey);
  if (blueprint.type === 'found') return blueprint.entry.art[level - 1] ?? catalogKey;
  const deko = catalog.find('deko', catalogKey);
  return deko.type === 'found' ? deko.entry.art : catalogKey;
}
