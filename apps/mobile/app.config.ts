import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * `APP_VARIANT=development` erzeugt den Development Build (mit expo-dev-client),
 * alles andere den Produktionsbuild. Der Standard ist bewusst die Produktion:
 * Netzwerkausnahmen gibt es nur, wenn die Variante ausdrücklich gesetzt ist.
 */
function appVariant(environment: NodeJS.ProcessEnv): 'development' | 'production' {
  return environment.APP_VARIANT === 'development' ? 'development' : 'production';
}

export default ({ config }: ConfigContext): ExpoConfig => {
  const variant = appVariant(process.env);
  const development = variant === 'development';
  const identifier = development ? 'de.yggras.abnehmapp.dev' : 'de.yggras.abnehmapp';

  return {
    ...config,
    name: development ? 'Abnehm-App Dev' : 'Abnehm-App',
    slug: 'abnehm-app',
    scheme: development ? 'abnehmapp-dev' : 'abnehmapp',
    version: '0.1.0',
    orientation: 'portrait',
    icon: './assets/icon.png',
    userInterfaceStyle: 'light',
    ios: {
      bundleIdentifier: identifier,
      supportsTablet: false,
      infoPlist: {
        // Ersetzt das ATS-Wörterbuch der Expo-Vorlage vollständig. Die Vorlage setzt
        // `NSAllowsLocalNetworking` für alle Builds (https://unpkg.com/expo-template-bare-minimum@58.0.23/ios/HelloWorld/Info.plist).
        // Lokales HTTP (localhost, LAN-IP, .local) gibt es nur im Development Build.
        NSAppTransportSecurity: development
          ? { NSAllowsArbitraryLoads: false, NSAllowsLocalNetworking: true }
          : { NSAllowsArbitraryLoads: false },
      },
    },
    android: {
      // Klartext-HTTP erlauben nur die Debug-Manifeste der Vorlage (Development Build,
      // https://unpkg.com/expo-template-bare-minimum@58.0.23/android/app/src/debug/AndroidManifest.xml).
      // Release-Builds verbieten ihn ab API 28 standardmäßig
      // (https://developer.android.com/privacy-and-security/security-config).
      package: identifier,
      adaptiveIcon: {
        backgroundColor: '#E6F4FE',
        foregroundImage: './assets/android-icon-foreground.png',
        backgroundImage: './assets/android-icon-background.png',
        monochromeImage: './assets/android-icon-monochrome.png',
      },
      predictiveBackGestureEnabled: false,
    },
    plugins: ['expo-router', 'expo-localization'],
    experiments: {
      reactCompiler: true,
    },
  };
};
