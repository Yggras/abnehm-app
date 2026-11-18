import { eq } from 'drizzle-orm';

import type { Clock } from '@abnehm/clock';
import { EntityId, type ServerVersion } from '@abnehm/contracts/base';
import {
  defaultNotificationSetting,
  NotificationSettingRecord,
  NotificationSettingUpsert,
  notificationSettingId,
} from '@abnehm/contracts/notifications';

import type { LocalDatabase, ReadContext } from '../local-db';
import { readOwnPerson } from '../local-db/person-header';
import { notificationSetting } from '../local-db/schema';
import { sqliteOf } from '../local-db/sqlite';
import { sqliteEntity } from '../sync/sqlite-entity';
import type { SyncWriter } from '../sync/outbox';

// Benachrichtigungseinstellung der eigenen Person (Spezifikation 5, Abschnitte 6 und 10; #132): eine je
// Person mit der deterministischen ID aus der Person-ID, synchronisiert mit Last-Write-Wins. Solange die
// Person nichts gespeichert hat, gilt der Standard; angelegt wird sie beim ersten Speichern, auf jedem
// Gerät mit derselben ID. Die Seite „Benachrichtigungen“ spricht nur mit `NotificationSettings`, der
// Check-in-Planer liest sie mit `readNotificationSetting`. Kein React Native, damit Node-Tests laden.

const fields = (setting: NotificationSettingUpsert): NotificationSettingUpsert => ({
  middayEnabled: setting.middayEnabled,
  middayTime: setting.middayTime,
  eveningEnabled: setting.eveningEnabled,
  eveningTime: setting.eveningTime,
  trackerErnaehrung: setting.trackerErnaehrung,
  trackerWasser: setting.trackerWasser,
  trackerSport: setting.trackerSport,
  trackerGewicht: setting.trackerGewicht,
  partnerPushEnabled: setting.partnerPushEnabled,
});

const same = (a: NotificationSettingUpsert, b: NotificationSettingUpsert) =>
  (Object.keys(defaultNotificationSetting) as (keyof NotificationSettingUpsert)[]).every((key) => a[key] === b[key]);

/** Die Einstellung im App-Sync: Upsert ohne Löschen; nur die Eigentümerin erhält sie. */
export const notificationSettingEntity = sqliteEntity({
  entityType: 'notification_setting',
  ownerField: 'personId',
  upsert: NotificationSettingUpsert,
  deletable: false,
  record: NotificationSettingRecord,
  table: notificationSetting,
  row: (id, data) => ({ id, personId: data.personId, ...fields(data), createdAt: data.createdAt, updatedAt: data.updatedAt }),
  replay(tx, entityId, change) {
    if (change.type !== 'upsert_entity') return;
    sqliteOf(tx).update(notificationSetting).set({ ...fields(change.payload), updatedAt: change.createdAt }).where(eq(notificationSetting.id, entityId)).run();
  },
});

function storedRow(tx: ReadContext) {
  const own = readOwnPerson(tx);
  if (own === undefined) return { own, row: undefined };
  const row = sqliteOf(tx).select().from(notificationSetting).where(eq(notificationSetting.id, notificationSettingId(EntityId.parse(own.id)))).get();
  return { own, row };
}

/** Gespeicherte Einstellung der eigenen Person, sonst der Standard. */
export function readNotificationSetting(tx: ReadContext): NotificationSettingUpsert {
  const { row } = storedRow(tx);
  return row === undefined ? defaultNotificationSetting : fields(row);
}

export type SaveNotificationSettingResult =
  | Readonly<{ type: 'saved' }>
  /** Derselbe Stand wie gespeichert; es entsteht keine Operation. */
  | Readonly<{ type: 'unchanged' }>
  /** Verletzt das Schema, etwa Abend nicht nach Mittag; es wird nichts geschrieben. */
  | Readonly<{ type: 'invalid' }>
  /** Vor dem ersten Pull gibt es die eigene Person noch nicht. */
  | Readonly<{ type: 'no_person' }>;

export type NotificationSettings = Readonly<{
  /** Gespeicherte Einstellung, sonst der Standard; dasselbe Objekt, solange sie sich nicht ändert. */
  current(): NotificationSettingUpsert;
  /** Meldet jede Änderung, auch nach einem Pull. */
  subscribe(listener: () => void): () => void;
  /** Speichert lokal samt Upsert in der Outbox (Last-Write-Wins); legt sie beim ersten Mal an. */
  save(setting: NotificationSettingUpsert): SaveNotificationSettingResult;
}>;

export type NotificationSettingsOptions = Readonly<{ database: LocalDatabase; writer: SyncWriter; clock: Clock }>;

/** Die Einstellung der geöffneten Kontodatenbank; endet mit ihr. */
export function createNotificationSettings({ database, writer, clock }: NotificationSettingsOptions): NotificationSettings {
  let current = defaultNotificationSetting;
  const listeners = new Set<() => void>();
  database.observe(readNotificationSetting, (next) => {
    if (same(next, current)) return;
    current = next;
    for (const listener of [...listeners]) listener();
  });

  return {
    current: () => current,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    save(input) {
      const parsed = NotificationSettingUpsert.safeParse(input);
      if (!parsed.success) return { type: 'invalid' };
      const setting = fields(parsed.data);
      return database.transaction((tx): SaveNotificationSettingResult => {
        const { own, row } = storedRow(tx);
        if (own === undefined) return { type: 'no_person' };
        if (row !== undefined && same(fields(row), setting)) return { type: 'unchanged' };
        const at = clock.read().instant;
        const id = notificationSettingId(EntityId.parse(own.id));
        const db = sqliteOf(tx);
        if (row === undefined) db.insert(notificationSetting).values({ id, personId: own.id, ...setting, createdAt: at, updatedAt: at }).run();
        else db.update(notificationSetting).set({ ...setting, updatedAt: at }).where(eq(notificationSetting.id, id)).run();
        writer.upsert(tx, { entityType: 'notification_setting', entityId: id, payload: setting, knownServerVersion: (row?.serverVersion ?? null) as ServerVersion | null });
        return { type: 'saved' };
      });
    },
  };
}
