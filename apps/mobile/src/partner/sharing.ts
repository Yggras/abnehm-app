import type { Clock } from '@abnehm/clock';
import { and, eq } from 'drizzle-orm';

import { AreaKey, Instant, type DisplayName } from '@abnehm/contracts/base';

import type { ReadContext, TransactionContext } from '../local-db';
import { requireOwnPerson } from '../local-db/person-header';
import { partnerSharing, photoSharing } from '../local-db/schema';
import { sqliteOf } from '../local-db/sqlite';
import { setPartnerSharing, setPhotoSharing, type SyncWriter } from '../sync';
import { readCouplingState } from './coupling-state';

// Die eigenen Freigaben der aktiven Kopplung für „Partner & Freigaben“ und den Onboarding-Schritt `partner`
// (Spezifikation 5, Abschnitte 5 und 6; #129). Eine Partnerfreigabe je Gesundheitsbereich (`privat |
// zusammengefasst`) und die Fotofreigabe (`privat | geteilt`) erscheinen als Schalter: an heißt, der Partner sieht
// die Zusammenfassung bzw. die Mahlzeitenfotos. Ein Wechsel ist ein sofortiger lokaler Upsert mit Outbox über die
// Registrierung des Fundaments (#106); Widerruf, Notices und Sicherheitslog erledigt der Server bei der Annahme.

export type Sharing =
  | Readonly<{ type: 'loading' }>
  | Readonly<{ type: 'solo' }>
  | Readonly<{
      type: 'coupled';
      partnerDisplayName: DisplayName;
      /** Beginn bzw. letzte Reaktivierung der Kopplung: seitdem gibt es Momo und die Insel wieder. */
      since: Instant;
      /** Je Gesundheitsbereich, ob der Partner die Zusammenfassung sieht. */
      areas: Readonly<Record<AreaKey, boolean>>;
      /** Ob der Partner die Mahlzeitenfotos sieht. */
      photos: boolean;
    }>;

/** Ein Schalterwechsel: ein Gesundheitsbereich oder die Mahlzeitenfotos. */
export type SharingChange = Readonly<{ type: 'area'; area: AreaKey; shared: boolean }> | Readonly<{ type: 'photos'; shared: boolean }>;

/** `not_coupled`, wenn die Kopplung inzwischen endete, etwa per Pull nach einer Entkopplung durch den Partner. */
export type SharingOutcome = Readonly<{ type: 'saved' }> | Readonly<{ type: 'not_coupled' }>;

/** Kopplung samt eigenen Freigaben; bis alle Freigaben der Kopplung per Pull da sind, lädt sie. */
export function readSharing(tx: ReadContext): Sharing {
  const state = readCouplingState(tx);
  if (state.type !== 'coupled') return state;
  const own = requireOwnPerson(tx);
  const db = sqliteOf(tx);
  const areaRows = db.select({ area: partnerSharing.area, level: partnerSharing.level }).from(partnerSharing)
    .where(and(eq(partnerSharing.ownerPersonId, own.id), eq(partnerSharing.couplingId, state.couplingId))).all();
  const photoRow = db.select({ level: photoSharing.level }).from(photoSharing)
    .where(and(eq(photoSharing.ownerPersonId, own.id), eq(photoSharing.couplingId, state.couplingId))).get();
  const levels = new Map(areaRows.map((row) => [row.area, row.level]));
  if (photoRow === undefined || AreaKey.options.some((area) => !levels.has(area))) return { type: 'loading' };
  return {
    type: 'coupled',
    partnerDisplayName: state.partnerDisplayName,
    since: state.since,
    areas: Object.fromEntries(AreaKey.options.map((area) => [area, levels.get(area) === 'zusammengefasst'])) as Record<AreaKey, boolean>,
    photos: photoRow.level === 'geteilt',
  };
}

/** Schreibt einen Schalterwechsel sofort lokal und merkt den Upsert in derselben Transaktion vor. */
export function changeSharing(tx: TransactionContext, { writer, clock }: { writer: SyncWriter; clock: Clock }, change: SharingChange): SharingOutcome {
  if (readSharing(tx).type !== 'coupled') return { type: 'not_coupled' };
  const at = Instant.parse(clock.read().instant);
  if (change.type === 'area') setPartnerSharing(tx, writer, { area: change.area, level: change.shared ? 'zusammengefasst' : 'privat' }, at);
  else setPhotoSharing(tx, writer, change.shared ? 'geteilt' : 'privat', at);
  return { type: 'saved' };
}
