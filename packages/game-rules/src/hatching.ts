import type { IslandRole } from '@abnehm/contracts/island';

import { baseIslandKey, fieldKey, type FieldSide, type GameCatalog } from './catalog.ts';
import { projectNeed } from './projects.ts';
import { unlocksAt, type UnlockedBlueprint } from './unlocks.ts';

// Schlüpfen (Spezifikation 4, Abschnitte 5 und 7): Was die angenommene Rollenwahl materialisiert. Die
// vorschlagende Person hat ihre Rolle gewählt, der Partner bekommt die andere. Felder gehören danach
// einer Person und bleiben bei ihr, auch nach einem Rollentausch.
//
// Welche Person welche Seite des Katalogs bekommt, legt die Spezifikation nicht fest; hier gilt: Seite a
// gehört der Person, die beim Schlüpfen Bauen hat, Seite b der mit Natur (Festlegung in #184, nicht
// belegt). Dann stimmen Bereich und Rolle beim Schlüpfen überein, wie in der Fixture-Insel aus #182.

/** Die Rolle des Partners, wenn die vorschlagende Person `role` wählt. */
export function otherRole(role: IslandRole): IslandRole {
  return role === 'bauen' ? 'natur' : 'bauen';
}

export type HatchingRequest = Readonly<{
  proposerPersonId: string;
  proposerRole: IslandRole;
  /** Die Person, die die Rollenwahl angenommen hat. */
  partnerPersonId: string;
}>;

/** Ein Feld der Grundinsel mit Besitzer; `null` bei Strand, Lichtung und Gemeinschaftsplatz. */
export type HatchedField = Readonly<{ key: string; ownerPersonId: string | null }>;

export type Hatching = Readonly<{
  /** Je Rolle die Person. */
  roles: Readonly<Record<IslandRole, string>>;
  /** Die Startfelder beider Personen samt gemeinsamer Bereiche: die Grundinsel. */
  fields: readonly HatchedField[];
  /** Die Start-Baupläne beider Rollen (Level 1). */
  blueprints: readonly UnlockedBlueprint[];
  /** Gemeinschaftsprojekt 1 mit festgeschriebenem Bedarf je Anteil. */
  project: Readonly<{ sequenceNumber: 1; templateKey: string; buildNeed: number; natureNeed: number }>;
}>;

const sideOfRole: Readonly<Record<IslandRole, FieldSide>> = { bauen: 'a', natur: 'b' };

export function hatching(catalog: GameCatalog, { proposerPersonId, proposerRole, partnerPersonId }: HatchingRequest): Hatching {
  if (proposerPersonId === partnerPersonId) throw new Error('Schlüpfen braucht zwei verschiedene Personen');
  const roles = { [proposerRole]: proposerPersonId, [otherRole(proposerRole)]: partnerPersonId } as Record<IslandRole, string>;
  const sides: Record<FieldSide, string> = { [sideOfRole.bauen]: roles.bauen, [sideOfRole.natur]: roles.natur } as Record<FieldSide, string>;
  const first = catalog.projects[0];
  if (first === undefined) throw new Error('Der Spielkatalog hat kein Gemeinschaftsprojekt');
  const need = projectNeed(1);
  return {
    roles,
    fields: catalog.baseIsland.fields.map((field) => ({
      key: fieldKey(baseIslandKey, field),
      ownerPersonId: 'side' in field ? sides[field.side] : null,
    })),
    blueprints: unlocksAt(catalog, 1).blueprints,
    project: { sequenceNumber: 1, templateKey: first.key, buildNeed: need, natureNeed: need },
  };
}
