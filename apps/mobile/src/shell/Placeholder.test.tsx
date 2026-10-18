import { render, screen } from '@testing-library/react-native';
import { Slot } from 'expo-router';
import { renderRouter } from 'expo-router/testing-library';

import { MessageHostProvider } from './MessageHost';
import { MissingContributionError, Placeholder } from './Placeholder';

// `__DEV__` ist in React Native eine globale Variable; der Test schaltet sie auf Release um.
const runtime = globalThis as unknown as { __DEV__: boolean };
const developmentBuild = runtime.__DEV__;

afterEach(() => {
  runtime.__DEV__ = developmentBuild;
});

test('im Development Build zeigt ein fehlender Beitrag einen deutschen Platzhalter mit Lieferant', async () => {
  const Layout = () => (
    <MessageHostProvider>
      <Slot />
    </MessageHostProvider>
  );
  await renderRouter(
    { _layout: Layout, index: () => <Placeholder target={{ type: 'settings', section: 'health' }} /> },
    { initialUrl: '/' },
  );

  expect(screen.getByRole('header', { name: 'Gesundheitsdaten' })).toBeOnTheScreen();
  expect(screen.getByText('Dieser Bereich ist noch in Arbeit.')).toBeOnTheScreen();
  expect(screen.getByText('Kommt mit: Wasser, Sport, Gewicht & Health')).toBeOnTheScreen();
});

test('im Release ist ein fehlender Beitrag ein Integrationsfehler statt eines stillen Platzhalters', async () => {
  runtime.__DEV__ = false;
  jest.spyOn(console, 'error').mockImplementation(() => {});

  await expect(render(<Placeholder target={{ type: 'log' }} />)).rejects.toThrow(MissingContributionError);
  await expect(render(<Placeholder target={{ type: 'log' }} />)).rejects.toThrow(
    'Integrationsfehler: Für die Route log fehlt der Beitrag „Protokoll“.',
  );
});
