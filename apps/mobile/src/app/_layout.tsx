import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { ClockProvider } from '../clock/clock-context';
import { deviceClock } from '../clock/device-clock';

export default function RootLayout() {
  return (
    <ClockProvider clock={deviceClock}>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false }} />
    </ClockProvider>
  );
}
