import { and, eq, isNull } from 'drizzle-orm';

import type { DisplayName } from '@abnehm/contracts/base';

import type { ReadContext } from '../local-db';
import { readOwnPerson } from '../local-db/person-header';
import { coupling, couplingMember } from '../local-db/schema';
import { sqliteOf } from '../local-db/sqlite';
import { readPartnerCache } from '../partner-cache';

// Stand der Kopplung für die Abläufe `partner.invite` und `partner.redeem` (#120), ausschließlich aus SQLite: Die
// Online-Abläufe nennen nur, was der Server angenommen hat; ob die Kopplung auf dem Gerät steht, zeigt erst der Pull
// (#103). „Geschlüpft“ heißt, das eigene Kopplungsmitglied hat eine Rolle; die fehlt bis zum Schlüpfen (Vertrag
// `CouplingMemberRecord`). Eine neue Kopplung beginnt ohne Rollen, eine reaktivierte bringt sie zurück (#83).

export type CouplingState =
  | Readonly<{ type: 'loading' }>
  | Readonly<{ type: 'solo' }>
  | Readonly<{ type: 'coupled'; partnerDisplayName: DisplayName; hatched: boolean }>;

export function readCouplingState(tx: ReadContext): CouplingState {
  const own = readOwnPerson(tx);
  if (own === undefined) return { type: 'loading' };
  const { partner } = readPartnerCache(tx);
  if (partner === null) return { type: 'solo' };
  const ownMember = sqliteOf(tx)
    .select({ role: couplingMember.role })
    .from(couplingMember)
    .innerJoin(coupling, eq(coupling.id, couplingMember.couplingId))
    .where(and(eq(coupling.status, 'aktiv'), eq(couplingMember.personId, own.id), isNull(couplingMember.deletedAt)))
    .get();
  return { type: 'coupled', partnerDisplayName: partner.displayName, hatched: ownMember?.role != null };
}
