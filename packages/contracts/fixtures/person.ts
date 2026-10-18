import { PersonUpsert, UpdatePersonTimeZone, UpdatePersonTimeZoneResult } from '../src/person.ts';
import { fixtures } from './define.ts';
import { now, philipp, timeZone } from './ids.ts';

const started = {
  id: philipp,
  displayName: 'Philipp',
  calculationSex: null,
  birthDate: null,
  heightCm: null,
  activityLevel: null,
  pregnantOrBreastfeeding: null,
  knownEatingDisorder: null,
  disclaimerAcceptedAt: now,
  onboardingStatus: 'begonnen',
  onboardingCompletedAt: null,
  goalWeightReachedG: null,
  goalWeightReachedAt: null,
} as const;

const completed = {
  ...started,
  calculationSex: 'maennlich',
  birthDate: '1990-05-17',
  heightCm: 182,
  activityLevel: 'wenig_aktiv',
  pregnantOrBreastfeeding: false,
  knownEatingDisorder: false,
  onboardingStatus: 'abgeschlossen',
  onboardingCompletedAt: now,
} as const;

export const personFixtures = {
  PersonUpsert: fixtures(PersonUpsert, {
    valid: {
      'nach dem Bootstrap': started,
      'Onboarding abgeschlossen': completed,
      'Zielgewicht erreicht': { ...completed, goalWeightReachedG: 76_000, goalWeightReachedAt: now },
    },
    invalid: {
      'mit Zeitzone': { ...completed, timeZone },
      'mit Konto-Verweis': { ...completed, accountId: philipp },
      'mit Serverversion': { ...completed, serverVersion: '12' },
      'abgeschlossen ohne Körperdaten': { ...started, onboardingStatus: 'abgeschlossen', onboardingCompletedAt: now },
      'begonnen mit Abschlusszeitpunkt': { ...started, onboardingCompletedAt: now },
      'erreichtes Zielgewicht ohne Zeitpunkt': { ...completed, goalWeightReachedG: 76_000 },
      'Größe in Metern': { ...completed, heightCm: 1.82 },
    },
  }),
  UpdatePersonTimeZone: fixtures(UpdatePersonTimeZone, {
    valid: { 'Berlin': { timeZone }, 'Reise nach New York': { timeZone: 'America/New_York' } },
    invalid: {
      'mit weiteren Personenfeldern': { timeZone, displayName: 'Philipp' },
      'mit Personen-ID': { timeZone, personId: philipp },
      'Versatz statt Zone': { timeZone: '+02:00' },
    },
  }),
  UpdatePersonTimeZoneResult: fixtures(UpdatePersonTimeZoneResult, {
    valid: { 'übernommen': { personId: philipp, timeZone, serverVersion: '1841' } },
    invalid: { 'ohne Serverversion': { personId: philipp, timeZone } },
  }),
};
