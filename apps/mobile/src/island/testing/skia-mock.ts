// Skia mit CanvasKit für Testdateien, die die Umgebung `jest/skia-environment.js` wählen (#182):
//
//   jest.mock('@shopify/react-native-skia', () => jest.requireActual<typeof import('./testing/skia-mock')>('./testing/skia-mock').skiaWithCanvasKit());
//
// Nachgebaut nach Skias eigenem `jestSetup.js`, aber mit den CommonJS-Modulen des Pakets, die Jest
// ohne Transformation laden kann.
export function skiaWithCanvasKit(): unknown {
  jest.mock('@shopify/react-native-skia/lib/commonjs/Platform', () => {
    const noop = () => undefined;
    return { OS: 'web', PixelRatio: 1, requireNativeComponent: noop, resolveAsset: noop, findNodeHandle: noop, NativeModules: noop, View: noop };
  });
  jest.mock('@shopify/react-native-skia/lib/commonjs/skia/core/Font', () => ({
    useFont: () => null,
    matchFont: () => null,
    listFontFamilies: () => [],
    useFonts: () => null,
  }));
  const { Mock } = jest.requireActual<{ Mock: (canvasKit: unknown) => unknown }>('@shopify/react-native-skia/lib/commonjs/mock');
  return Mock((globalThis as unknown as { CanvasKit: unknown }).CanvasKit);
}
