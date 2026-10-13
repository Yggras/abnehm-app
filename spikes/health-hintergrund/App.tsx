import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useState } from 'react';
import { Alert, AppState, Platform, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';

import {
  androidInventory,
  androidStatus,
  importAndroidChanges,
  registerAndroidTask,
  requestAndroidPermissions,
} from './src/android';
import { enableIosBackground, importAllIos, iosInventory, requestIosPermissions } from './src/ios';
import { clearLog, log, readLog, readLogRaw, readState, type LogEntry } from './src/log';

const isIos = Platform.OS === 'ios';

export default function App() {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(() => setEntries(readLog()), []);

  useEffect(() => {
    refresh();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') refresh();
    });
    return () => sub.remove();
  }, [refresh]);

  const run = (label: string, fn: () => Promise<unknown>) => async () => {
    setBusy(label);
    try {
      await fn();
    } catch (e) {
      log('error', { where: label, error: String(e) });
      Alert.alert('Fehler', String(e));
    }
    setBusy(null);
    refresh();
  };

  const requestAll = async () => {
    await Notifications.requestPermissionsAsync();
    if (isIos) await requestIosPermissions();
    else await requestAndroidPermissions();
  };

  const share = async () => {
    await Share.share({ message: readLogRaw() || '(leer)' });
  };

  const stats = summarize(entries);
  const state = readState();
  const setting = isIos ? `Frequenz: ${state.iosFrequency ?? 'nicht eingerichtet'}` : `Intervall: ${state.androidInterval ? `${state.androidInterval} min` : 'nicht eingerichtet'}`;

  return (
    <View style={styles.root}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Health-Hintergrund-Spike</Text>
        <Text style={styles.muted}>
          {Device.modelName} · {Platform.OS} {Device.osVersion} · {setting}
        </Text>

        <Section title="Einrichtung (einmalig)">
          <Btn label="1 · Rechte anfragen (Health + Mitteilungen)" onPress={run('Rechte', requestAll)} />
          {isIos ? (
            <>
              <Btn label="2 · Hintergrund: sofort (Latenz messen)" onPress={run('sofort', () => enableIosBackground('immediate'))} />
              <Btn label="2 · Hintergrund: stündlich (V1-Einstellung)" onPress={run('stündlich', () => enableIosBackground('hourly'))} />
            </>
          ) : (
            <>
              <Btn label="2 · Hintergrund-Job alle 15 min" onPress={run('15', () => registerAndroidTask(15))} />
              <Btn label="2 · Hintergrund-Job alle 60 min" onPress={run('60', () => registerAndroidTask(60))} />
              <Btn label="Status prüfen (Feature-Check, Rechte, Job)" onPress={run('Status', async () => {
                const s = await androidStatus();
                Alert.alert('Status', JSON.stringify(s, null, 2));
              })} />
            </>
          )}
        </Section>

        <Section title="Auswertung">
          <Text style={styles.stat}>Hintergrund-Läufe: {stats.backgroundWakes} (letzter: {fmt(stats.lastBackground)})</Text>
          <Text style={styles.stat}>Läufe bei gesperrtem Gerät: {stats.locked}</Text>
          <Text style={styles.stat}>Neue Einträge im Hintergrund: {stats.backgroundSamples}</Text>
          <Text style={styles.stat}>Uploads ok/fehlgeschlagen: {stats.uploadOk}/{stats.uploadFail} (Ø {stats.uploadMs} ms)</Text>
          <Text style={styles.stat}>Längster Lauf: {stats.maxRunMs} ms{isIos ? ' (Fenster: 25 s)' : ''}</Text>
          <Text style={styles.stat}>Fehler: {stats.errors}</Text>
        </Section>

        <Section title="Werkzeuge">
          <Btn label="Jetzt importieren (Vordergrund)" onPress={run('Import', () => (isIos ? importAllIos('foreground') : importAndroidChanges('foreground')))} />
          <Btn label="Inventur: Typen & Quellen der letzten 7 Tage" onPress={run('Inventur', () => (isIos ? iosInventory() : androidInventory()))} />
          <Btn label="Protokoll teilen" onPress={share} />
          <Btn label="Protokoll löschen" danger onPress={() =>
            Alert.alert('Protokoll löschen?', 'Anker/Tokens bleiben erhalten.', [
              { text: 'Abbrechen', style: 'cancel' },
              { text: 'Löschen', style: 'destructive', onPress: () => { clearLog(); refresh(); } },
            ])
          } />
          {busy && <Text style={styles.muted}>Läuft: {busy} …</Text>}
        </Section>

        <Section title={`Protokoll (neueste ${Math.min(entries.length, 80)} von ${entries.length})`}>
          {entries.slice(-80).reverse().map((e, i) => (
            <Text key={i} style={[styles.entry, e.kind === 'error' && styles.error]}>
              {fmt(e.at)} {e.kind} {describe(e)}
            </Text>
          ))}
        </Section>
      </ScrollView>
    </View>
  );
}

function summarize(entries: LogEntry[]) {
  const wakes = entries.filter((e) => e.kind === 'wake' && e.trigger === 'background');
  const uploads = entries.filter((e) => e.kind === 'upload' && String(e.trigger).startsWith('background'));
  const okUploads = uploads.filter((e) => e.ok);
  const runs = entries.filter((e) => e.kind === 'done' && e.trigger === 'background').map((e) => Number(e.totalMs));
  return {
    backgroundWakes: wakes.length,
    lastBackground: wakes.at(-1)?.at,
    locked: wakes.filter((e) => e.protectedData === false).length,
    backgroundSamples: entries.filter((e) => e.kind === 'sample' && e.trigger === 'background').length,
    uploadOk: okUploads.length,
    uploadFail: uploads.length - okUploads.length,
    uploadMs: okUploads.length ? Math.round(okUploads.reduce((s, e) => s + Number(e.ms), 0) / okUploads.length) : 0,
    maxRunMs: runs.length ? Math.max(...runs) : 0,
    errors: entries.filter((e) => e.kind === 'error').length,
  };
}

function describe(e: LogEntry) {
  const { at, kind, platform, ...rest } = e;
  return JSON.stringify(rest);
}

const fmt = (iso?: unknown) =>
  iso ? new Date(String(iso)).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '–';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function Btn({ label, onPress, danger }: { label: string; onPress: () => void; danger?: boolean }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.btn, danger && styles.btnDanger, pressed && { opacity: 0.6 }]}>
      <Text style={styles.btnText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F4F1EA' },
  content: { padding: 16, paddingTop: 64, gap: 16 },
  title: { fontSize: 22, fontWeight: '700', color: '#173D68' },
  muted: { color: '#6B6B6B' },
  section: { backgroundColor: '#fff', borderRadius: 12, padding: 12, gap: 8 },
  sectionTitle: { fontSize: 16, fontWeight: '600', color: '#173D68' },
  stat: { fontSize: 14 },
  btn: { backgroundColor: '#173D68', borderRadius: 8, padding: 12 },
  btnDanger: { backgroundColor: '#9B2C2C' },
  btnText: { color: '#fff', fontWeight: '600' },
  entry: { fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }), fontSize: 11 },
  error: { color: '#9B2C2C' },
});
