import type { EntityId } from '@abnehm/contracts/base';
import type { IslandRole } from '@abnehm/contracts/island';
import type { IslandObjectOrigin } from '@abnehm/contracts/island-records';
import { decidePlacement, decideUpgrade, nextStage } from '@abnehm/game-rules/building';
import type { ArtKey, CatalogIndex } from '@abnehm/game-rules/catalog';
import type { IslandFieldOwner } from '@abnehm/game-rules/hatching';

import type { ObjectFacts, PlacedObject, StoredObject } from './hatched-island';

// Optionen für Objekt-Sheet, Lager und Umstellen (Spezifikation 4, Abschnitte 3 und 7; #194): was ein
// angetipptes Objekt anbietet, was das Lager zeigt und welche Felder beim Umstellen und Platzieren
// leuchten. Ob aufgewertet oder platziert werden darf und was fehlt, entscheiden dieselben Spielregeln wie
// die lokalen Befehle (`decideUpgrade`, `decidePlacement`, geprüft wie auf dem Gerät). Ob ein Feld frei
// ist, prüfen diese Optionen wie die Befehle selbst.

/** Was die Optionen aus der geschlüpften Insel brauchen (`HatchedIsland`). */
export type ObjectSituation = Readonly<{
  viewerPersonId: string;
  ownRole: IslandRole;
  partnerDisplayName: string;
  /** Angezeigte eigene Energie, mindestens 0. */
  energy: number;
  fields: readonly IslandFieldOwner[];
  objects: readonly PlacedObject[];
  storage: readonly StoredObject[];
}>;

/** Was Aufwerten anbietet: möglich mit Preis, zu teuer mit „Noch ‹n› Energie“, oder gar nicht. */
export type UpgradeOption =
  | Readonly<{ type: 'moeglich'; toLevel: 2 | 3; price: number }>
  | Readonly<{ type: 'zu_teuer'; toLevel: 2 | 3; price: number; missing: number }>
  | Readonly<{ type: 'hoechste_stufe' }>
  | Readonly<{ type: 'keine_stufen' }>;

/** Inhalt des Objekt-Sheets: ein eigenes Objekt mit seinen Aktionen, eines des Partners nur mit Infos. */
export type ObjectSheet =
  | Readonly<{ type: 'eigen'; id: EntityId; name: string; art: ArtKey; level: number; upgrade: UpgradeOption; canMove: boolean }>
  | Readonly<{ type: 'partner'; id: EntityId; name: string; art: ArtKey; level: number; origin: IslandObjectOrigin; partnerName: string }>;

/** Art eines Stücks im Lager; Gebautes mit Stufe, ein Geschenk mit dem Namen des Partners. */
export type StorageKind =
  | Readonly<{ type: 'gebaut'; level: number }>
  | Readonly<{ type: 'geschenk'; from: string }>
  | Readonly<{ type: 'challenge' }>
  | Readonly<{ type: 'deko' }>;

export type StorageItem = Readonly<{ id: EntityId; name: string; art: ArtKey; kind: StorageKind; canPlace: boolean }>;

export type ObjectOptions = Readonly<{
  /** Das Objekt-Sheet für das Objekt auf dem Feld; `null` auf einem leeren Feld. */
  sheetAt(fieldKey: string): ObjectSheet | null;
  /** Freie eigene Felder, auf die das eigene Objekt darf; sie leuchten beim Umstellen und Platzieren. */
  placeFields(objectId: string): ReadonlySet<string>;
  /** Das eigene Lager in der Reihenfolge des Lesemodells. */
  storage: readonly StorageItem[];
}>;

export function objectOptions(catalog: CatalogIndex, situation: ObjectSituation): ObjectOptions {
  const { viewerPersonId, ownRole, partnerDisplayName, energy, fields, objects, storage } = situation;
  const occupied = new Set(objects.map((object) => object.fieldKey));
  const freeOwn = fields.filter((field) => field.ownerPersonId === viewerPersonId && !occupied.has(field.key));
  const person = { personId: viewerPersonId, role: ownRole };
  const own = new Map<string, ObjectFacts>([
    ...objects.filter((object) => object.ownerPersonId === viewerPersonId).map((object) => [object.id, object] as const),
    ...storage.map((object) => [object.id, object] as const),
  ]);

  const nameOf = (catalogKey: string) => {
    const blueprint = catalog.find('bauplan', catalogKey);
    if (blueprint.type === 'found') return blueprint.entry.name;
    const deko = catalog.find('deko', catalogKey);
    return deko.type === 'found' ? deko.entry.name : catalogKey;
  };
  const placeFields = (objectId: string): ReadonlySet<string> => {
    const object = own.get(objectId);
    if (object === undefined) return new Set();
    return new Set(freeOwn.filter((field) => decidePlacement(catalog, { object, field, person }).type === 'erlaubt').map((field) => field.key));
  };
  const upgradeOf = (object: ObjectFacts): UpgradeOption => {
    if (object.origin !== 'gebaut') return { type: 'keine_stufen' };
    const toLevel = nextStage(object.level);
    if (toLevel === null) return { type: 'hoechste_stufe' };
    const decision = decideUpgrade(catalog, { object, toLevel, balance: energy, checkedBy: 'geraet' });
    if (decision.type === 'erlaubt') return { type: 'moeglich', toLevel, price: decision.price };
    if (decision.reason !== 'zu_wenig_energie') return { type: 'keine_stufen' };
    return { type: 'zu_teuer', toLevel, price: decision.price, missing: decision.missing };
  };
  const kindOf = (object: StoredObject): StorageKind => {
    if (object.giftFrom !== null) return { type: 'geschenk', from: object.giftFrom };
    if (object.origin === 'gebaut') return { type: 'gebaut', level: object.level };
    return object.origin === 'challenge' ? { type: 'challenge' } : { type: 'deko' };
  };

  return {
    sheetAt(fieldKey) {
      const object = objects.find((candidate) => candidate.fieldKey === fieldKey);
      if (object === undefined) return null;
      const base = { id: object.id, name: nameOf(object.catalogKey), art: object.art, level: object.level };
      if (object.ownerPersonId !== viewerPersonId) return { type: 'partner', ...base, origin: object.origin, partnerName: partnerDisplayName };
      return { type: 'eigen', ...base, upgrade: upgradeOf(object), canMove: placeFields(object.id).size > 0 };
    },
    placeFields,
    storage: storage.map((object) => ({ id: object.id, name: nameOf(object.catalogKey), art: object.art, kind: kindOf(object), canPlace: placeFields(object.id).size > 0 })),
  };
}
