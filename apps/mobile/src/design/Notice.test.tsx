import { render, screen, userEvent } from '@testing-library/react-native';

import { Notice, type NoticeProps } from './Notice';

test.each<[NoticeProps, string]>([
  [{ tone: 'partner', text: 'Anna feuert dich an' }, 'icon-heart'],
  [{ tone: 'hint', text: '„Im Kalorienbudget“ entscheidet sich am Tagesende.', icon: 'moon' }, 'icon-moon'],
  [{ tone: 'neutral', text: 'Offline · zuletzt abgeglichen um 13:58', icon: 'offline' }, 'icon-offline'],
  [{ tone: 'success', text: 'Alle drei Tagesziele erfüllt' }, 'icon-check'],
  [{ tone: 'problem', cause: 'technik', text: 'Das Foto konnte nicht ausgewertet werden.' }, 'icon-alert'],
])('$tone: zeigt immer Symbol und Satz', async (props, icon) => {
  await render(<Notice {...props} />);

  expect(screen.getByText(props.text)).toBeOnTheScreen();
  expect(screen.getByTestId(icon, { includeHiddenElements: true })).toBeOnTheScreen();
});

test('bietet höchstens eine Aktion an', async () => {
  const onPress = jest.fn();
  await render(
    <Notice
      tone="problem"
      cause="ungueltige_eingabe"
      text="Dieser Code ist abgelaufen. Bitte Anna um einen neuen."
      action={{ label: 'Nochmal', onPress }}
    />,
  );

  await userEvent.press(screen.getByRole('button', { name: 'Nochmal' }));

  expect(onPress).toHaveBeenCalledTimes(1);
});

test('„problem“ verlangt seinen Anlass: Technik oder ungültige Eingabe', () => {
  // @ts-expect-error – ohne Anlass ist `problem` kein gültiger Hinweis (nie für Ziele oder Gewicht).
  const withoutCause: NoticeProps = { tone: 'problem', text: 'Kein Anlass' };
  expect(withoutCause.tone).toBe('problem');
});
