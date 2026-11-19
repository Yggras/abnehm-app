import type { EntityId, Instant, ServerVersion } from '@abnehm/contracts/base';

/**
 * Ein gespeicherter Import samt Eigentümer, Löschmarkierung und Serverversion, wie ihn der Health-Import
 * abgleicht (#183) und die Befehle für importierte Einträge ändern (#186). Die Repositories von Sport und
 * Gewicht liefern ihn mit der Nutzlast ihrer Import-Variante.
 */
export type StoredImport<P> = Readonly<{ personId: EntityId; payload: P; deletedAt: Instant | null; serverVersion: ServerVersion | null }>;
