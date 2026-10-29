import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Password, passwordPolicy } from '@abnehm/contracts/auth';

import type { ChangePasswordResult } from '../auth';
import { Button, Notice, Sheet, space, Text, TextField } from '../design';
import { useAccountPorts } from './AccountProvider';
import { settingsTexts } from './texts';

const texts = settingsTexts.password;

type Errors = Readonly<{ current?: string; next?: string; general?: string }>;

/** Was ein Ergebnis des Auth-Moduls für das Formular bedeutet; `null` bei Erfolg. */
function errorsOf(result: ChangePasswordResult): Errors | null {
  switch (result.type) {
    case 'changed':
      return null;
    case 'current_password_wrong':
      return { current: texts.currentWrong };
    case 'rejected':
      return { next: texts.rejected[result.reason] };
    case 'rate_limited':
      return { general: texts.rateLimited };
    case 'unreachable':
      return { general: texts.offline };
    case 'unauthorized':
      // Das Auth-Modul sperrt schon; die Sitzungs-Weiche verlässt die Fachoberfläche.
      return { general: texts.failed };
  }
}

/**
 * „Passwort ändern“ als Formular-Sheet: nur online, über das Primitiv des Auth-Moduls (#97). Die
 * Passwortregeln prüft das Formular vor dem Senden mit denselben Grenzen wie der Server; die Blocklist
 * kennt nur der Server. Bei Erfolg hat das Backend alle anderen Sitzungen widerrufen.
 */
export function PasswordSheet({ visible, onClose, onChanged }: { visible: boolean; onClose: () => void; onChanged: () => void }) {
  const { auth } = useAccountPorts();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);

  function close() {
    setCurrent('');
    setNext('');
    setErrors({});
    onClose();
  }

  async function submit() {
    if (current === '') return setErrors({ current: texts.currentMissing });
    const rule = Password.safeParse(next);
    if (!rule.success) return setErrors({ next: texts.rejected[next.length < passwordPolicy.minLength ? 'password_too_short' : 'password_too_long'] });
    setBusy(true);
    const result = await auth.changePassword({ currentPassword: current, newPassword: next }).catch((): ChangePasswordResult => ({ type: 'unreachable' }));
    setBusy(false);
    const failed = errorsOf(result);
    if (failed !== null) return setErrors(failed);
    close();
    onChanged();
  }

  return (
    <Sheet visible={visible} onClose={close} height="full">
      <View style={styles.form}>
        <Text variant="title" accessibilityRole="header">
          {texts.title}
        </Text>
        <TextField
          label={texts.current}
          value={current}
          onChangeText={(value) => {
            setCurrent(value);
            setErrors({});
          }}
          error={errors.current}
          secure
          autoComplete="current-password"
          textContentType="password"
        />
        <TextField
          label={texts.next}
          value={next}
          onChangeText={(value) => {
            setNext(value);
            setErrors({});
          }}
          hint={texts.rules}
          error={errors.next}
          secure
          autoComplete="new-password"
          textContentType="newPassword"
          returnKeyType="done"
          onSubmitEditing={() => void submit()}
        />
        {errors.general !== undefined ? <Notice tone="problem" cause="technik" text={errors.general} /> : null}
        <Button label={texts.submit} onPress={() => void submit()} loading={busy} block />
        <Button label={texts.cancel} variant="text" onPress={close} block />
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  form: { gap: space[4] },
});
