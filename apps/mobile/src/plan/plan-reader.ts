import type { PlanReader } from '@abnehm/contracts/ports';

import type { ReadAccess } from '../area-ports';
import { readEffectivePlan } from './plan-repository';

/**
 * `PlanReader` über SQLite (Spezifikation 0, Abschnitt 3): die Fabrik, die der Composition Root für
 * `composeAreaPorts` meldet. Er liest in einer Lesetransaktion; jede Rückgabe ist gegen `EffectivePlan`
 * geprüft.
 */
export function planReaderOf(db: ReadAccess): PlanReader {
  return { effectivePlan: async (personId, localDate) => db.read((tx) => readEffectivePlan(tx, personId, localDate)) };
}
