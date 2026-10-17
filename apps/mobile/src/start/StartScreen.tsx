import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { fetchBackendStatus, type BackendStatus } from '../backend/status';
import { useClock } from '../clock/clock-context';

// Technischer Startbildschirm des Projektgerüsts (#93): prüft den Weg App → Backend → Postgres
// und zeigt die Ablesung der Uhr. Die App-Shell (#101) ersetzt ihn durch die Tabs.

const statusText: Record<BackendStatus['type'] | 'checking', string> = {
  checking: 'Prüfe Verbindung …',
  ok: 'Backend und Datenbank erreichbar',
  database_unavailable: 'Backend erreichbar, Datenbank nicht',
  unreachable: 'Backend nicht erreichbar',
  invalid_response: 'Unerwartete Antwort vom Backend',
};

export default function StartScreen() {
  const clock = useClock();
  const [status, setStatus] = useState<BackendStatus | 'checking'>('checking');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let current = true;
    void fetchBackendStatus().then((result) => {
      if (current) setStatus(result);
    });
    return () => {
      current = false;
    };
  }, [attempt]);

  const retry = () => {
    setStatus('checking');
    setAttempt((previous) => previous + 1);
  };

  const reading = clock.read();
  const statusType = status === 'checking' ? 'checking' : status.type;

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text accessibilityRole="header" style={styles.title}>
          Abnehm-App
        </Text>
        <Text style={styles.subtitle}>Technischer Startbildschirm</Text>

        <View style={styles.section}>
          <Text accessibilityRole="header" style={styles.heading}>
            Backend
          </Text>
          <Text accessibilityLiveRegion="polite" style={styles.body}>
            {statusText[statusType]}
          </Text>
          {status !== 'checking' && status.type === 'ok' ? (
            <Text style={styles.body}>Datenbankzeit: {status.databaseTime}</Text>
          ) : null}
          <Pressable
            accessibilityRole="button"
            disabled={status === 'checking'}
            onPress={retry}
            style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
          >
            <Text style={styles.buttonLabel}>Erneut prüfen</Text>
          </Pressable>
        </View>

        <View style={styles.section}>
          <Text accessibilityRole="header" style={styles.heading}>
            Uhr
          </Text>
          <Text style={styles.body}>Lokaler Tag: {reading.localDate}</Text>
          <Text style={styles.body}>Zeitzone: {reading.timeZone}</Text>
          <Text style={styles.body}>Zeitpunkt: {reading.instant}</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

// Bewusst schlicht: Tokens und gebrandete Primitiven liefert das Design-System (#95).
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#FFFFFF' },
  content: { padding: 24, gap: 24 },
  title: { fontSize: 28, fontWeight: '700', color: '#1A1A1A' },
  subtitle: { fontSize: 16, color: '#4A4A4A' },
  section: { gap: 8 },
  heading: { fontSize: 20, fontWeight: '600', color: '#1A1A1A' },
  body: { fontSize: 16, color: '#1A1A1A' },
  button: {
    alignSelf: 'flex-start',
    minHeight: 48,
    minWidth: 48,
    justifyContent: 'center',
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: '#1A5F7A',
  },
  buttonPressed: { opacity: 0.8 },
  buttonLabel: { fontSize: 16, fontWeight: '600', color: '#FFFFFF' },
});
