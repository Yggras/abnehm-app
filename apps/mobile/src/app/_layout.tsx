import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';

import { useDesignFonts } from '../design';

// Der Startbildschirm bleibt stehen, bis Rubik geladen ist; sonst blitzt die Systemschrift auf.
void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const fontsReady = useDesignFonts();

  useEffect(() => {
    if (fontsReady) void SplashScreen.hideAsync();
  }, [fontsReady]);

  if (!fontsReady) return null;

  return (
    <>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false }}>
        {/* Der Komponentenkatalog ist nur im Development Build erreichbar. */}
        <Stack.Protected guard={__DEV__}>
          <Stack.Screen name="katalog" />
        </Stack.Protected>
      </Stack>
    </>
  );
}
