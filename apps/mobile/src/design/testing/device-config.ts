import { AccessibilityInfo, Dimensions } from 'react-native';

import { deviceConfigs, type DeviceConfig, type DeviceConfigKey } from './device-configs';

// Wendet eine Gerätekonfiguration (#113) in Jest an: vor jedem Test des umgebenden `describe` gesetzt,
// danach zurückgenommen. Schriftfaktor über `Dimensions.set`, „Bewegung reduzieren“ über
// `AccessibilityInfo.isReduceMotionEnabled` und ohne spätere Änderungsereignisse.

export function withDeviceConfig(key: DeviceConfigKey): void {
  const config: DeviceConfig = deviceConfigs[key];
  const initial = { window: Dimensions.get('window'), screen: Dimensions.get('screen') };
  let spies: jest.SpyInstance[] = [];

  beforeEach(() => {
    if (config.fontScale !== undefined) {
      Dimensions.set({ window: { ...initial.window, fontScale: config.fontScale }, screen: { ...initial.screen, fontScale: config.fontScale } });
    }
    if (config.reduceMotion !== undefined) {
      spies = [
        jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(config.reduceMotion),
        jest.spyOn(AccessibilityInfo, 'addEventListener').mockReturnValue({ remove: () => undefined } as ReturnType<typeof AccessibilityInfo.addEventListener>),
      ];
    }
  });

  afterEach(() => {
    if (config.fontScale !== undefined) Dimensions.set(initial);
    for (const spy of spies.splice(0)) spy.mockRestore();
  });
}
