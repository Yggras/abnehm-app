import { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';

import type { RouteTarget } from '@abnehm/contracts/routes';

import { Button, Card, Notice, size, Skeleton, space, Text } from '../design';
import { MomoFigure } from '../momo';
import { closeRoute, openTarget } from '../navigation';
import { useSessionGate } from '../session/use-session-gate';
import { useSyncRefresh } from '../shell/SyncRefresh';
import type { Coupled } from './coupling-state';
import type { CouplingProblem } from './coupling-view';
import { couplingTexts } from './texts';

// Gemeinsame Teile der Kopplungsabläufe `partner.invite` und `partner.redeem` (Spezifikation 5,
// Abschnitt 5; #120): der gescheiterte Ablauf, das Warten auf den Pull und die Ansicht „Ihr seid gekoppelt“.

/** Takt des Pulls, solange ein Ablauf auf die Kopplung in SQLite wartet (Spezifikation 5, Abschnitt 5). */
export const couplingPullIntervalMs = 10_000;

/** Satz mit nächstem Schritt; „Braucht Internet“ und unerwartete Fehler mit „Erneut versuchen“. */
export function CouplingProblemNotice({ problem: { text, retry, look }, onRetry }: { problem: CouplingProblem; onRetry: () => void }) {
  const action = retry ? { label: couplingTexts.retry, onPress: onRetry } : undefined;
  return <Notice {...look} text={text} action={action} />;
}

/** Platzhalter, solange ein Ablauf läuft oder die Kopplung noch nicht per Pull angekommen ist. */
export function CouplingPending({ label }: { label: string }) {
  return (
    <View accessible accessibilityLabel={label}>
      <Skeleton width="100%" height={136} />
    </View>
  );
}

/**
 * Startet im Takt `couplingPullIntervalMs` den Sync des App-Roots, solange `active` gilt und die Ansicht offen ist.
 * Der Auslöser ist je Render eine neue Funktion; der Takt beginnt deshalb nicht neu mit ihm.
 */
export function usePullWhile(active: boolean) {
  const latest = useSyncRefresh();
  const refresh = useRef(latest);
  useEffect(() => {
    refresh.current = latest;
  }, [latest]);
  useEffect(() => {
    if (!active) return undefined;
    const interval = setInterval(() => {
      void refresh.current?.().catch(() => undefined);
    }, couplingPullIntervalMs);
    return () => clearInterval(interval);
  }, [active]);
}

/**
 * „Ihr seid gekoppelt“ mit dem Weg zum Schlüpfen (`momo` mit `view: "rollenwahl"`). Ist Momo schon geschlüpft,
 * hat eine Annahme die frühere Kopplung samt Rollen reaktiviert; eine neue Rollenwahl gibt es dann nicht (#83), und
 * der Weg führt als „Ihr seid wieder gekoppelt“ zur Insel. Aus dem Onboarding aufgerufen, steht die Sitzungs-Weiche
 * auf `onboarding`, und „Weiter“ kehrt zu Schritt 11 zurück.
 */
export function CoupledView({ coupled: { partnerDisplayName, hatched } }: { coupled: Coupled }) {
  const fromOnboarding = useSessionGate() === 'onboarding';
  return (
    <Card>
      <View testID="kopplung-gekoppelt" style={styles.coupled}>
        <MomoFigure mood="freut_sich" size={size.momoToday} />
        <Text variant="title" accessibilityRole="header" style={styles.center}>
          {hatched ? couplingTexts.reactivatedTitle : couplingTexts.coupledTitle}
        </Text>
        <Text style={styles.center}>
          {hatched ? couplingTexts.reactivatedBody(partnerDisplayName) : couplingTexts.coupledBody(partnerDisplayName)}
        </Text>
        {fromOnboarding ? (
          <Button block label={couplingTexts.continue} onPress={closeRoute} />
        ) : hatched ? (
          <Button block label={couplingTexts.toIsland} onPress={() => leaveFor({ type: 'momo' })} />
        ) : (
          <Button block label={couplingTexts.toHatching} onPress={() => leaveFor({ type: 'momo', view: 'rollenwahl' })} />
        )}
      </View>
    </Card>
  );
}

/** Schließt den modalen Ablauf und öffnet das Ziel im Tab „Momo“. */
function leaveFor(target: Extract<RouteTarget, { type: 'momo' }>) {
  closeRoute();
  openTarget(target);
}

const styles = StyleSheet.create({
  coupled: { alignItems: 'center', gap: space[3] },
  center: { textAlign: 'center' },
});
