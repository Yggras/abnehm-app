/* global jest */
// Worklets, Reanimated und Gesture Handler im Test (#182), jeweils nach der Doku des Pakets:
// - Worklets mit ihrer Jest-Attrappe (https://docs.swmansion.com/react-native-worklets/docs/guides/testing);
//   sie liefert auch die UI-Laufzeit, die Gesture Handler beim Laden anbindet;
// - Reanimated über `setUpTests` (https://docs.swmansion.com/react-native-reanimated/docs/guides/testing);
// - Gesture Handler mit den Attrappen seines Pakets (`react-native-gesture-handler/jestSetup`).
jest.mock('react-native-worklets', () => require('react-native-worklets/src/mock'));
require('react-native-reanimated').setUpTests();
require('react-native-gesture-handler/jestSetup');

// Skia zeichnet im Test nur, wo eine Testdatei CanvasKit lädt (`jest/skia-environment.js`) und Skia
// selbst mockt, etwa `src/island/IslandView.test.tsx`. Alle anderen Tests, auch die echte App in
// `src/shell/AppShell.test.tsx`, bekommen eine Attrappe ohne Zeichnung. Neue Skia-Bausteine gehören
// hier dazu.
jest.mock('@shopify/react-native-skia', () => {
  const { View } = require('react-native');
  const nothing = () => null;
  return { Canvas: View, Circle: nothing, Fill: nothing, Group: nothing, Oval: nothing, Path: nothing, PathOp: {}, Skia: { Path: { MakeFromSVGString: nothing, MakeFromOp: nothing } } };
});

// Mitteilungs-Port (#125): Die Jest-Attrappe von expo-notifications ist unvollständig (etwa
// `setNotificationHandler`). Tests mit der echten App, etwa `src/shell/AppShell.test.tsx`, sprechen
// deshalb mit dem Fake der Testfähigkeit `mitteilungen` wie ein frisch installiertes Gerät.
// `src/notifications/expo-port.test.ts` prüft den echten Adapter gegen eine eigene Attrappe.
jest.mock('../src/notifications/expo-port', () => ({
  expoNotificationPort: require('../src/test-capabilities/notifications').createFakeNotificationPort({ permission: 'undetermined' }),
}));
