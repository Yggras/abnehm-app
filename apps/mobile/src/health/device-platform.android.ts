import type { Clock } from '@abnehm/clock';
import * as HealthConnect from 'react-native-health-connect';

import { createHealthConnectPlatform } from './health-connect';
import type { HealthPlatformAdapter } from './platform';

// Health-Plattform des Android-Geräts: Health Connect (#195). Metro wählt diese Datei nur für Android
// (https://reactnative.dev/docs/platform-specific-code#platform-specific-extensions). Die Bibliothek lädt
// ihr natives Modul schon beim Import und gibt es nur für Android; das iOS-Bundle enthält sie deshalb nie.

export function deviceHealthPlatform(clock: Clock): HealthPlatformAdapter {
  return createHealthConnectPlatform({ client: HealthConnect, clock });
}
