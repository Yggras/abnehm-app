import { StyleSheet, View } from 'react-native';

import { Button, space } from '../design';
import { openTarget, type RouteScreenProps } from '../navigation';
import { PermissionState, useNotificationPermission, useNotifications, notificationTexts } from '../notifications';
import { ScreenFrame } from '../shell/ScreenFrame';
import { titleOf } from '../shell/texts';
import { SectionTitle } from './SectionTitle';

/**
 * Seite „Benachrichtigungen“ (Spezifikation 5, Abschnitt 6). Dieser Stand liefert den Abschnitt
 * Systemstatus (#125): erlaubt „Mitteilungen sind erlaubt“, unentschieden „Erlauben“ →
 * `notifications.permission`, verweigert „In den Systemeinstellungen erlauben“ über den Mitteilungs-Port.
 * Check-in-Zeiten, Tracker und Partner-Pushes ergänzt #132.
 */
export function NotificationsScreen({ target }: RouteScreenProps<'settings'>) {
  return (
    <ScreenFrame title={titleOf(target)} presentation="page">
      <SystemStatus />
    </ScreenFrame>
  );
}

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

const styles = StyleSheet.create({ section: { gap: space[3] } });
