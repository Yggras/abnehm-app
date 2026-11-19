import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';

import { createTestClock, type TestClock } from '@abnehm/clock/testing';
import { Instant } from '@abnehm/contracts/base';
import type { RegisterPushInstallationRequest } from '@abnehm/contracts/notifications';
import { InstallationId } from '@abnehm/contracts/sync';

import { deliveryAttempt, notificationIntent, pushInstallation } from '../../src/db/schema/index.ts';
import { createTestApp, createTestBackend, type TestBackend } from './app.ts';
import { call, type Device } from './auth-client.ts';
import { personWithSession } from './authorization.ts';
import { coupleByInvitation, worldStart } from './coupled-world.ts';
import { sendOp } from './encouragement.ts';
import { push } from './sync.ts';

// Testwelt des Push-Zustellers (#142): Philipp und Anna, gekoppelt über die echte Einladung, Annas
// iPhone mit Push-Installation über den echten Endpunkt; Testuhr und Fake-Expo-Push-Port.

export type PushWorld = Awaited<ReturnType<typeof pushWorld>>;

export async function pushWorld() {
  const clock = createTestClock(worldStart);
  const backend = await createTestBackend({ clock });
  const philipp = await personWithSession(backend, 'philipp@example.test', 'Philipp');
  const anna = await personWithSession(backend, 'anna@example.test', 'Anna');
  await coupleByInvitation(backend, philipp.device, anna.device);
  const annasIphone = await registerInstallation(backend, anna.device, { expoPushToken: 'ExponentPushToken[anna-iphone]' });
  return { backend, clock, philipp, anna, annasIphone, fake: backend.fakeExpoPush };
}

/** Meldet ein Gerät über `POST /v1/push-installations` an; liefert die Registrierung. */
export async function registerInstallation(backend: TestBackend, device: Device, overrides: Partial<RegisterPushInstallationRequest> = {}) {
  const request: RegisterPushInstallationRequest = {
    installationKey: InstallationId.parse(randomUUID()),
    platform: 'ios',
    expoPushToken: `ExponentPushToken[${randomUUID()}]`,
    permission: 'granted',
    ...overrides,
  };
  const reply = await call(backend, 'POST', '/v1/push-installations', device, request);
  if (reply.status !== 204) throw new Error(`Registrierung fehlgeschlagen: ${reply.status}`);
  return request;
}

/** Philipp feuert Anna an; liefert die Intent-ID des Pushes. */
export async function encourage(world: { backend: TestBackend; philipp: { device: Device }; anna: { personId: string } }, messageKey = 'gemeinsam_fuer_momo') {
  const operation = sendOp({ messageKey });
  const [result] = await push(world.backend, world.philipp.device, [operation]);
  if (result?.type !== 'applied') throw new Error(`Anfeuern fehlgeschlagen: ${JSON.stringify(result)}`);
  const encouragementId = operation.payload.encouragementId;
  return { encouragementId, intentId: `${encouragementId}:${world.anna.personId}:anfeuern` };
}

export const nowOf = (clock: TestClock) => Instant.parse(clock.read().instant);

export async function intentStatus(backend: TestBackend, intentId: string) {
  const [row] = await backend.database.db.select({ status: notificationIntent.status }).from(notificationIntent).where(eq(notificationIntent.intentId, intentId));
  return row?.status;
}

export async function attemptsOf(backend: TestBackend, intentId: string) {
  return backend.database.db.select().from(deliveryAttempt).where(eq(deliveryAttempt.intentId, intentId)).orderBy(deliveryAttempt.createdAt);
}

export async function installationActive(backend: TestBackend, installationKey: string) {
  const [row] = await backend.database.db.select({ active: pushInstallation.active }).from(pushInstallation).where(eq(pushInstallation.installationKey, installationKey));
  return row?.active;
}

/** Ein zweites Backend über derselben Datenbank, etwa eine zweite Arbeitsschleife oder der Neustart nach einem Absturz. */
export function secondBackend(backend: TestBackend, clock: TestClock) {
  return createTestApp(backend.database, { clock, fakeExpoPush: backend.fakeExpoPush });
}

export const minutes = (count: number) => count * 60_000;
export const hours = (count: number) => count * 60 * 60_000;
