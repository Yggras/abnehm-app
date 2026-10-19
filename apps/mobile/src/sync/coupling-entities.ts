import { eq } from 'drizzle-orm';

import { CouplingMemberRecord, CouplingRecord, PartnerSharingRecord, PhotoSharingRecord } from '@abnehm/contracts/coupling';
import { IslandRecord } from '@abnehm/contracts/island';

import { coupling, couplingMember, island, partnerSharing, photoSharing } from '../local-db/schema';
import { sqliteOf } from '../local-db/sqlite';
import { sqliteEntity } from './sqlite-entity';
import type { SyncEntityAdapter } from './registry';

// Kopplung, Mitglieder, Insel und Freigaben im App-Sync (Spezifikation 0, Abschnitte 8–10). Sie entstehen
// nur auf dem Server und kommen per Pull; ein generisches Upsert oder Löschen gibt es nicht, deshalb auch
// keine offenen Operationen, die erneut anzuwenden wären.

const noPendingChanges = () => undefined;

const couplingEntity = sqliteEntity({
  entityType: 'coupling',
  // Die Kopplung ist selbst die Eigentumsgrenze; ihr Paar setzt nur der Server.
  ownerField: 'personLowId',
  upsert: null,
  deletable: false,
  record: CouplingRecord,
  table: coupling,
  row: (id, data) => ({ id, ...data }),
  replay: noPendingChanges,
});

const couplingMemberEntity = sqliteEntity({
  entityType: 'coupling_member',
  ownerField: 'couplingId',
  upsert: null,
  deletable: false,
  record: CouplingMemberRecord,
  table: couplingMember,
  // Den Status spiegelt das Mitglied von seiner Kopplung; der Pull liefert sie mit kleinerer Position zuerst.
  row(id, data, tx) {
    const parent = sqliteOf(tx).select({ status: coupling.status }).from(coupling).where(eq(coupling.id, data.couplingId)).get();
    if (parent === undefined) throw new Error('Kopplungsmitglied ohne lokale Kopplung');
    return { id, ...data, couplingStatus: parent.status };
  },
  replay: noPendingChanges,
});

const islandEntity = sqliteEntity({
  entityType: 'island',
  ownerField: 'couplingId',
  upsert: null,
  deletable: false,
  record: IslandRecord,
  table: island,
  row: (id, data) => ({ id, ...data }),
  replay: noPendingChanges,
});

const partnerSharingEntity = sqliteEntity({
  entityType: 'partner_sharing',
  ownerField: 'ownerPersonId',
  upsert: null,
  deletable: false,
  record: PartnerSharingRecord,
  table: partnerSharing,
  row: (id, data) => ({ id, ...data }),
  replay: noPendingChanges,
});

const photoSharingEntity = sqliteEntity({
  entityType: 'photo_sharing',
  ownerField: 'ownerPersonId',
  upsert: null,
  deletable: false,
  record: PhotoSharingRecord,
  table: photoSharing,
  row: (id, data) => ({ id, ...data }),
  replay: noPendingChanges,
});

export const couplingSyncEntities: readonly SyncEntityAdapter[] = [
  couplingEntity,
  couplingMemberEntity,
  islandEntity,
  partnerSharingEntity,
  photoSharingEntity,
];
