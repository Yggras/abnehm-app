import { useState } from 'react';
import { Keyboard, StyleSheet, View } from 'react-native';

import { Button, ListGroup, ListRow, size, Skeleton, space, TextField } from '../design';
import type { RouteScreenProps } from '../navigation';
import { useMessageHost } from '../shell/MessageHost';
import { ScreenFrame } from '../shell/ScreenFrame';
import { titleOf } from '../shell/texts';
import { useAccountEmail, useAccountPorts, useDisplayName } from './AccountProvider';
import { LogoutArea } from './LogoutArea';
import { PasswordForm } from './PasswordForm';
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
          {changingPassword ? null : <ListRow icon="lock" title={texts.changePassword} onPress={() => setChangingPassword(true)} />}
        </ListGroup>
        {changingPassword ? (
          <PasswordForm
            onClose={() => setChangingPassword(false)}
            onChanged={() => showMessage({ messageKey: 'konto.passwort_geaendert', values: {} })}
          />
        ) : null}
      </View>
      <DisplayNameField />
      <LogoutArea />
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

function DisplayNameField() {
  const { displayName } = useAccountPorts();
  const { showMessage } = useMessageHost();
  const saved = useDisplayName();
  // `null`: Das Feld folgt dem gespeicherten Namen, auch wenn er per Pull kommt.
  const [draft, setDraft] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);

  function save() {
    const result = displayName.rename(draft ?? '');
    if (result.type === 'invalid') return setInvalid(true);
    setDraft(null);
    // Sonst verdeckt die Tastatur auf kleinen Geräten die Meldung und „Abmelden“ (Simulator, #119).
    Keyboard.dismiss();
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

const styles = StyleSheet.create({
  group: { gap: space[3] },
  loadingRow: { minHeight: size.rowMin, justifyContent: 'center', paddingHorizontal: space[4] },
});
