import type { EntityId, LocalDate } from '@abnehm/contracts/base';
import { planVersionOfKey, type PlanVersionKind } from '@abnehm/contracts/plan';

import type { ResourceTarget } from '../authorization/authorization.ts';

/**
 * Ziel eines Fachbefehls für eine Fassung: ihre ID aus Person und `valid_from` des Schlüssels. Die Person
 * im Schlüssel ist nur ein Anspruch; weicht sie von der Sitzung ab, verweigert die Autorisierung. Einen
 * Schlüssel ohne diese Form verweigert sie ebenso, weil er keine Ressource nennt.
 */
export function planCommandTarget(
  kind: PlanVersionKind,
  businessKey: string,
  idOf: (personId: EntityId, validFrom: LocalDate) => EntityId,
): ResourceTarget {
  const version = planVersionOfKey(kind, businessKey);
  return version === null ? {} : { id: idOf(version.personId, version.validFrom), claimedOwnerPersonId: version.personId };
}
