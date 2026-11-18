import type { ConfigContext, ExpoConfig } from 'expo/config';
import { withAndroidManifest, type ConfigPlugin } from 'expo/config-plugins';

type AppVariant = 'development' | 'e2e' | 'production';

/** Exact-Alarm-Berechtigungen, die die App nie haben darf (Spezifikation 5, Abschnitt 8). */
export const exactAlarmPermissions = ['android.permission.SCHEDULE_EXACT_ALARM', 'android.permission.USE_EXACT_ALARM'];

/**
 * `APP_VARIANT=development` erzeugt den Development Build (mit expo-dev-client), `APP_VARIANT=e2e`
 * den E2E-Build (#114), alles andere den Produktionsbuild. Der Standard ist bewusst die Produktion:
 * Netzwerkausnahmen gibt es nur, wenn die Variante ausdrücklich gesetzt ist.
 *
 * Der E2E-Build ist ein Release-Binary mit den Testfähigkeiten. Sie hängen im JS-Bundle an
 * `EXPO_PUBLIC_E2E_BUILD=true`, das Expo beim Bündeln einsetzt (`src/build-capabilities.ts`). Beide
 * Angaben gehören zusammen: Ein Produktions- oder Development-Build mit diesem Schalter bricht ab,
 * damit sich die Testfähigkeiten in keinem anderen Artefakt per Konfiguration einschalten lassen.
 */
function appVariant(environment: NodeJS.ProcessEnv): AppVariant {
  const variant = environment.APP_VARIANT === 'development' || environment.APP_VARIANT === 'e2e' ? environment.APP_VARIANT : 'production';
  const e2eBundle = environment.EXPO_PUBLIC_E2E_BUILD !== undefined && environment.EXPO_PUBLIC_E2E_BUILD !== '';
  if (variant === 'e2e' && environment.EXPO_PUBLIC_E2E_BUILD !== 'true') {
    throw new Error('APP_VARIANT=e2e verlangt EXPO_PUBLIC_E2E_BUILD=true (scripts/e2e-build)');
  }
  if (variant !== 'e2e' && e2eBundle) {
    throw new Error('EXPO_PUBLIC_E2E_BUILD gibt es nur im E2E-Build (APP_VARIANT=e2e)');
  }
  return variant;
}

/**
 * Produktiv-Gate (#115): Der Build für echte Daten erreicht das Backend nur verschlüsselt. Ohne Adresse
 * bleibt ein Export möglich (Release-Sperren); die App bricht dann zur Laufzeit ab (src/backend/client.ts).
 * Die Form der Adresse (Host ohne Pfad) prüft `scripts/app-build`; hier zählt nur das Schema.
 */
function assertProductionApiUrl(variant: AppVariant, environment: NodeJS.ProcessEnv): void {
  const apiUrl = environment.EXPO_PUBLIC_API_URL;
  if (variant === 'production' && apiUrl !== undefined && apiUrl !== '' && !apiUrl.startsWith('https://')) {
    throw new Error('Der Produktionsbuild spricht das Backend nur über https:// an (EXPO_PUBLIC_API_URL)');
  }
}

const variantIdentity: Record<AppVariant, { name: string; identifier: string; scheme: string }> = {
  development: { name: 'Abnehm-App Dev', identifier: 'de.yggras.abnehmapp.dev', scheme: 'abnehmapp-dev' },
  e2e: { name: 'Abnehm-App E2E', identifier: 'de.yggras.abnehmapp.e2e', scheme: 'abnehmapp-e2e' },
  production: { name: 'Abnehm-App', identifier: 'de.yggras.abnehmapp', scheme: 'abnehmapp' },
};

/**
 * Klartext-HTTP zum lokalen Backend im E2E-Build: Release-Builds verbieten ihn ab API 28
 * (https://developer.android.com/privacy-and-security/security-config), und die Debug-Manifeste der
 * Vorlage gelten für Release nicht. Mod laut https://docs.expo.dev/config-plugins/mods/.
 */
const withCleartextTraffic: ConfigPlugin = (config) =>
  withAndroidManifest(config, (modConfig) => {
    const application = modConfig.modResults.manifest.application?.[0];
    if (application) application.$['android:usesCleartextTraffic'] = 'true';
    return modConfig;
  });

export default ({ config }: ConfigContext): ExpoConfig => {
  const variant = appVariant(process.env);
  assertProductionApiUrl(variant, process.env);
  // Lokales HTTP zum Entwicklungsrechner bzw. zum lokalen Backend der E2E-Läufe.
  const localNetworking = variant !== 'production';
  const { name, identifier, scheme } = variantIdentity[variant];

  const expoConfig: ExpoConfig = {
    ...config,
    name,
    slug: 'abnehm-app',
    scheme,
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
        // Lokales HTTP (localhost, LAN-IP, .local) gibt es nur im Development- und im E2E-Build.
        NSAppTransportSecurity: localNetworking
          ? { NSAllowsArbitraryLoads: false, NSAllowsLocalNetworking: true }
          : { NSAllowsArbitraryLoads: false },
      },
    },
    android: {
      // Klartext-HTTP erlauben nur die Debug-Manifeste der Vorlage (Development Build,
      // https://unpkg.com/expo-template-bare-minimum@58.0.23/android/app/src/debug/AndroidManifest.xml)
      // und im E2E-Build `withCleartextTraffic`. Release-Builds verbieten ihn ab API 28 standardmäßig
      // (https://developer.android.com/privacy-and-security/security-config).
      package: identifier,
      adaptiveIcon: {
        backgroundColor: '#E6F4FE',
        foregroundImage: './assets/android-icon-foreground.png',
        backgroundImage: './assets/android-icon-background.png',
        monochromeImage: './assets/android-icon-monochrome.png',
      },
      predictiveBackGestureEnabled: false,
      // Keine exakten Alarme (Spezifikation 5, Abschnitt 8; #125): Bringt ein Paket die Berechtigungen ins
      // zusammengeführte Manifest, entfernt Expos Plugin sie dort mit `tools:node="remove"`
      // (`blockedPermissions`, https://docs.expo.dev/versions/v58.0.0/config/app/#blockedpermissions).
      // Ab Android 14 verweigert das System `SCHEDULE_EXACT_ALARM` neu installierten Apps ohnehin
      // (https://developer.android.com/about/versions/14/changes/schedule-exact-alarms).
      // `scripts/app-artefakt-pruefen` prüft das Manifest jeder Produktions-APK.
      blockedPermissions: exactAlarmPermissions,
    },
    plugins: [
      'expo-router',
      'expo-localization',
      'expo-font',
      'expo-splash-screen',
      'expo-sqlite',
      // Sitzung im Schlüsselbund bzw. Keystore. Ohne Biometrie: kein Face-ID-Hinweis. Das Plugin setzt
      // standardmäßig Android-Backup-Regeln für die SecureStore-Einträge (`configureAndroidBackup`,
      // https://docs.expo.dev/versions/v58.0.0/sdk/securestore/).
      ['expo-secure-store', { faceIDPermission: false }],
      // Lokale Benachrichtigungen (#125). Server-Push und damit das APNs-Entitlement kommen mit dem
      // Push-Ticket; bis dahin bleibt es aus (`enableRemoteNotifications`,
      // https://docs.expo.dev/versions/v58.0.0/sdk/notifications/).
      ['expo-notifications', { enableRemoteNotifications: false }],
    ],
    experiments: {
      reactCompiler: true,
    },
  };
  return variant === 'e2e' ? withCleartextTraffic(expoConfig) : expoConfig;
};
