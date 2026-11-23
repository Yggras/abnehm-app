import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, color, Icon, Notice, size, space, Text } from '../design';
import type { OnboardingStepProps } from '../shell/onboarding-registry';
import { useAppHealthImport } from './app-health';
import type { HealthImport } from './health-import';
import { SourceAppCheck } from './SourceAppCheck';
import { healthTexts } from './texts';

type Phase = 'bereit' | 'verbindet' | 'installation_noetig' | 'fehlgeschlagen' | 'verbunden';

/**
 * Onboarding-Schritt 9 `health` (Spezifikation 3, Abschnitt 6) am Steckplatz der Onboarding-Registry: Erklärtext
 * und „Verbinden“, danach die Prüfung der Quell-Apps mit Anleitung und „Weiter“. Er arbeitet ausschließlich über
 * den Health-Import-Dienst des geöffneten Kontos; der prüft die Verfügbarkeit, fragt Lesezugriff an und startet
 * direkt danach den Import. `health_connected` steht fest, sobald die Anfrage abgeschlossen ist, weil iOS nicht
 * erkennen lässt, ob Lesezugriff erteilt wurde; die Prüfung der Quell-Apps folgt noch im Schritt, und „Weiter“
 * meldet das Ergebnis. Ohne HealthKit bzw. installierbares Health Connect meldet „Verbinden“ sofort
 * `health_unavailable`. „Überspringen“ zeichnet der Rahmen von Spezifikation 1.
 */
export function HealthStep({ complete }: OnboardingStepProps<'health'>) {
  const health = useAppHealthImport();
  // Ein schon verbundenes Gerät, etwa nach „Zurück“ aus Schritt 10, zeigt gleich die Prüfung.
  const [phase, setPhase] = useState<Phase>(() => ((health?.connection() ?? null) === null ? 'bereit' : 'verbunden'));

  async function connect(service: HealthImport) {
    setPhase('verbindet');
    try {
      const outcome = await service.connect();
      if (outcome.type === 'nicht_verfuegbar') complete({ type: 'health_unavailable' });
      else setPhase(outcome.type);
    } catch {
      // Neutral und wiederholbar: Ohne Verbindung bleibt alles manuell nutzbar.
      setPhase('fehlgeschlagen');
    }
  }

  return (
    <View style={styles.step}>
      {phase === 'verbunden' && health !== null ? (
        <>
          {/*
            Ohne den Erklärblock, der vor die Systemabfrage gehört: Sonst lag „Weiter“ auf dem iPhone SE unter
            dem sichtbaren Bereich, während „Überspringen“ des Rahmens unten stand (Impeccable-Prüfung, #189).
          */}
          <SourceAppCheck platform={health.platform} />
          <Button label={healthTexts.next} variant="primary" block onPress={() => complete({ type: 'health_connected' })} />
        </>
      ) : (
        <>
          <Explanation />
          {phase === 'installation_noetig' ? <Notice tone="hint" text={healthTexts.installationNeeded} /> : null}
          {phase === 'fehlgeschlagen' && health !== null ? <Notice tone="neutral" text={healthTexts.connectFailed(health.platform.origin)} /> : null}
          <Button
            label={healthTexts.connect}
            variant="primary"
            block
            loading={health === null || phase === 'verbindet'}
            onPress={() => {
              if (health !== null) void connect(health);
            }}
          />
        </>
      )}
    </View>
  );
}

/** Symbol und Erklärtext vor der Systemabfrage. */
function Explanation() {
  return (
    <View style={styles.explanation}>
      <View style={styles.badge} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Icon name="pulse" size="lg" tone="primary" />
      </View>
      <Text variant="headline">{healthTexts.explanation}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  step: { gap: space[4] },
  explanation: { gap: space[4] },
  badge: {
    width: size.avatar,
    height: size.avatar,
    borderRadius: size.avatar / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.primarySoft,
  },
});
