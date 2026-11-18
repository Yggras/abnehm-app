import { z } from 'zod';

import { TimeZone } from '@abnehm/contracts/base';
import { SeedKey, SeedScenarioKey } from '@abnehm/contracts/seeds';
import type { RouteTarget } from '@abnehm/contracts/routes';

import { healthScenarios, type HealthScenario } from '../health/testing/fake-platform';
import { targetFromLink } from '../navigation/href';
import type { ClockAdjustment } from './clock';
import { deviceSuitePhases, type DeviceSuitePhase } from './device-suite/suite';
import { faultPlanSchema, type FaultPlan } from './faults';
import { runtimeProfileKeySchema, type RuntimeProfileKey } from './profiles';

// Deep Links der Testfähigkeiten (#112, #114), nur in Test-Artefakten (Development- und E2E-Build;
// Schema `abnehmapp-dev` bzw. `abnehmapp-e2e`):
//
//   abnehmapp-dev://seed?szenario=solo[&installation=philipp-iphone][&ziel=/capture/water]
//     seedet Backend und lokale Datenbank, meldet das Testkonto an und öffnet das Ziel (sonst „Heute“);
//   abnehmapp-dev://fehler?transport=offline&server=unavailable&auth=session_rejected&storage=unavailable
//     stellt die Fehler-Adapter; ohne Parameter stehen alle wieder auf `ok`. `transport=offline` ist
//     zugleich der Transport-Fehlermodus, der auf iOS den Flugmodus ersetzt;
//   abnehmapp-dev://uhr?stunden=25&zone=Pacific/Kiritimati
//     stellt die Testuhr ganze Stunden vor und/oder auf eine neue eigene Zone (Reise); die Serveruhr
//     des Development-Backends folgt ihr (#271, `server-clock.ts`);
//   abnehmapp-dev://profil?name=transport-offline
//     stellt ein benanntes Laufzeitprofil (#113) über Fehler-Adapter und Testuhr;
//   abnehmapp-dev://geraetetest?phase=vor_neustart|nach_neustart
//     führt eine Phase der On-Device-Suite aus;
//   abnehmapp-dev://health?szenario=erstimport
//     stellt die Health-Attrappe auf ein Szenario (#183) und verbindet den Health-Import.
//
// Geparst wird von Hand: Die URL-Implementierung von React Native ist unvollständig.

export type TestLink =
  | Readonly<{ type: 'seed'; scenario: SeedScenarioKey; installation: SeedKey | null; target: RouteTarget }>
  | Readonly<{ type: 'fehler'; plan: Partial<FaultPlan> }>
  | Readonly<{ type: 'uhr'; adjustment: ClockAdjustment }>
  | Readonly<{ type: 'profil'; profile: RuntimeProfileKey }>
  | Readonly<{ type: 'geraetetest'; phase: DeviceSuitePhase }>
  | Readonly<{ type: 'health'; scenario: HealthScenario }>
  /** Ein Link einer Testfähigkeit mit ungültigen Parametern. */
  | Readonly<{ type: 'ungueltig'; capability: TestLinkPath }>;

/** Pfade der Deep Links; der Release-Test gleicht sie mit der Registry ab (`test/test-capabilities.ts`). */
export const testLinkPaths = { seed: 'seed', fehler: 'fehler', uhr: 'uhr', profil: 'profil', geraetetest: 'geraetetest', health: 'health' } as const;
export type TestLinkPath = keyof typeof testLinkPaths;

const clockParams = z
  .strictObject({ stunden: z.string().regex(/^\d{1,4}$/).transform(Number).optional(), zone: TimeZone.optional() })
  .refine((params) => params.stunden !== undefined || params.zone !== undefined);

const deviceSuiteParams = z.strictObject({ phase: z.enum(deviceSuitePhases) });

const profileParams = z.strictObject({ name: runtimeProfileKeySchema });

const healthParams = z.strictObject({ szenario: z.enum(healthScenarios) });

/** Der Link als Testfähigkeit, oder `null`, wenn er keiner ist. */
export function parseTestLink(link: string): TestLink | null {
  const withoutScheme = link.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
  const [rawPath = '', query = ''] = withoutScheme.split('?', 2);
  const path = rawPath.replace(/^\/+|\/+$/g, '');
  const params = parseQuery(query);
  if (path === testLinkPaths.seed) {
    const scenario = SeedScenarioKey.safeParse(params.get('szenario'));
    const installation = params.has('installation') ? SeedKey.safeParse(params.get('installation')) : null;
    if (!scenario.success || installation?.success === false) return { type: 'ungueltig', capability: 'seed' };
    const goal = params.get('ziel');
    return {
      type: 'seed',
      scenario: scenario.data,
      installation: installation?.data ?? null,
      target: goal === undefined ? { type: 'today' } : targetFromLink(goal, {}),
    };
  }
  if (path === testLinkPaths.fehler) {
    const plan = faultPlanSchema.partial().safeParse(Object.fromEntries(params));
    return plan.success ? { type: 'fehler', plan: plan.data } : { type: 'ungueltig', capability: 'fehler' };
  }
  if (path === testLinkPaths.uhr) {
    const clock = clockParams.safeParse(Object.fromEntries(params));
    if (!clock.success) return { type: 'ungueltig', capability: 'uhr' };
    const { stunden, zone } = clock.data;
    return { type: 'uhr', adjustment: { ...(stunden === undefined ? {} : { advanceHours: stunden }), ...(zone === undefined ? {} : { timeZone: zone }) } };
  }
  if (path === testLinkPaths.profil) {
    const profile = profileParams.safeParse(Object.fromEntries(params));
    return profile.success ? { type: 'profil', profile: profile.data.name } : { type: 'ungueltig', capability: 'profil' };
  }
  if (path === testLinkPaths.geraetetest) {
    const suite = deviceSuiteParams.safeParse(Object.fromEntries(params));
    return suite.success ? { type: 'geraetetest', phase: suite.data.phase } : { type: 'ungueltig', capability: 'geraetetest' };
  }
  if (path === testLinkPaths.health) {
    const health = healthParams.safeParse(Object.fromEntries(params));
    return health.success ? { type: 'health', scenario: health.data.szenario } : { type: 'ungueltig', capability: 'health' };
  }
  return null;
}

function parseQuery(query: string): Map<string, string> {
  const params = new Map<string, string>();
  for (const pair of query.split('&')) {
    if (pair === '') continue;
    const [key = '', value = ''] = pair.split('=', 2);
    try {
      params.set(decodeURIComponent(key), decodeURIComponent(value.replace(/\+/g, ' ')));
    } catch {
      params.set(key, value);
    }
  }
  return params;
}
