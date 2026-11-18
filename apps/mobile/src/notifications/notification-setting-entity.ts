import { eq } from 'drizzle-orm';

import { NotificationSettingRecord, NotificationSettingUpsert, notificationSettingOf } from '@abnehm/contracts/notifications';

import { notificationSetting } from '../local-db/schema';
import { sqliteOf } from '../local-db/sqlite';
import { sqliteEntity } from '../sync/sqlite-entity';

// Die Benachrichtigungseinstellung im App-Sync (Spezifikation 5, Abschnitt 10; #132): Upsert ohne
// Löschen, Last-Write-Wins; nur die Eigentümerin erhält sie. Ohne React Native, damit Node-Tests laden.

export const notificationSettingEntity = sqliteEntity({
  entityType: 'notification_setting',
  ownerField: 'personId',
  upsert: NotificationSettingUpsert,
  deletable: false,
  record: NotificationSettingRecord,
  table: notificationSetting,
  row: (id, data) => ({ id, personId: data.personId, ...notificationSettingOf(data), createdAt: data.createdAt, updatedAt: data.updatedAt }),
  replay(tx, entityId, change) {
    if (change.type !== 'upsert_entity') return;
    sqliteOf(tx)
      .update(notificationSetting)
      .set({ ...notificationSettingOf(change.payload), updatedAt: change.createdAt })
      .where(eq(notificationSetting.id, entityId))
      .run();
  },
});
