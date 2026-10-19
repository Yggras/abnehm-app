import { SeedKey, SeedScenarioKey } from '@abnehm/contracts/seeds';
import type { RouteTarget } from '@abnehm/contracts/routes';

import { targetFromLink } from '../navigation/href';
import { faultPlanSchema, type FaultPlan } from './faults';

// Deep Links der Testfähigkeiten (#112), nur im Development Build:
//
//   abnehmapp-dev://seed?szenario=solo[&installation=philipp-iphone][&ziel=/capture/water]
//     seedet Backend und lokale Datenbank, meldet das Testkonto an und öffnet das Ziel (sonst „Heute“);
//   abnehmapp-dev://fehler?transport=offline&server=unavailable&auth=session_rejected&storage=unavailable
//     stellt die Fehler-Adapter; ohne Parameter stehen alle wieder auf `ok`.
//
// Geparst wird von Hand: Die URL-Implementierung von React Native ist unvollständig.

export type TestLink =
  | Readonly<{ type: 'seed'; scenario: SeedScenarioKey; installation: SeedKey | null; target: RouteTarget }>
  | Readonly<{ type: 'fehler'; plan: Partial<FaultPlan> }>
  /** Ein Link einer Testfähigkeit mit ungültigen Parametern. */
  | Readonly<{ type: 'ungueltig'; capability: 'seed' | 'fehler' }>;

/** Pfade der Deep Links; der Release-Test gleicht sie mit der Registry ab (`test/test-capabilities.ts`). */
export const testLinkPaths = { seed: 'seed', fehler: 'fehler' } as const;

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
