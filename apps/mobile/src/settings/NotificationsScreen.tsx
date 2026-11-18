import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { instantAtWallClock, minutesOfDay, readingOf } from '@abnehm/clock';
import type { AreaKey, Instant, TimeZone } from '@abnehm/contracts/base';
import {
  checkInTrackerField,
  NotificationSettingUpsert,
  WallClockTime,
  type NotificationSettingUpsert as Setting,
} from '@abnehm/contracts/notifications';

import { useClock } from '../clock/clock-context';
import { Button, DateTimePicker, ListGroup, ListRow, Notice, ProblemMessage, Skeleton, size, space, Switch, type IconName } from '../design';
import { openTarget, type RouteScreenProps } from '../navigation';
import { PermissionState, useNotificationPermission, useNotifications, notificationTexts } from '../notifications';
import { useNotificationSettings, useSavedNotificationSetting } from '../notifications/app-notification-settings';
import type { NotificationSettings } from '../notifications/notification-setting';
import { useMessageHost } from '../shell/MessageHost';
import { ScreenFrame } from '../shell/ScreenFrame';
import { titleOf } from '../shell/texts';
import { SectionTitle } from './SectionTitle';

/**
 * Seite „Benachrichtigungen“ (Spezifikation 5, Abschnitt 6): Systemstatus (#125), Tages-Check-ins mit
 * Uhrzeit, die Tracker der Check-ins, Partner-Pushes und der Infotext (#132). Die Werte bilden die
 * synchronisierte Benachrichtigungseinstellung (Last-Write-Wins); sie gelten erst mit „Speichern“, das
 * gesperrt ist, solange der Abend nicht nach dem Mittag liegt. Schalter und Uhrzeit-Picker kommen aus
 * `@expo/ui`, alles andere ist gebrandet.
 */
export function NotificationsScreen({ target }: RouteScreenProps<'settings'>) {
  const settings = useNotificationSettings();
  return (
    <ScreenFrame title={titleOf(target)} presentation="page">
      <SystemStatus />
      {settings === null ? <Loading /> : <SettingForm settings={settings} />}
    </ScreenFrame>
  );
}

const texts = notificationTexts.settings;

function SystemStatus() {
  const notifications = useNotifications();
  const permission = useNotificationPermission();
  return (
    <View style={styles.section}>
      <SectionTitle>{notificationTexts.systemStatusTitle}</SectionTitle>
      <PermissionState permission={permission} />
      {permission === 'undetermined' ? (
        <Button label={notificationTexts.allow} variant="secondary" block onPress={() => openTarget({ type: 'notifications.permission' })} />
      ) : null}
      {permission === 'denied' ? (
        <Button label={notificationTexts.openSystemSettings} variant="secondary" block onPress={() => void notifications.openSettings()} />
      ) : null}
    </View>
  );
}

function Loading() {
  return (
    <View style={styles.loading} accessibilityLabel={texts.loading}>
      <Skeleton width="60%" />
    </View>
  );
}

const trackerIcons: Readonly<Record<AreaKey, IconName>> = { ernaehrung: 'plate', wasser: 'drop', sport: 'sport', gewicht: 'scale' };
const trackers = Object.keys(trackerIcons) as AreaKey[];

function SettingForm({ settings }: { settings: NotificationSettings }) {
  const { showMessage } = useMessageHost();
  const saved = useSavedNotificationSetting(settings);
  // `null`: Die Seite folgt dem gespeicherten Stand, auch wenn er per Pull kommt.
  const [draft, setDraft] = useState<Setting | null>(null);
  const shown = draft ?? saved;
  const valid = NotificationSettingUpsert.safeParse(shown).success;
  const changed = draft !== null && (Object.keys(saved) as (keyof Setting)[]).some((key) => draft[key] !== saved[key]);
  const change = (patch: Partial<Setting>) => setDraft({ ...shown, ...patch });

  function save() {
    const result = settings.save(shown);
    if (result.type === 'invalid') return;
    setDraft(null);
    if (result.type === 'saved') showMessage({ messageKey: 'benachrichtigungen.gespeichert', values: {} });
    else if (result.type === 'no_person') showMessage({ messageKey: 'shell.nicht_geklappt', values: {} });
  }

  return (
    <>
      <View style={styles.section}>
        <SectionTitle>{texts.checkInsTitle}</SectionTitle>
        <ListGroup>
          <CheckInRow icon="sun" title={texts.midday} timeLabel={texts.middayTime} enabled={shown.middayEnabled} time={shown.middayTime}
            onEnabled={(middayEnabled) => change({ middayEnabled })} onTime={(middayTime) => change({ middayTime })} />
          <CheckInRow icon="moon" title={texts.evening} timeLabel={texts.eveningTime} enabled={shown.eveningEnabled} time={shown.eveningTime}
            onEnabled={(eveningEnabled) => change({ eveningEnabled })} onTime={(eveningTime) => change({ eveningTime })} />
        </ListGroup>
        {valid ? null : <ProblemMessage text={texts.order} />}
      </View>
      <View style={styles.section}>
        <SectionTitle>{texts.trackersTitle}</SectionTitle>
        <ListGroup>
          {trackers.map((area) => {
            const field = checkInTrackerField(area);
            return (
              <ListRow key={area} icon={trackerIcons[area]} title={texts.trackers[area]}
                accessory={<Switch label={texts.trackers[area]} value={shown[field]} onValueChange={(value) => change({ [field]: value })} />} />
            );
          })}
        </ListGroup>
      </View>
      <View style={styles.section}>
        <SectionTitle>{texts.partnerTitle}</SectionTitle>
        <ListGroup>
          <ListRow icon="heart" title={texts.partnerPushes} subtitle={texts.partnerPushesSubtitle}
            accessory={<Switch label={texts.partnerPushes} value={shown.partnerPushEnabled} onValueChange={(partnerPushEnabled) => change({ partnerPushEnabled })} />} />
        </ListGroup>
      </View>
      <Notice tone="neutral" text={texts.info} />
      <Button label={texts.save} block disabled={!valid || !changed} onPress={save} />
    </>
  );
}

function CheckInRow(props: {
  icon: IconName;
  title: string;
  timeLabel: string;
  enabled: boolean;
  time: WallClockTime;
  onEnabled(enabled: boolean): void;
  onTime(time: WallClockTime): void;
}) {
  const clock = useClock();
  // Der Picker arbeitet mit Zeitpunkten: die Wanduhrzeit am heutigen Tag in der Zone des Geräts.
  const today = clock.read();
  return (
    <ListRow
      icon={props.icon}
      title={props.title}
      accessory={
        <View style={styles.controls}>
          <DateTimePicker
            label={props.timeLabel}
            mode="time"
            timeZone={today.timeZone}
            value={instantAtWallClock(today.localDate, minutesOf(props.time), today.timeZone)}
            onChange={(instant) => props.onTime(wallClockOf(instant, today.timeZone))}
          />
          <Switch label={props.title} value={props.enabled} onValueChange={props.onEnabled} />
        </View>
      }
    />
  );
}

const minutesOf = (time: WallClockTime) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));

function wallClockOf(instant: Instant, timeZone: TimeZone): WallClockTime {
  const minutes = minutesOfDay(readingOf(instant, timeZone));
  const pad = (value: number) => String(value).padStart(2, '0');
  return WallClockTime.parse(`${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`);
}

const styles = StyleSheet.create({
  section: { gap: space[3] },
  controls: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  loading: { minHeight: size.rowMin, justifyContent: 'center', paddingHorizontal: space[4] },
});
