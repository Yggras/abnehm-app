import { EntityId, Instant } from '@abnehm/contracts/base';
import { NotificationSettingRecord, NotificationSettingUpsert, notificationSettingId } from '@abnehm/contracts/notifications';

import { notificationSetting } from '../db/schema/index.ts';
import { ownedEntity } from '../sync/registry.ts';

// Die Benachrichtigungseinstellung im Sync (Spezifikation 5, Abschnitte 6, 10 und 11; #132): eine je
// Person, generisches Upsert mit Last-Write-Wins, lesen und schreiben darf nur die Eigentümerin (Regel der
// Ressource `notification_setting`). Angelegt wird sie, sobald ein Gerät sie zum ersten Mal speichert;
// ihre ID ist die deterministische aus der Person-ID. Zwei Geräte, die gleichzeitig anlegen, treffen so
// dieselbe Zeile: Der Sync serialisiert Pushes über die Sperre der Sync-Clock, der zweite überschreibt.
// Eine andere ID lehnt der Server ab, statt am eindeutigen `person_id` zu scheitern. Gelöscht wird sie nie.

export const notificationSettingEntity = ownedEntity({
  entityType: 'notification_setting',
  resource: 'notification_setting',
  table: notificationSetting,
  upsert: NotificationSettingUpsert,
  deletable: false,
  validate: async (_tx, change) => (change.entityId === notificationSettingId(change.ownerPersonId) ? null : 'invalid_payload'),
  columns: (payload) => ({
    middayEnabled: payload.middayEnabled,
    middayTime: payload.middayTime,
    eveningEnabled: payload.eveningEnabled,
    eveningTime: payload.eveningTime,
    trackerErnaehrung: payload.trackerErnaehrung,
    trackerWasser: payload.trackerWasser,
    trackerSport: payload.trackerSport,
    trackerGewicht: payload.trackerGewicht,
    partnerPushEnabled: payload.partnerPushEnabled,
  }),
  record: (row): NotificationSettingRecord =>
    NotificationSettingRecord.parse({
      personId: EntityId.parse(row.personId),
      middayEnabled: row.middayEnabled,
      middayTime: row.middayTime,
      eveningEnabled: row.eveningEnabled,
      eveningTime: row.eveningTime,
      trackerErnaehrung: row.trackerErnaehrung,
      trackerWasser: row.trackerWasser,
      trackerSport: row.trackerSport,
      trackerGewicht: row.trackerGewicht,
      partnerPushEnabled: row.partnerPushEnabled,
      createdAt: Instant.parse(row.createdAt.toISOString()),
      updatedAt: Instant.parse(row.updatedAt.toISOString()),
    }),
});
