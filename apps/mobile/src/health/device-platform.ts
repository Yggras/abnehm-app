import type { Clock } from '@abnehm/clock';
import * as HealthKit from '@kingstinct/react-native-healthkit';

import { createHealthKitPlatform } from './healthkit';
import type { HealthPlatformAdapter } from './platform';

// Health-Plattform des iOS-Geräts: HealthKit (#193). Android nutzt `./device-platform.android.ts` (Health
// Connect, #195); Metro wählt die Dateien je Plattform
// (https://reactnative.dev/docs/platform-specific-code#platform-specific-extensions). Die Bibliothek lädt
// ihr natives Nitro-Modul beim Import; in Jest ersetzt `jest/setup.js` dieses Modul deshalb durch eine
// Plattform ohne Health.

export function deviceHealthPlatform(clock: Clock): HealthPlatformAdapter {
  return createHealthKitPlatform({ client: HealthKit, clock });
}
