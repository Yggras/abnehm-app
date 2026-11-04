// Geräte- und Accessibility-Konfigurationen der Tests (Spezifikation 0, Abschnitt 12; #113). Sie stellen
// nur Systemeinstellungen nach, die React Native der App meldet: Schriftfaktor über `Dimensions` und
// „Bewegung reduzieren“ über `AccessibilityInfo`. Sie sind keine Seed-Zustände und haben weder einen
// SQLite- noch einen Postgres-Sollzustand; Tests kombinieren sie mit einem Seed oder einer Testwelt.
// Angewendet werden sie in Jest mit `withDeviceConfig` (`./device-config.ts`). Diese Datei enthält nur
// Daten, damit auch die Registry der Seed-Varianten (`test/seed-varianten.ts`) sie lesen kann.

export type DeviceConfig = Readonly<{
  description: string;
  /** Schriftfaktor der Systemschrift; React Native meldet ihn als `fontScale`. */
  fontScale?: number;
  /** Systemeinstellung „Bewegung reduzieren“. */
  reduceMotion?: boolean;
}>;

export const deviceConfigs = {
  'schriftfaktor-2': {
    description: 'Systemschrift mit Schriftfaktor 2,0, bis zu dem die zentralen Abläufe nutzbar bleiben (Spezifikation 0, User Story 26; `textScale.max`).',
    fontScale: 2,
  },
  'reduzierte-bewegung': {
    description: 'Systemeinstellung „Bewegung reduzieren“ ist an; das Design-System ersetzt Bewegung durch Überblendung oder Stillstand (`motionFor`).',
    reduceMotion: true,
  },
} as const satisfies Record<string, DeviceConfig>;

export type DeviceConfigKey = keyof typeof deviceConfigs;
