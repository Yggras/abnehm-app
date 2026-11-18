import type { Instant, ServerVersion } from '@abnehm/contracts/base';

/**
 * Ein gespeicherter Import samt Löschmarkierung und Serverversion, wie ihn der Health-Import abgleicht
 * (#183). Die Repositories von Sport und Gewicht liefern ihn mit der Nutzlast ihrer Import-Variante.
 */
export type StoredImport<P> = Readonly<{ payload: P; deletedAt: Instant | null; serverVersion: ServerVersion | null }>;
