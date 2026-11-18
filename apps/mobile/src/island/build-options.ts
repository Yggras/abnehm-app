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

  /**
   * Was fehlt, damit der Bauplan auf das Feld kommt: `null`, wenn er dort nicht darf, sonst die fehlende
   * Energie (0, wenn sie reicht). Fehlende Energie lässt das Feld gültig; sie zeigt das Sheet.
   */
  const missingOn = (blueprintKey: string, field: IslandFieldOwner): number | null => {
    const decision = decideBuild(catalog, { blueprintKey, field, person, unlockedBlueprints: unlocked, balance: energy, checkedBy: 'geraet' });
    if (decision.type === 'erlaubt') return 0;
    return decision.reason === 'zu_wenig_energie' ? decision.missing : null;
  };
  const fieldsFor = (blueprintKey: string) => new Set(freeOwn.filter((field) => missingOn(blueprintKey, field) !== null).map((field) => field.key));

  const unlockedBlueprintList = gameCatalog.blueprints.filter((blueprint) => unlocked.has(blueprint.key));
  /** Die Baupläne, die auf mindestens eines der Felder dürfen, mit dem, was auf dem ersten davon fehlt. */
  const optionsOn = (candidates: readonly IslandFieldOwner[]): BlueprintOption[] =>
    unlockedBlueprintList
      .flatMap((blueprint): BlueprintOption[] => {
        for (const field of candidates) {
          const missing = missingOn(blueprint.key, field);
          if (missing !== null) {
            return [{ key: blueprint.key, name: blueprint.name, role: blueprint.role, price: basePrice(blueprint), missing, art: blueprint.art[0] }];
          }
        }
        return [];
      })
      .sort((a, b) => Number(a.role !== ownRole) - Number(b.role !== ownRole) || a.price - b.price || a.name.localeCompare(b.name, 'de'));

  return {
    blueprints(fieldKey) {
      if (fieldKey === null) return optionsOn(freeOwn);
      const field = freeOwn.find((candidate) => candidate.key === fieldKey);
      return field === undefined ? [] : optionsOn([field]);
    },
    fields: fieldsFor,
    opensSheet: (fieldKey) => freeOwnKeys.has(fieldKey),
  };
}
