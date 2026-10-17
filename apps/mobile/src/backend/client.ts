import type { AppType } from '@abnehm/backend/rpc';
import { hc } from 'hono/client';
import { Platform } from 'react-native';

/**
 * Basis-URL des Backends. `EXPO_PUBLIC_API_URL` wird beim Bündeln eingesetzt
 * (https://docs.expo.dev/guides/environment-variables/). Ohne Angabe nutzt ein
 * Development Build den Entwicklungsrechner: Der iOS-Simulator teilt dessen
 * Netz, der Android-Emulator erreicht ihn unter 10.0.2.2. Echte Geräte: docs/entwicklung.md.
 */
export function backendBaseUrl(): string {
  const configured = process.env.EXPO_PUBLIC_API_URL;
  if (configured !== undefined && configured !== '') return configured;
  if (!__DEV__) throw new Error('EXPO_PUBLIC_API_URL ist für Produktionsbuilds Pflicht');
  return Platform.OS === 'android' ? 'http://10.0.2.2:8787' : 'http://localhost:8787';
}

/** Typisierter Hono-RPC-Client; die Typen stammen direkt aus der Backend-App. */
export function createBackendClient(baseUrl: string = backendBaseUrl()) {
  return hc<AppType>(baseUrl);
}

export type BackendClient = ReturnType<typeof createBackendClient>;
