import { Hono } from 'hono';
import { expect } from 'vitest';

import {
  forbiddenError,
  guard,
  type Policy,
  type ProtectionDimension,
  type ResourcePolicy,
  type ResourceTarget,
} from '../../src/authorization/authorization.ts';
import type { TestBackend } from './app.ts';
import { call, newDevice, signUp, type Device, type Reply } from './auth-client.ts';

// Negativtest-Gerüst der zentralen Autorisierung (Spezifikation 0, Abschnitt 11; #98). Aus den
// Schutzdimensionen einer Policy entstehen nur die anwendbaren Fälle, jeder mit positiver Gegenprobe:
// Erst gelingt die Anfrage der berechtigten Person, dann scheitert die Abwandlung. Eine öffentliche
// Route erwartet stattdessen Erfolg ohne Sitzung. Registriert wird mit `it(case.name, case.run)`.

/** Was eine Anfrage bewirkt hat, unabhängig vom Transport. */
export type Outcome = 'erlaubt' | 'verweigert' | 'ohne_sitzung' | `unerwartet: ${string}`;

/** Ergebnis einer HTTP-Antwort: `401` ohne Body, `403` mit genau `forbidden` oder Erfolg. */
export function httpOutcome(reply: Reply): Outcome {
  if (reply.status === 401 && reply.body === null) return 'ohne_sitzung';
  if (reply.status === 403 && JSON.stringify(reply.body) === JSON.stringify(forbiddenError)) return 'verweigert';
  if (reply.status >= 200 && reply.status < 300) return 'erlaubt';
  return `unerwartet: ${reply.status} ${JSON.stringify(reply.body)}`;
}

/**
 * Ausgangszustand eines Falls: frisches Backend und das Gerät der berechtigten Person. `alsoForeign`
 * nennt weitere fremde Personen, etwa den Partner bei eigenen Einträgen; eine unbeteiligte Person
 * legt das Gerüst selbst an.
 */
export type AuthorizationWorld = { backend: TestBackend; actor: Device; alsoForeign?: readonly Device[] };

/** Was ein Szenario je Dimension beiträgt; ohne Sitzung und fremde Person leitet das Gerüst selbst ab. */
type Variants<W> = {
  /** Die berechtigte Person nennt eine fremde ID oder ein fremdes Eigentumsfeld. */
  manipulierte_id: (world: W) => Promise<Outcome>;
  /** Die berechtigte Person versucht auf derselben Ressource eine Operation, die die Matrix verbietet. */
  verbotene_operation: (world: W) => Promise<Outcome>;
  /** Archiviert die Kopplung; danach wiederholt das Gerüst die Anfrage der Gegenprobe. */
  entkopplung: (world: W) => Promise<void>;
  /** Entzieht die maßgebliche Freigabe; danach wiederholt das Gerüst die Anfrage der Gegenprobe. */
  freigabeentzug: (world: W) => Promise<void>;
};

export type AuthorizationScenario<W extends AuthorizationWorld, D extends ProtectionDimension> = {
  /** Die Policy, die die Route trägt; das Gerüst prüft das an der echten App. */
  policy: Policy & { dimensions: readonly D[] };
  /** Route beziehungsweise Fachbefehl, deren Policy tatsächlich angemeldet sein muss. */
  route?: { method: 'GET' | 'POST'; path: string };
  command?: string;
  arrange(): Promise<W>;
  /** Die Anfrage der positiven Gegenprobe, gestellt von `device`. */
  attempt(world: W, device: Device): Promise<Outcome>;
} & Pick<Variants<W>, Extract<D, keyof Variants<W>>>;

export type AuthorizationCase = Readonly<{ name: string; run: () => Promise<void> }>;

