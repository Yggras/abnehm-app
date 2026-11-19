import { randomUUID } from 'node:crypto';

import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';

import type { Clock } from '@abnehm/clock';
import { RegisterPushInstallationRequest, type NotificationPermission } from '@abnehm/contracts/notifications';

import { forbiddenError, guard, policies, type Actor } from '../authorization/authorization.ts';
import { jsonBody } from '../contract-validation.ts';
import type { Database, DbExecutor } from '../database.ts';
import { pushInstallation } from '../db/schema/index.ts';
import type { LogoutHook } from '../logout/logout.ts';

// Push-Installation (Spezifikation 5, Abschnitt 9; #139): ein eigener Endpunkt außerhalb des Fach-Syncs,
// damit Expo-Push-Tokens nie im Sync erscheinen. Die Person und die Sitzung kommen aus der Sitzung.
// Jede Registrierung bindet die aktuelle Sitzung an die Installation; der Zusteller sendet nur an
// Installationen, deren Sitzung das Auth-Modul als gültig bestätigt (Spezifikation 0, Abschnitt 9).

/** Erlaubnisstatus der App zu den Werten der Spalte `permission_status`. */
const permissionStatus = {
  granted: 'erlaubt',
  denied: 'verweigert',
  undetermined: 'unentschieden',
} as const satisfies Record<NotificationPermission, string>;

export function createPushInstallations({ database, clock }: { database: Database; clock: Clock }) {
  const now = () => new Date(clock.read().instant);

  /**
   * Registrieren oder aktualisieren in einer Anweisung. Gehörte die Installationskennung einer anderen
   * Person, hängt das Upsert sie um: Danach gehört die Zeile der Person dieser Sitzung, und die andere
   * Person hat sie nicht mehr; für sie ist sie damit deaktiviert.
   */
  async function register(actor: Actor & { personId: string }, request: RegisterPushInstallationRequest) {
    const at = now();
    const current = {
      personId: actor.personId,
      sessionId: actor.sessionId,
      expoPushToken: request.expoPushToken,
      platform: request.platform,
      permissionStatus: permissionStatus[request.permission],
      active: true,
      lastUsedAt: at,
      updatedAt: at,
    };
    await database.db
      .insert(pushInstallation)
      .values({ id: randomUUID(), installationKey: request.installationKey, createdAt: at, ...current })
      .onConflictDoUpdate({ target: pushInstallation.installationKey, set: current });
  }

  /** Findet die Installation zur Kennung; die Regel der Matrix prüft danach das Eigentum. */
  async function locate(installationKey: string) {
    const [found] = await database.db
      .select({ id: pushInstallation.id })
      .from(pushInstallation)
      .where(eq(pushInstallation.installationKey, installationKey));
    // Eine unbekannte Kennung ist eine neue eigene Ressource; deaktivieren bleibt dann ohne Wirkung.
    return { id: found?.id ?? installationKey };
  }

  const routes = new Hono()
    .post('/push-installations', guard(policies.authenticated()), jsonBody(RegisterPushInstallationRequest), async (c) => {
      const { actor } = c.var;
      if (actor.personId === null) return c.json(forbiddenError, 403);
      await register({ ...actor, personId: actor.personId }, c.req.valid('json'));
      return c.body(null, 204);
    })
    .post(
      '/push-installations/:installationKey/deactivate',
      guard(policies.resource('push_installation', 'upsert'), (c) => locate(c.req.param('installationKey') ?? '')),
      async (c) => {
        const { actor, resource } = c.var;
        if (resource.exists) {
          // Mit der Person als Bedingung, falls die Kennung inzwischen umgehängt wurde.
          await database.db
            .update(pushInstallation)
            .set({ active: false, updatedAt: now() })
            .where(and(eq(pushInstallation.installationKey, c.req.param('installationKey')), eq(pushInstallation.personId, actor.personId)));
        }
        return c.body(null, 204);
      },
    );

  /** Abmelde-Haken (#111): Das Abmelden deaktiviert die Installation, die mit dieser Sitzung registriert wurde. */
  const logoutHook: LogoutHook = {
    name: 'push_installation',
    async run(tx: DbExecutor, actor: Actor) {
      await tx
        .update(pushInstallation)
        .set({ active: false, updatedAt: now() })
        .where(and(eq(pushInstallation.sessionId, actor.sessionId), eq(pushInstallation.active, true)));
    },
  };

  return {
    /** `POST /v1/push-installations` und `POST /v1/push-installations/:installationKey/deactivate`. */
    routes,
    logoutHook,
  };
}

export type PushInstallations = ReturnType<typeof createPushInstallations>;
