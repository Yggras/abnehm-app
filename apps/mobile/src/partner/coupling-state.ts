import { and, eq, isNull } from 'drizzle-orm';

import { DisplayName, EntityId, Instant } from '@abnehm/contracts/base';

import type { ReadContext } from '../local-db';
import { readOwnPerson } from '../local-db/person-header';
import { coupling, couplingMember } from '../local-db/schema';
import { sqliteOf } from '../local-db/sqlite';

// Stand der Kopplung für die Abläufe `partner.invite` und `partner.redeem` (#120), ausschließlich aus SQLite: Die
// Online-Abläufe nennen nur, was der Server angenommen hat; ob die Kopplung auf dem Gerät steht, zeigt erst der Pull
// (#103). „Geschlüpft“ heißt, das eigene Kopplungsmitglied hat eine Rolle; die fehlt bis zum Schlüpfen (Vertrag
// `CouplingMemberRecord`). Eine neue Kopplung beginnt ohne Rollen, eine reaktivierte bringt sie zurück (#83).

export type CouplingState =
  | Readonly<{ type: 'loading' }>
  | Readonly<{ type: 'solo' }>
  | Readonly<{
      type: 'coupled';
      partnerDisplayName: DisplayName;
      hatched: boolean;
      couplingId: EntityId;
      /** Beginn bzw. letzte Reaktivierung der Kopplung: seitdem gibt es Momo und die Insel wieder. */
      since: Instant;
    }>;

/** Die gekoppelte Ausprägung, wie „Ihr seid gekoppelt“ sie zeigt. */
export type Coupled = Extract<CouplingState, { type: 'coupled' }>;

/** Beide Mitglieder der aktiven Kopplung in einer Abfrage; den Namen des Partners pflegt nur der Server. */
export function readCouplingState(tx: ReadContext): CouplingState {
  const own = readOwnPerson(tx);
  if (own === undefined) return { type: 'loading' };
  const members = sqliteOf(tx)
    .select({
      couplingId: coupling.id, startedAt: coupling.startedAt, reactivatedAt: coupling.reactivatedAt,
      personId: couplingMember.personId, displayName: couplingMember.displayName, role: couplingMember.role,
    })
    .from(couplingMember)
    .innerJoin(coupling, eq(coupling.id, couplingMember.couplingId))
    .where(and(eq(coupling.status, 'aktiv'), isNull(couplingMember.deletedAt)))
    .all();
  const partner = members.find((member) => member.personId !== own.id);
  if (partner === undefined) return { type: 'solo' };
  const ownMember = members.find((member) => member.personId === own.id);
  return {
    type: 'coupled',
    partnerDisplayName: DisplayName.parse(partner.displayName),
    hatched: ownMember?.role != null,
    couplingId: EntityId.parse(partner.couplingId),
    since: Instant.parse(partner.reactivatedAt ?? partner.startedAt),
  };
}
