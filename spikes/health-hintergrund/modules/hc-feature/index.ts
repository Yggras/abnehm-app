import { requireNativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';

type HcFeature = { backgroundReadStatus(): string };

export function backgroundReadStatus(): string {
  if (Platform.OS !== 'android') return 'nur Android';
  return requireNativeModule<HcFeature>('HcFeature').backgroundReadStatus();
}
