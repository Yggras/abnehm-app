import type { RouteTarget } from '@abnehm/contracts/routes';
import { SeedRequest, seedManifests, seedRoutePath, type SeedKey, type SeedScenarioKey } from '@abnehm/contracts/seeds';

import type { AppSession } from '../../session/app-session';
import type { AppTestClock } from '../clock';
import { seedLocalDatabase } from './local-seed';

// Ablauf des Seed-Deep-Links (#112): Szenario im Development-Backend seeden, Testuhr auf die Uhr des
// Manifests stellen, das Testkonto über das echte Auth-Modul anmelden (das öffnet seine
// Kontodatenbank), die lokale Datenbank der Installation seeden und das Ziel nennen. Die
// Sitzungs-Weiche (#110) entscheidet sonst über „Heute“ oder Onboarding; ein Seed-Szenario mit
// fertigem Onboarding führt direkt auf sein Ziel.

export type SeedRun = Readonly<{ scenario: SeedScenarioKey; installation: SeedKey | null; target: RouteTarget }>;

export type SeedOutcome =
  | Readonly<{ type: 'geseedet'; scenario: SeedScenarioKey; installation: SeedKey; target: RouteTarget }>
  | Readonly<{ type: 'fehlgeschlagen'; step: 'installation' | 'backend' | 'anmeldung' | 'lokal' }>;

export async function runSeed(run: SeedRun, { session, clock }: { session: AppSession; clock: AppTestClock }): Promise<SeedOutcome> {
  const manifest = seedManifests[run.scenario];
  const installation = manifest.installations.find((candidate) => candidate.key === (run.installation ?? manifest.installations[0]?.key));
  const account = manifest.accounts.find((candidate) => candidate.key === installation?.account);
  if (installation === undefined || account === undefined) return { type: 'fehlgeschlagen', step: 'installation' };

  try {
    const response = await session.fetch(`${session.baseUrl}${seedRoutePath}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(SeedRequest.parse({ scenario: run.scenario })),
    });
    if (response.status !== 204) return { type: 'fehlgeschlagen', step: 'backend' };
  } catch {
    return { type: 'fehlgeschlagen', step: 'backend' };
  }

  clock.fix(manifest.clock);
  const signedIn = await session.auth.signIn({ email: account.email, password: account.password });
  const database = session.databases.current();
  if (signedIn.type !== 'signed_in' || signedIn.accountId !== account.accountId || database?.accountId !== account.accountId) {
    return { type: 'fehlgeschlagen', step: 'anmeldung' };
  }

  try {
    seedLocalDatabase(database, manifest, installation.key);
  } catch {
    return { type: 'fehlgeschlagen', step: 'lokal' };
  }
  return { type: 'geseedet', scenario: run.scenario, installation: installation.key, target: run.target };
}