export function authorizationCases<W extends AuthorizationWorld, D extends ProtectionDimension>(
  scenario: AuthorizationScenario<W, D>,
): AuthorizationCase[] {
  const { policy } = scenario;
  const variants = scenario as unknown as Partial<Variants<W>>;
  const withoutSession = (world: W) => scenario.attempt(world, { ip: world.actor.ip });

  const routeCase: AuthorizationCase[] =
    scenario.route === undefined
      ? []
      : [
          {
            name: `${scenario.route.method} ${scenario.route.path} trägt die Policy ${policy.kind}`,
            run: async () => {
              const { backend } = await scenario.arrange();
              const actual = backend.authorization.routePolicy(backend.app, scenario.route!.method, scenario.route!.path);
              expect(actual).toEqual(policy);
            },
          },
        ];

  const commandCase: AuthorizationCase[] = scenario.command === undefined ? [] : [{
    name: `Fachbefehl ${scenario.command} trägt die Policy`,
    run: async () => {
      const { backend } = await scenario.arrange();
      expect(backend.authorization.registeredCommands().get(scenario.command!)).toEqual(policy);
    },
  }];

  if (policy.kind === 'public') {
    return [
      ...routeCase,
      ...commandCase,
      {
        name: 'öffentlich: gelingt ohne Sitzung',
        run: async () => expect(await withoutSession(await scenario.arrange())).toBe('erlaubt'),
      },
    ];
  }

  const denial: Record<ProtectionDimension, (world: W) => Promise<Outcome>> = {
    ohne_sitzung: withoutSession,
    fremde_person: async (world) => {
      const stranger = (await personWithSession(world.backend, 'fremd@example.test')).device;
      for (const device of [stranger, ...(world.alsoForeign ?? [])]) {
        const outcome = await scenario.attempt(world, device);
        if (outcome !== 'verweigert') return outcome;
      }
      return 'verweigert';
    },
    manipulierte_id: (world) => variants.manipulierte_id!(world),
    verbotene_operation: (world) => variants.verbotene_operation!(world),
    entkopplung: async (world) => {
      await variants.entkopplung!(world);
      return scenario.attempt(world, world.actor);
    },
    freigabeentzug: async (world) => {
      await variants.freigabeentzug!(world);
      return scenario.attempt(world, world.actor);
    },
  };

  return [
    ...routeCase,
    ...commandCase,
    ...policy.dimensions.map((dimension) => ({
      name: `${dimension}: verweigert, die Gegenprobe gelingt`,
      run: async () => {
        const world = await scenario.arrange();
        expect(await scenario.attempt(world, world.actor), 'positive Gegenprobe').toBe('erlaubt');
        expect(await denial[dimension](world)).toBe(dimension === 'ohne_sitzung' ? 'ohne_sitzung' : 'verweigert');
      },
    })),
  ];
}

/** Registrierte Fachbefehle werden vollständig in Negativfälle überführt; eine fehlende Szenario-
 * Familie ist ein Testfehler statt eines still übergangenen Befehls. Admin-Kommandos sind kein Sync. */
export function registeredCommandCases<W extends AuthorizationWorld, D extends ProtectionDimension>(
  backend: TestBackend,
  scenarios: Readonly<Record<string, AuthorizationScenario<W, D>>>,
): AuthorizationCase[] {
  const registered = [...backend.authorization.registeredCommands()].filter(([, policy]) => policy.kind === 'resourceOperation');
  for (const [name] of registered) if (scenarios[name] === undefined) throw new Error(`Negativtest für Fachbefehl ${name} fehlt`);
  return registered.flatMap(([name, policy]) => authorizationCases({ ...scenarios[name]!, policy: policy as Policy & { dimensions: readonly D[] }, command: name }));
}

/** Ein Konto mit Person und angemeldetem Gerät, wie nach Registrierung und Bootstrap. */
export async function personWithSession(backend: TestBackend, email: string, displayName = 'Testperson') {
  const { device, accountId } = await signUp(backend, email, newDevice());
  const reply = await call(backend, 'POST', '/v1/person/bootstrap', device, { displayName, timeZone: 'Europe/Berlin' });
  if (reply.status !== 200) throw new Error(`Bootstrap fehlgeschlagen: ${reply.status}`);
  return { device, accountId, personId: (reply.body as { personId: string }).personId };
}

/**
 * Test-Route für eine Ressourcen-Policy: Guard samt App-weiter Prüfung, die Ressource aus dem Body.
 * Antwortet bei Erfolg mit den Fakten aus `c.var.resource`. So prüfen Tests die Regeln der Matrix
 * über dieselbe HTTP-Grenze wie echte Endpunkte, bevor die Bereiche ihre Routen liefern.
 */
export function resourceProbe(backend: TestBackend, policy: ResourcePolicy) {
  const app = new Hono()
    .use('*', backend.authorization.enforce)
    .post('/v1/probe', guard(policy, async (c) => (await c.req.json()) as ResourceTarget), (c) => c.json(c.var.resource));
  return (device: Device, target: ResourceTarget = {}) => call({ app }, 'POST', '/v1/probe', device, target);
}
