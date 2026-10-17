import { render, screen } from '@testing-library/react-native';

import { ProgressBar } from './ProgressBar';

test('meldet Name und Wert als Fortschrittsanzeige', async () => {
  await render(<ProgressBar label="Wasser heute" value={1000} target={1500} valueText="1,0 von 1,5 l" />);

  expect(screen.getByRole('progressbar', { name: 'Wasser heute' })).toHaveAccessibilityValue({
    min: 0,
    max: 1500,
    now: 1000,
    text: '1,0 von 1,5 l',
  });
  expect(screen.queryByText('erreicht')).not.toBeOnTheScreen();
});

test('erreicht: Häkchen und „erreicht“ zusätzlich zur vollen Spur', async () => {
  await render(<ProgressBar label="Sport diese Woche" value={150} target={150} valueText="150 von 150 min" />);

  expect(screen.getByText('erreicht')).toBeOnTheScreen();
  expect(screen.getByTestId('icon-check', { includeHiddenElements: true })).toBeOnTheScreen();
  expect(screen.getByRole('progressbar')).toHaveAccessibilityValue({ text: '150 von 150 min, erreicht' });
});

test('über dem Ziel bleibt der Balken voll, der Wert läuft weiter', async () => {
  await render(<ProgressBar label="Wasser heute" value={1750} target={1500} valueText="1,75 von 1,5 l" />);

  expect(screen.getByRole('progressbar')).toHaveAccessibilityValue({ now: 1500, max: 1500 });
  expect(screen.getByText('1,75 von 1,5 l')).toBeOnTheScreen();
});
