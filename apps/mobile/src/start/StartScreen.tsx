import { useEffect, useState } from 'react';

import { backendBaseUrl } from '../backend/client';
import { fetchBackendStatus, type BackendStatus } from '../backend/status';
import { useClock } from '../clock/clock-context';
import { Button, Card, Text } from '../design';
import { ScreenFrame } from '../shell/ScreenFrame';
import { shellTexts } from '../shell/texts';

// Technische Prüfung aus dem Projektgerüst (#93): prüft den Weg App → Backend → Postgres und zeigt
// die Ablesung der Uhr. Nur im Development Build, erreichbar über „Heute“ oder `abnehmapp-dev://technik`.

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
    <ScreenFrame title={shellTexts.technicalCheck} presentation="page">
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
    </ScreenFrame>
  );
}
