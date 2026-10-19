import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';

import { testCapabilities } from '../build-capabilities';
import { ClockProvider } from '../clock/clock-context';
import { color, useDesignFonts } from '../design';
import { appClock, deviceSession } from '../session/device-session';
import { useSessionGate } from '../session/use-session-gate';
import { MessageHostProvider } from '../shell/MessageHost';
import { gateHome, isSessionScreenGate, screenAccess, type GatedScreen } from '../shell/session-routes';

// Der Startbildschirm bleibt stehen, bis Rubik geladen und die gespeicherte Sitzung geprüft ist;
// sonst blitzt die Systemschrift oder kurz die falsche Seite der Weiche auf.
void SplashScreen.preventAutoHideAsync();

// Ein Deep Link direkt auf eine Seite oder einen modalen Ablauf legt die Tabs darunter, damit
// „Fertig“ und System-Zurück zu „Heute“ führen (https://docs.expo.dev/router/advanced/router-settings/).
export const unstable_settings = { anchor: '(tabs)' };

const screen = ({ name, modal }: GatedScreen) => (
  <Stack.Screen key={name} name={name} options={modal ? { presentation: 'modal' } : undefined} />
);

export default function RootLayout() {
  const fontsReady = useDesignFonts();
  const gate = useSessionGate();
  const ready = fontsReady && gate !== null;

  useEffect(() => {
    if (ready) void SplashScreen.hideAsync();
  }, [ready]);

  if (!ready) return null;

  // Die Sitzungs-Weiche gibt je Zustand nur ihre Bildschirme frei; jeder andere führt zu ihrem Ziel.
  const home = gateHome(gate);
  // Der Meldungs-Host liegt über allen Routen. Sichtbar wird die Meldung über der Tab-Leiste oder,
  // auf Seiten und in modalen Abläufen, am unteren Rand von `ScreenFrame`.
  // Die Uhr der App gilt für alle Routen; im Development Build ist es die Testuhr, die ein Seed stellt.
  return (
    <ClockProvider clock={appClock}>
      <MessageHostProvider>
        <StatusBar style="dark" />
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: color.surfaceBase } }}>
          <Stack.Protected guard={gate === 'today'} redirectTo={home}>
            {screenAccess.today.map(screen)}
          </Stack.Protected>
          <Stack.Protected guard={gate === 'today' || gate === 'onboarding'} redirectTo={home}>
            {screenAccess.onboardingAndToday.map(screen)}
          </Stack.Protected>
          <Stack.Protected guard={gate === 'onboarding'} redirectTo={home}>
            {screenAccess.onboarding.map(screen)}
          </Stack.Protected>
          <Stack.Protected guard={isSessionScreenGate(gate)} redirectTo={home}>
            {screenAccess.session.map(screen)}
          </Stack.Protected>
          {/* Werkzeuge des Fundaments sind nur im Development Build erreichbar, auch vor der Anmeldung. */}
          <Stack.Protected guard={__DEV__}>
            <Stack.Screen name="katalog" />
            <Stack.Screen name="technik" />
          </Stack.Protected>
        </Stack>
        {testCapabilities ? <testCapabilities.Host session={deviceSession} /> : null}
      </MessageHostProvider>
    </ClockProvider>
  );
}
