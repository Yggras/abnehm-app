import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { backendBaseUrl } from '../backend/client';
import { fetchBackendStatus, type BackendStatus } from '../backend/status';
import { useClock } from '../clock/clock-context';
import { Button, Card, color, space, Text } from '../design';

// Technischer Startbildschirm des Projektgerüsts (#93): prüft den Weg App → Backend → Postgres
// und zeigt die Ablesung der Uhr. Die App-Shell (#101) ersetzt ihn durch die Tabs.

type CheckState = BackendStatus | { type: 'checking' };

const statusText: Record<CheckState['type'], string> = {
  checking: 'Prüfe Verbindung …',
  ok: 'Backend und Datenbank erreichbar',
  database_unavailable: 'Backend erreichbar, Datenbank nicht',
  unreachable: 'Backend nicht erreichbar',
  invalid_response: 'Unerwartete Antwort vom Backend',
};

export default function StartScreen() {
  const clock = useClock();
  const [status, setStatus] = useState<CheckState>({ type: 'checking' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    void fetchBackendStatus().then((result) => {
      if (active) setStatus(result);
    });
    return () => {
      active = false;
    };
  }, [attempt]);

  const retry = () => {
    setStatus({ type: 'checking' });
    setAttempt((previous) => previous + 1);
  };

  const reading = clock.read();

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.heading}>
          <Text variant="display" accessibilityRole="header">
            Abnehm-App
          </Text>
          <Text tone="inkMuted">Technischer Startbildschirm</Text>
        </View>

        <Card>
          <Text variant="title" accessibilityRole="header">
            Backend
          </Text>
          <Text accessibilityLiveRegion="polite">{statusText[status.type]}</Text>
          {status.type === 'ok' ? <Text>Datenbankzeit: {status.databaseTime}</Text> : null}
          <Text>Adresse: {backendBaseUrl() ?? 'nicht konfiguriert'}</Text>
          <Button label="Erneut prüfen" variant="secondary" disabled={status.type === 'checking'} onPress={retry} />
        </Card>

        <Card>
          <Text variant="title" accessibilityRole="header">
            Uhr
          </Text>
          <Text>Lokaler Tag: {reading.localDate}</Text>
          <Text>Zeitzone: {reading.timeZone}</Text>
          <Text>Zeitpunkt: {reading.instant}</Text>
        </Card>

        {__DEV__ ? (
          <Button label="Komponentenkatalog" variant="text" icon="layers" onPress={() => router.push('/katalog')} />
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.surfaceBase },
  content: { padding: space[4], gap: space[4] },
  heading: { gap: space[1], paddingTop: space[4] },
});
