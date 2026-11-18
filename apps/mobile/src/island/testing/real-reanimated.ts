// Echtes Reanimated für Insel-Tests mit `expo-router/testing-library` (#192). Dessen Import ersetzt
// Reanimated durch `react-native-reanimated/mock` (expo-router/build/testing-library/mocks.js); dort
// entsteht ein Shared Value bei jedem Render neu. Die Inselansicht hält ihren Ausschnitt in einem
// Shared Value (`IslandCanvas.tsx`): Nach jedem Render stünde er im Test wieder am Ursprung, und ein
// Tipp träfe ein anderes Feld als auf dem Gerät. Wie in `jest/setup.js` läuft dann das echte
// Reanimated mit seiner Web-Implementierung.
//
// Direkt nach `expo-router/testing-library` importieren, vor dem Code unter Test:
//
//   import { renderRouter } from 'expo-router/testing-library';
//   import './testing/real-reanimated';
jest.dontMock('react-native-reanimated');
