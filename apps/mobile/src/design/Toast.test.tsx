import { render, screen, userEvent } from '@testing-library/react-native';

import { Toast } from './Toast';

test('„Rückgängig“ ruft das Undo genau einmal je Tipp auf', async () => {
  const onUndo = jest.fn();
  await render(<Toast line={{ text: '+250 ml Wasser' }} onUndo={onUndo} />);

  await userEvent.press(screen.getByRole('button', { name: 'Rückgängig' }));

  expect(onUndo).toHaveBeenCalledTimes(1);
});

test('zeigt eine angehängte Spielreaktion als zweite Zeile mit Energie-Symbol', async () => {
  await render(
    <Toast line={{ text: '+250 ml Wasser' }} secondLine={{ text: 'Wasserziel erfüllt · +1 Energie', energy: true }} onUndo={jest.fn()} />,
  );

  expect(screen.getByText('+250 ml Wasser')).toBeOnTheScreen();
  expect(screen.getByText('Wasserziel erfüllt · +1 Energie')).toBeOnTheScreen();
  expect(screen.getByTestId('icon-energy', { includeHiddenElements: true })).toBeOnTheScreen();
});

test('reine Bestätigung ohne „Rückgängig“', async () => {
  await render(<Toast line={{ text: 'Eintrag gespeichert' }} />);

  expect(screen.queryByRole('button')).not.toBeOnTheScreen();
});
