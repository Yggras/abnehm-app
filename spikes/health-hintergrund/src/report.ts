import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { log } from './log';

// Test-Upload: misst nur, ob ein Netzaufruf im Hintergrund-Fenster klappt und
// wie lange er dauert. Gesendet werden ausschließlich Metadaten (Plattform,
// Auslöser, Anzahl neuer Einträge) – keine Gesundheitswerte.
export const UPLOAD_URL = 'https://httpbin.org/post';

export async function testUpload(trigger: string, newRecords: number) {
  const started = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(UPLOAD_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platform: Platform.OS, trigger, newRecords, at: new Date().toISOString() }),
      signal: controller.signal,
    });
    log('upload', { trigger, ok: res.ok, status: res.status, ms: Date.now() - started });
  } catch (e) {
    log('upload', { trigger, ok: false, error: String(e), ms: Date.now() - started });
  } finally {
    clearTimeout(timeout);
  }
}

// Lokale Mitteilung, damit man Hintergrund-Läufe am Gerät sofort bemerkt.
export async function notify(title: string, body: string) {
  try {
    await Notifications.scheduleNotificationAsync({ content: { title, body }, trigger: null });
  } catch (e) {
    log('error', { where: 'notify', error: String(e) });
  }
}
