import { registerRootComponent } from 'expo';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import App from './App';
import { defineAndroidTask } from './src/android';
import { registerIosSubscriptions } from './src/ios';
import { log } from './src/log';

// Alles hier läuft auch, wenn das System die App nur im Hintergrund startet
// (iOS: HealthKit-Wecken, Android: Headless-Task). Deshalb Modul-Ebene.
log('jsStart', { platform: Platform.OS });

if (Platform.OS === 'ios') registerIosSubscriptions();
if (Platform.OS === 'android') defineAndroidTask();

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

registerRootComponent(App);
