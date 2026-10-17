import type { ConfigContext } from 'expo/config';

import createConfig from '../app.config';

const originalVariant = process.env.APP_VARIANT;

afterEach(() => {
  if (originalVariant === undefined) delete process.env.APP_VARIANT;
  else process.env.APP_VARIANT = originalVariant;
});

function configFor(variant: string | undefined) {
  if (variant === undefined) delete process.env.APP_VARIANT;
  else process.env.APP_VARIANT = variant;
  return createConfig({ config: {} } as ConfigContext);
}

test('erlaubt lokales HTTP (ATS) nur im Development Build', () => {
  expect(configFor('development').ios?.infoPlist?.NSAppTransportSecurity).toEqual({
    NSAllowsArbitraryLoads: false,
    NSAllowsLocalNetworking: true,
  });
});

test.each([undefined, 'production', 'preview', 'Development'])(
  'baut ohne ausdrückliche Development-Variante (%s) ohne Netzwerkausnahme',
  (variant) => {
    expect(configFor(variant).ios?.infoPlist?.NSAppTransportSecurity).toEqual({ NSAllowsArbitraryLoads: false });
  },
);

test('Development- und Produktionsbuild lassen sich nebeneinander installieren', () => {
  const development = configFor('development');
  const production = configFor(undefined);

  expect(development.ios?.bundleIdentifier).not.toBe(production.ios?.bundleIdentifier);
  expect(development.android?.package).not.toBe(production.android?.package);
});
