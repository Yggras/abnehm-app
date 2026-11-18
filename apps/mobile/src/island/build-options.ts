import type { IslandRole } from '@abnehm/contracts/island';
import { decideBuild } from '@abnehm/game-rules/building';
import { indexCatalog, type ArtKey } from '@abnehm/game-rules/catalog';
import { gameCatalog } from '@abnehm/game-rules/content';
import type { IslandFieldOwner } from '@abnehm/game-rules/hatching';
import { basePrice } from '@abnehm/game-rules/prices';

// Bauoptionen für Bau-Sheet und Bau-Modus (Spezifikation 4, Abschnitte 3 und 7; #192): welche Baupläne das
// Sheet zeigt, was sie kosten und welche Felder im Bau-Modus leuchten. Ob ein Bauplan auf ein Feld darf und
// was fehlt, entscheidet dieselbe Spielregel wie beim Bauen selbst (`decideBuild`, geprüft wie auf dem
// Gerät). Ob ein Feld frei ist, prüft die Regel nicht; das tun diese Optionen wie der lokale Bau-Befehl.

const catalog = indexCatalog(gameCatalog);

/** Was die Optionen aus der geschlüpften Insel brauchen (`HatchedIsland`). */
export type BuildSituation = Readonly<{
  viewerPersonId: string;
  ownRole: IslandRole;
  /** Angezeigte eigene Energie, mindestens 0. */
  energy: number;
  unlockedBlueprints: readonly string[];
  fields: readonly IslandFieldOwner[];
  /** Objekte auf Feldern; ihre Felder sind belegt. */
  objects: readonly Readonly<{ fieldKey: string }>[];
}>;

/** Ein Bauplan im Bau-Sheet; `missing` ist 0, wenn die Energie reicht, sonst „Noch ‹n› Energie“. */
export type BlueprintOption = Readonly<{ key: string; name: string; role: IslandRole; price: number; missing: number; art: ArtKey }>;

export type BuildOptions = Readonly<{
  /**
   * Baupläne für das Sheet: nach Tipp auf ein Feld die, die dort dürfen; über „Bauen“ (`null`) alle, die auf
   * mindestens ein freies eigenes Feld dürfen. Die eigene Rolle zuerst, dann nach Preis.
   */
  blueprints(fieldKey: string | null): BlueprintOption[];
  /** Freie Felder, auf die der Bauplan darf; sie leuchten im Bau-Modus. */
  fields(blueprintKey: string): ReadonlySet<string>;
  /** Ob ein Tipp auf das Feld das Bau-Sheet öffnet: Es gehört der Person und ist frei. */
  opensSheet(fieldKey: string): boolean;
}>;

export function buildOptions({ viewerPersonId, ownRole, energy, unlockedBlueprints, fields, objects }: BuildSituation): BuildOptions {
  const occupied = new Set(objects.map((object) => object.fieldKey));
  const freeOwn = fields.filter((field) => field.ownerPersonId === viewerPersonId && !occupied.has(field.key));
  const freeOwnKeys = new Set(freeOwn.map((field) => field.key));
  const unlocked = new Set(unlockedBlueprints);
  const person = { personId: viewerPersonId, role: ownRole };

  /** Ob der Bauplan auf das Feld darf; fehlende Energie zählt hier nicht, sie zeigt das Sheet. */
  const fits = (blueprintKey: string, field: IslandFieldOwner) => {
    const decision = decideBuild(catalog, { blueprintKey, field, person, unlockedBlueprints: unlocked, balance: energy, checkedBy: 'geraet' });
    return decision.type === 'erlaubt' || decision.reason === 'zu_wenig_energie';
  };
  const fieldsFor = (blueprintKey: string) => new Set(freeOwn.filter((field) => fits(blueprintKey, field)).map((field) => field.key));

  const options = gameCatalog.blueprints
    .filter((blueprint) => unlocked.has(blueprint.key))
    .map((blueprint): BlueprintOption => {
      const price = basePrice(blueprint);
      return { key: blueprint.key, name: blueprint.name, role: blueprint.role, price, missing: Math.max(0, price - energy), art: blueprint.art[0] };
    })
    .sort((a, b) => Number(a.role !== ownRole) - Number(b.role !== ownRole) || a.price - b.price || a.name.localeCompare(b.name, 'de'));

  return {
    blueprints(fieldKey) {
      if (fieldKey === null) return options.filter((option) => fieldsFor(option.key).size > 0);
      const field = freeOwn.find((candidate) => candidate.key === fieldKey);
      return field === undefined ? [] : options.filter((option) => fits(option.key, field));
    },
    fields: fieldsFor,
    opensSheet: (fieldKey) => freeOwnKeys.has(fieldKey),
  };
}
