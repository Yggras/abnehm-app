import { render, screen } from '@testing-library/react-native';

import { MomoFigure, MomoAppearanceProvider } from './MomoFigure';

test('ohne Kopplung oder vor der Rollenwahl beschreibt sie die Laichkugel', async () => {
  await render(<MomoFigure mood="neugierig" size={104} />);
  expect(screen.getByRole('image', { name: 'Momo wartet im Ei' })).toBeOnTheScreen();
});

test('nach der Rollenwahl liest sie ihre Entwicklungsform selbst statt aus Figure-Props', async () => {
  await render(
    <MomoAppearanceProvider appearance={{ stage: 'geschluepft', formKey: 'huepfer', moodKey: 'zufrieden', accessories: { kopf: null, hals: null } }}>
      <MomoFigure mood="freut_sich" size={80} />
    </MomoAppearanceProvider>,
  );
  expect(screen.getByRole('image', { name: 'Momo, freut sich' })).toBeOnTheScreen();
});
