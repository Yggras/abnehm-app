import type { AppType } from '@abnehm/backend/rpc';
import { hc } from 'hono/client';
import { Platform } from 'react-native';

/**
 * Basis-URL des Backends oder `undefined`, wenn ein Produktionsbuild keine hat.
 *
 * `EXPO_PUBLIC_API_URL` setzt Expo beim Bündeln ein (https://docs.expo.dev/guides/environment-variables/).
 * Ohne Angabe nutzt ein Development Build den Entwicklungsrechner: im iOS-Simulator `localhost`
 * (im Simulator geprüft), im Android-Emulator `10.0.2.2`, den „Special alias to your host loopback
 * interface“ (https://developer.android.com/studio/run/emulator-networking-address).
 * Echte Geräte: docs/entwicklung.md.
 */
export function backendBaseUrl(): string | undefined {
  const configured = process.env.EXPO_PUBLIC_API_URL;
  if (configured !== undefined && configured !== '') return configured;
  if (!__DEV__) return undefined;
  return Platform.OS === 'android' ? 'http://10.0.2.2:8787' : 'http://localhost:8787';
}

/** Typisierter Hono-RPC-Client; die Typen stammen direkt aus der Backend-App. */
export function createBackendClient() {
  const baseUrl = backendBaseUrl();
  if (baseUrl === undefined) throw new Error('EXPO_PUBLIC_API_URL fehlt im Produktionsbuild');
  return hc<AppType>(baseUrl);
}

export type BackendClient = ReturnType<typeof createBackendClient>;
