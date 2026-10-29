import type { PlanReader } from '@abnehm/contracts/ports';

import { PortContractError, type ReadAccess } from '../area-ports';
import { readEffectivePlan } from './plan-repository';

/**
 * `PlanReader` über SQLite (Spezifikation 0, Abschnitt 3): die Abfrage des gültigen Plans und die Fabrik,
 * die der Composition Root für `composeAreaPorts` meldet. Er liest in einer Lesetransaktion und prüft
 * jede Rückgabe gegen `EffectivePlan`; einen Verstoß meldet er wie die Port-Prüfung als
 * `PortContractError`. So gilt die Prüfung auch, solange der Composition Root ihn einzeln übergibt, weil
 * die übrigen Pflichtports noch fehlen.
 */
export function planReaderOf(db: ReadAccess): PlanReader {
  return {
    async effectivePlan(personId, localDate) {
      const plan = db.read((tx) => readEffectivePlan(tx, personId, localDate));
      if (!plan.success) throw new PortContractError('planReader', 'effectivePlan', plan.error.issues);
      return plan.data;
    },
  };
}
