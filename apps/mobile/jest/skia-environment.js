// Testumgebung für Dateien, die Skia zeichnen (#182). Skia läuft im Test auf CanvasKit, der
// Web-Implementierung; seine eigene Umgebung (`@shopify/react-native-skia/jestEnv.js`) baut aber auf
// der Node-Umgebung statt auf der React-Native-Umgebung von jest-expo auf. Diese Umgebung lädt
// CanvasKit zusätzlich in die Umgebung von jest-expo. Eine Testdatei wählt sie per Docblock
// `@jest-environment ./jest/skia-environment.js` und ruft `jest.mock('@shopify/react-native-skia', …)`
// wie Skias `jestSetup.js` auf; alle anderen Tests laden CanvasKit nicht.
const CanvasKitInit = require('canvaskit-wasm/bin/full/canvaskit');
const NativeEnvironment = require('jest-expo/src/preset/nativeEnvironment');

module.exports = class SkiaEnvironment extends NativeEnvironment {
  async setup() {
    await super.setup();
    this.global.CanvasKit = await CanvasKitInit({});
  }
};
