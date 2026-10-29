import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, Notice, Sheet, space, Text } from '../design';
import type { LogoutOutcome } from '../logout';
import { useAccountPorts } from './AccountProvider';
import { settingsTexts } from './texts';

const texts = settingsTexts.account;

type LogoutView =
  | Readonly<{ type: 'idle' }>
  | Readonly<{ type: 'running' }>
  | Readonly<{ type: 'confirm'; operations: number }>
  | Readonly<{ type: 'unreachable' }>
  /** Eine begonnene Abmeldung wartet auf ihren Abschluss, etwa nach verlorener Antwort. */
  | Readonly<{ type: 'pending' }>
  | Readonly<{ type: 'cleanup_pending' }>;

/**
 * „Abmelden“ auf „Konto“ über das Abmeldemodul (#111). Es synchronisiert zuerst und meldet ungesicherte
 * Änderungen als Bestätigungsbedarf. Ohne Netz bleibt alles bestehen; eine Abmeldung behauptet die Seite
 * erst, wenn der Server sie bestätigt hat. Danach führt die Sitzungs-Weiche zur Anmeldung. Eine begonnene
 * Abmeldung bietet die Seite zum Abschließen an, wie es `Logout.pending()` vorsieht.
 */
export function LogoutArea() {
  const { logout } = useAccountPorts();
  const [view, setView] = useState<LogoutView>({ type: 'idle' });
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    void logout
      .pending()
      .catch(() => false)
      .then((open) => {
        if (open && mounted.current) setView({ type: 'pending' });
      });
    return () => {
      mounted.current = false;
    };
  }, [logout]);

  async function viewOf(outcome: LogoutOutcome): Promise<LogoutView> {
    switch (outcome.type) {
      case 'confirmation_required':
        return { type: 'confirm', operations: outcome.unsecuredOperations };
      case 'unreachable':
        return (await logout.pending().catch(() => false)) ? { type: 'pending' } : { type: 'unreachable' };
      case 'cleanup_pending':
        return { type: 'cleanup_pending' };
      case 'logged_out':
      case 'unauthorized':
        // Die Weiche verlässt die Fachoberfläche: zur Anmeldung bzw. zur erneuten Anmeldung.
        return { type: 'idle' };
    }
  }

  async function run(discardUnsecured = false) {
    setView({ type: 'running' });
    const outcome = await logout.logout({ discardUnsecured }).catch((): LogoutOutcome => ({ type: 'unreachable' }));
    const next = await viewOf(outcome);
    if (mounted.current) setView(next);
  }

  return (
    <View style={styles.area}>
      {view.type === 'pending' ? (
        <Notice tone="hint" text={texts.logoutPending} action={{ label: texts.logoutFinish, onPress: () => void run() }} />
      ) : view.type === 'unreachable' ? (
        <Notice tone="problem" cause="technik" icon="offline" text={texts.logoutUnreachable} />
      ) : view.type === 'cleanup_pending' ? (
        <Notice tone="neutral" text={texts.logoutCleanupPending} />
      ) : null}
      {view.type === 'cleanup_pending' ? null : (
        <Button label={texts.logout} variant="secondary" onPress={() => void run()} loading={view.type === 'running'} block />
      )}
      <Sheet visible={view.type === 'confirm'} onClose={() => setView({ type: 'idle' })}>
        <View style={styles.sheet}>
          <Text variant="title" accessibilityRole="header">
            {settingsTexts.logoutConfirm.title}
          </Text>
          <Text>{settingsTexts.logoutConfirm.text(view.type === 'confirm' ? view.operations : 0)}</Text>
          <Button label={settingsTexts.logoutConfirm.stay} onPress={() => setView({ type: 'idle' })} block />
          <Button label={settingsTexts.logoutConfirm.discard} variant="text" onPress={() => void run(true)} block />
        </View>
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  // Abgesetzt am Seitenende, nicht als Folgeaktion des Namensfelds (Impeccable-Prüfung, #119).
  area: { gap: space[3], marginTop: space[6] },
  sheet: { gap: space[4] },
});
