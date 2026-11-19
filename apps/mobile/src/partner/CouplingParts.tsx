import { StyleSheet, View } from 'react-native';

import { Button, Card, Notice, size, space, Text } from '../design';
import { MomoFigure } from '../momo';
import { closeRoute, openTarget } from '../navigation';
import { useSessionGate } from '../session/use-session-gate';
import type { CouplingProblem } from './coupling-view';
import { couplingTexts } from './texts';

// Gemeinsame Teile der Kopplungsabläufe `partner.invite` und `partner.redeem` (Spezifikation 5,
// Abschnitt 5; #120): der gescheiterte Ablauf und die Ansicht „Ihr seid gekoppelt“.

/**
 * Satz mit nächstem Schritt; „Braucht Internet“ und unerwartete Fehler mit „Erneut versuchen“. `problem` nur für
 * Technik und einen nicht passenden Code, Begrenzung und bestehende Kopplung als neutraler Hinweis.
 */
export function CouplingProblemNotice({ problem, onRetry }: { problem: CouplingProblem; onRetry: () => void }) {
  const action = problem.retry ? { label: couplingTexts.retry, onPress: onRetry } : undefined;
  switch (problem.cause) {
    case 'offline':
      return <Notice tone="problem" cause="technik" icon="offline" text={problem.text} action={action} />;
    case 'technik':
    case 'ungueltige_eingabe':
      return <Notice tone="problem" cause={problem.cause} text={problem.text} action={action} />;
    case 'hinweis':
      return <Notice tone="hint" text={problem.text} action={action} />;
  }
}

/**
 * „Ihr seid gekoppelt“ mit dem Weg zum Schlüpfen (`momo` mit `view: "rollenwahl"`). Aus dem Onboarding
 * aufgerufen, steht dort die Sitzungs-Weiche auf `onboarding`, und „Weiter“ kehrt zu Schritt 11 zurück.
 */
export function CoupledView({ partnerDisplayName }: { partnerDisplayName: string }) {
  const fromOnboarding = useSessionGate() === 'onboarding';
  return (
    <Card variant="empty">
      <View testID="kopplung-gekoppelt" style={styles.coupled}>
        <MomoFigure mood="freut_sich" size={size.momoToday} />
        <Text variant="title" accessibilityRole="header" style={styles.center}>
          {couplingTexts.coupledTitle}
        </Text>
        <Text style={styles.center}>{couplingTexts.coupledBody(partnerDisplayName)}</Text>
        {fromOnboarding ? (
          <Button block label={couplingTexts.continue} onPress={closeRoute} />
        ) : (
          <Button block label={couplingTexts.toHatching} onPress={toHatching} />
        )}
      </View>
    </Card>
  );
}

/** Schließt den modalen Ablauf und öffnet die Rollenwahl im Tab „Momo“. */
function toHatching() {
  closeRoute();
  openTarget({ type: 'momo', view: 'rollenwahl' });
}

const styles = StyleSheet.create({
  coupled: { alignItems: 'center', gap: space[3] },
  center: { textAlign: 'center' },
});
