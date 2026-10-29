import type { Clock } from '@abnehm/clock';
import type { ReactNode } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ClockProvider } from '../../clock/clock-context';

// Rahmen der Insel-Tests (#182), wie ihn die App der Inselansicht gibt: Wurzel von Gesture Handler,
// sichere Bereiche und Uhr.

/** Bildschirm der Insel-Tests; der Canvas misst sich im Test nicht selbst. */
export const testScreen = { width: 400, height: 800 } as const;

export function IslandHost({ clock, children }: { clock: Clock; children: ReactNode }) {
  return (
    <GestureHandlerRootView>
      <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, ...testScreen }, insets: { top: 20, left: 0, right: 0, bottom: 0 } }}>
        <ClockProvider clock={clock}>{children}</ClockProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
