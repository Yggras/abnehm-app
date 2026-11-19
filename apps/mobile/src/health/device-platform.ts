import type { Clock } from '@abnehm/clock';

import { unavailableHealthPlatform, type HealthPlatformAdapter } from './platform';

// Health-Plattform des iOS-Geräts. Android nutzt `./device-platform.android.ts` (Health Connect, #195);
// bis HealthKit (#193) seinen Adapter liefert, ist Health auf iOS nicht verfügbar.

export function deviceHealthPlatform(_clock: Clock): HealthPlatformAdapter {
  return unavailableHealthPlatform('apple_health');
}
