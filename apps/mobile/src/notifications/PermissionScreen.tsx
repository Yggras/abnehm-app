import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, space } from '../design';
import { closeRoute, type RouteScreenProps } from '../navigation';
import { ScreenFrame } from '../shell/ScreenFrame';
import { titleOf } from '../shell/texts';
import { PermissionExplanation, PermissionState } from './PermissionParts';
import { useNotificationPermission, useNotifications } from './NotificationsProvider';
import { notificationTexts } from './texts';

/**
 * Erklär-Bildschirm `notifications.permission` (modal; Spezifikation 5, Abschnitt 8). Nur „Erlauben“
 * öffnet den Systemdialog, „Später“ schließt ohne Frage. Beides kehrt zum Aufrufer zurück. Die App
 * öffnet diesen Bildschirm nie von sich aus; Aufrufer sind die Einstellungen und der einmalige Hinweis
 * beim ersten Anfeuern. Ist die Erlaubnis schon entschieden, zeigt er nur den Stand.
 */
export function NotificationPermissionScreen({ target }: RouteScreenProps<'notifications.permission'>) {
  const notifications = useNotifications();
  const permission = useNotificationPermission();
  const [asking, setAsking] = useState(false);

  const allow = async () => {
    setAsking(true);
    try {
      await notifications.request();
    } finally {
      setAsking(false);
    }
    closeRoute();
  };

  return (
    <ScreenFrame title={titleOf(target)} presentation="modal">
      <PermissionExplanation />
      {permission === 'undetermined' ? (
        <View style={styles.actions}>
          <Button label={notificationTexts.allow} variant="primary" block loading={asking} onPress={() => void allow()} />
          <Button label={notificationTexts.later} variant="text" block disabled={asking} onPress={closeRoute} />
        </View>
      ) : (
        <View style={styles.actions}>
          <PermissionState permission={permission} />
          {permission === 'denied' ? (
            <Button label={notificationTexts.openSystemSettings} variant="secondary" block onPress={() => void notifications.openSettings()} />
          ) : null}
        </View>
      )}
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({ actions: { gap: space[3], marginTop: space[4] } });
