import { z } from 'zod';

import { CatalogKey, EntityId, Instant } from './base.ts';
import { IslandEventKind } from './island.ts';
import { SharedEventType } from './wir.ts';

// Kanonische Datensätze der Inselinhalte im Sync (Spezifikation 0, Abschnitt 8 „Energie, Insel und
// Spiel“). Sie gehören der Kopplung und entstehen nur serverseitig, etwa beim Schlüpfen (Spezifikation 4,
// Abschnitt 7); ein generisches Upsert gibt es nicht. Die ID trägt der Datensatz nicht, sie ist die
// Entitäts-ID der Änderung. Den Inselfortschritt überträgt `IslandProgress` aus `island.ts`.

const owned = { islandId: EntityId, couplingId: EntityId };

/** Bauplanfreischaltung: Insel, Katalogschlüssel, Grund und Zeitpunkt; unveränderlich. */
export const BlueprintUnlockRecord = z.strictObject({
  ...owned,
  catalogKey: CatalogKey,
  reason: z.enum(['start', 'level', 'entdeckung', 'besucher']),
  unlockedAt: Instant,
  createdAt: Instant,
});
export type BlueprintUnlockRecord = z.infer<typeof BlueprintUnlockRecord>;

/** Gebietsfreischaltung: Gebiet bzw. Ausprägung einer Landschaftsvorlage ab Level 4; unveränderlich. */
export const AreaUnlockRecord = z.strictObject({
  ...owned,
  areaKey: CatalogKey,
  level: z.int().min(4),
  unlockedAt: Instant,
  createdAt: Instant,
});
export type AreaUnlockRecord = z.infer<typeof AreaUnlockRecord>;

/** Inselfeld `‹gebiet›:‹x›:‹y›` aus dem Spielkatalog; ohne Besitzer bei Strand, Lichtung und Gemeinschaftsplatz. */
export const IslandFieldRecord = z.strictObject({
  ...owned,
  fieldKey: z.string().regex(/^[a-z][a-z0-9_]*:-?\d+:-?\d+$/),
  ownerPersonId: EntityId.nullable(),
  createdAt: Instant,
});
export type IslandFieldRecord = z.infer<typeof IslandFieldRecord>;

/** Herkunft eines Inselobjekts: mit Energie gebaut oder als Deko aus Besuch, Entdeckung, Jahreszeit oder Challenge. */
export const IslandObjectOrigin = z.enum(['gebaut', 'besucher', 'entdeckung', 'jahreszeit', 'challenge']);
export type IslandObjectOrigin = z.infer<typeof IslandObjectOrigin>;

/**
 * Inselobjekt: gebauter Bauplan oder Deko einer Person, Stufe 1–3. Es belegt höchstens ein Feld; ohne
 * Feld liegt es im Lager seines Besitzers (Spezifikation 0, Abschnitt 8). Die zugehörige Energiebuchung
 * verweist auf das Objekt, nicht umgekehrt; sie liest nur ihr Eigentümer.
 */
export const IslandObjectRecord = z.strictObject({
  ...owned,
  ownerPersonId: EntityId,
  catalogKey: CatalogKey,
  origin: IslandObjectOrigin,
  level: z.int().min(1).max(3),
  /** Belegtes Inselfeld; `null` im Lager. */
  fieldId: EntityId.nullable(),
  createdAt: Instant,
  updatedAt: Instant,
});
export type IslandObjectRecord = z.infer<typeof IslandObjectRecord>;

/** Gemeinschaftsprojekt mit festgeschriebenem Bedarf je Anteil; fertig genau mit Abschlusszeitpunkt. */
export const CommunityProjectRecord = z
  .strictObject({
    ...owned,
    sequenceNumber: z.int().positive(),
    templateKey: CatalogKey,
    buildNeed: z.int().positive(),
    natureNeed: z.int().positive(),
    status: z.enum(['aktiv', 'fertig']),
    completedAt: Instant.nullable(),
    createdAt: Instant,
    updatedAt: Instant,
  })
  .refine((project) => (project.status === 'fertig') === (project.completedAt !== null), {
    message: '`completedAt` genau bei fertigen Projekten',
    path: ['completedAt'],
  });
export type CommunityProjectRecord = z.infer<typeof CommunityProjectRecord>;

/**
 * Insel-Ereignis: die Arten aus Spezifikation 4, Abschnitt 9, und die gemeinsamen Ereignisse für „Neu
 * bei euch“ (`SharedEventType`), etwa „Momo ist geschlüpft“. Den Stand je Person führt `island_event_state`.
 */
export const IslandEventRecord = z.strictObject({
  ...owned,
  type: z.union([IslandEventKind, SharedEventType]),
  templateKey: CatalogKey.nullable(),
  /** Zuständige Person bei personenbezogenen Ereignissen (Besucher, Momos Wunsch). */
  responsiblePersonId: EntityId.nullable(),
  /** Eindeutig je Insel (Spezifikation 0, Abschnitt 8). */
  occasionKey: z.string().min(1).max(200),
  status: z.enum(['offen', 'erfuellbar', 'abgeschlossen']),
  reward: z.record(z.string(), z.unknown()).nullable(),
  occurredAt: Instant,
  createdAt: Instant,
  updatedAt: Instant,
});
export type IslandEventRecord = z.infer<typeof IslandEventRecord>;
