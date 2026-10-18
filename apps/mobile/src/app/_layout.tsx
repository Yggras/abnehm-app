import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';

import { color, useDesignFonts } from '../design';
import { modalScreens } from '../navigation';
import { MessageHostProvider } from '../shell/MessageHost';

// Der Startbildschirm bleibt stehen, bis Rubik geladen ist; sonst blitzt die Systemschrift auf.
void SplashScreen.preventAutoHideAsync();

// Ein Deep Link direkt auf eine Seite oder einen modalen Ablauf legt die Tabs darunter, damit
// „Fertig“ und System-Zurück zu „Heute“ führen (https://docs.expo.dev/router/advanced/router-settings/).
export const unstable_settings = { anchor: '(tabs)' };

export default function RootLayout() {
  const fontsReady = useDesignFonts();

  useEffect(() => {
    if (fontsReady) void SplashScreen.hideAsync();
  }, [fontsReady]);

  if (!fontsReady) return null;

  // Der Meldungs-Host liegt über allen Routen. Sichtbar wird die Meldung über der Tab-Leiste oder,
  // auf Seiten und in modalen Abläufen, am unteren Rand von `ScreenFrame`.
  return (
    <MessageHostProvider>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: color.surfaceBase } }}>
        <Stack.Screen name="(tabs)" />
        {modalScreens.map((name) => (
          <Stack.Screen key={name} name={name} options={{ presentation: 'modal' }} />
        ))}
        {/* Werkzeuge des Fundaments sind nur im Development Build erreichbar. */}
        <Stack.Protected guard={__DEV__}>
          <Stack.Screen name="katalog" />
          <Stack.Screen name="technik" />
        </Stack.Protected>
      </Stack>
    </MessageHostProvider>
  );
}
