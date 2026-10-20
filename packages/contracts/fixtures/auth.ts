import { BootstrapPersonRequest, BootstrapPersonResult, LogoutRequest, LogoutResult, Password } from '../src/auth.ts';
import { fixtures } from './define.ts';
import { now, philipp, timeZone } from './ids.ts';

const requestId = '0f8b1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c2d';

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
  LogoutRequest: fixtures(LogoutRequest, {
    valid: { 'mit requestId': { requestId } },
    invalid: {
      'ohne requestId': {},
      'keine UUID': { requestId: 'abmelden-1' },
      'mit Konto-ID': { requestId, accountId: philipp },
    },
  }),
  LogoutResult: fixtures(LogoutResult, {
    valid: { abgemeldet: { loggedOutAt: now } },
    invalid: {
      'ohne Zeitpunkt': {},
      'mit Sitzungstoken': { loggedOutAt: now, token: 'abc' },
    },
  }),
};
