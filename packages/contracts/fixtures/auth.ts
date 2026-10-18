import { BootstrapPersonRequest, BootstrapPersonResult, Password } from '../src/auth.ts';
import { fixtures } from './define.ts';
import { philipp, timeZone } from './ids.ts';

export const authFixtures = {
  Password: fixtures(Password, {
    valid: {
      'genau 10 Zeichen': 'abcdefghij',
      '64 Zeichen': 'x'.repeat(64),
      'Passphrase mit Leerzeichen und Umlauten': 'grüne Wiese am Fluss',
      '128 Zeichen': 'y'.repeat(128),
    },
    invalid: {
      '9 Zeichen': 'abcdefghi',
      '129 Zeichen': 'z'.repeat(129),
      'keine Zeichenfolge': 1234567890,
    },
  }),
  BootstrapPersonRequest: fixtures(BootstrapPersonRequest, {
    valid: { 'Name und Zone': { displayName: 'Philipp', timeZone } },
    invalid: {
      'mit Personen-ID': { displayName: 'Philipp', timeZone, personId: philipp },
      'mit Konto-ID': { displayName: 'Philipp', timeZone, accountId: philipp },
      'ohne Zone': { displayName: 'Philipp' },
      'leerer Name': { displayName: '', timeZone },
    },
  }),
  BootstrapPersonResult: fixtures(BootstrapPersonResult, {
    valid: {
      'neue Person': { personId: philipp, displayName: 'Philipp', onboardingStatus: 'begonnen', timeZone, serverVersion: '1' },
    },
    invalid: {
      'ohne Serverversion': { personId: philipp, displayName: 'Philipp', onboardingStatus: 'begonnen', timeZone },
      'mit Konto-ID': {
        personId: philipp,
        displayName: 'Philipp',
        onboardingStatus: 'begonnen',
        timeZone,
        serverVersion: '1',
        accountId: philipp,
      },
    },
  }),
};
