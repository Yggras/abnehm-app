import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import type { LogoutOutcome } from '../logout';
import { Button, ListGroup, ListRow, Notice, Sheet, size, Skeleton, space, Text, TextField } from '../design';
import type { RouteScreenProps } from '../navigation';
import { useMessageHost } from '../shell/MessageHost';
import { ScreenFrame } from '../shell/ScreenFrame';
import { titleOf } from '../shell/texts';
import { useAccountEmail, useAccountPorts, useDisplayName } from './AccountProvider';
import { PasswordSheet } from './PasswordSheet';
import { SectionTitle } from './SectionTitle';
import { settingsTexts } from './texts';

// „Konto“ (Spezifikation 5, Abschnitt 6): E-Mail nur lesend, Anzeigename änderbar, „Passwort ändern“ und
// „Abmelden“ über die Online-Abläufe des Fundaments (Spezifikation 0, Abschnitt 9). Konto löschen,
// E-Mail ändern und „alle Sitzungen abmelden“ gibt es in V1 nicht (Nutzerentscheidung 16.10.2026).

const texts = settingsTexts.account;

export function AccountScreen({ target }: RouteScreenProps<'settings'>) {
  const { showMessage } = useMessageHost();
  const [changingPassword, setChangingPassword] = useState(false);
  return (
    <ScreenFrame title={titleOf(target)} presentation="page">
      <View style={styles.group}>
        <SectionTitle>{texts.signInTitle}</SectionTitle>
        <ListGroup>
          <EmailRow />
          <ListRow icon="lock" title={texts.changePassword} onPress={() => setChangingPassword(true)} />
        </ListGroup>
      </View>
      <DisplayName />
      <LogoutArea />
      <PasswordSheet
        visible={changingPassword}
        onClose={() => setChangingPassword(false)}
        onChanged={() => showMessage({ messageKey: 'konto.passwort_geaendert', values: {} })}
      />
    </ScreenFrame>
  );
}

function EmailRow() {
  const email = useAccountEmail();
  if (email.type === 'loading') {
    return (
      <View style={styles.loadingRow} accessibilityLabel={settingsTexts.emailLoading}>
        <Skeleton width="70%" />
      </View>
    );
  }
  return <ListRow icon="person" title={email.type === 'known' ? email.email : settingsTexts.emailUnknown} subtitle={texts.emailSubtitle} />;
}

function DisplayName() {
  const { profile } = useAccountPorts();
  const { showMessage } = useMessageHost();
  const saved = useDisplayName();
  // `null`: Das Feld folgt dem gespeicherten Namen, auch wenn er per Pull kommt.
  const [draft, setDraft] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);

  function save() {
    const result = profile.rename(draft ?? '');
    if (result.type === 'invalid') return setInvalid(true);
    setDraft(null);
    if (result.type === 'renamed') showMessage({ messageKey: 'konto.name_gespeichert', values: {} });
    else if (result.type === 'no_person') showMessage({ messageKey: 'shell.nicht_geklappt', values: {} });
  }

  return (
    <View style={styles.group}>
      <TextField
        label={texts.nameLabel}
        value={draft ?? saved ?? ''}
        onChangeText={(value) => {
          setDraft(value);
          setInvalid(false);
        }}
        hint={texts.nameHint}
        error={invalid ? texts.nameInvalid : undefined}
        disabled={saved === null}
        autoComplete="name"
        textContentType="nickname"
        returnKeyType="done"
        onSubmitEditing={save}
      />
      {draft !== null && draft !== saved ? <Button label={texts.saveName} onPress={save} block /> : null}
    </View>
  );
}

type LogoutView =
  | Readonly<{ type: 'idle' }>
  | Readonly<{ type: 'running' }>
  | Readonly<{ type: 'confirm'; operations: number }>
  | Readonly<{ type: 'unreachable' }>
  /** Eine begonnene Abmeldung wartet auf ihren Abschluss, etwa nach verlorener Antwort. */
  | Readonly<{ type: 'pending' }>
  | Readonly<{ type: 'cleanup_pending' }>;

/**
 * „Abmelden“ über das Abmeldemodul (#111). Es synchronisiert zuerst und meldet ungesicherte Änderungen
 * als Bestätigungsbedarf. Ohne Netz bleibt alles bestehen; eine Abmeldung behauptet die Seite erst,
 * wenn der Server sie bestätigt hat. Danach führt die Sitzungs-Weiche zur Anmeldung.
 */
function LogoutArea() {
  const { logout } = useAccountPorts();
  const [view, setView] = useState<LogoutView>({ type: 'idle' });
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    void logout.pending().then((open) => {
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
        return (await logout.pending()) ? { type: 'pending' } : { type: 'unreachable' };
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
    <View style={styles.group}>
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
  group: { gap: space[3] },
  loadingRow: { minHeight: size.rowMin, justifyContent: 'center', paddingHorizontal: space[4] },
  sheet: { gap: space[4] },
});
