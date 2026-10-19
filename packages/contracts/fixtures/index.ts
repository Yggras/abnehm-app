import type { z } from 'zod';

import { authFixtures } from './auth.ts';
import { baseFixtures } from './base.ts';
import { couplingFixtures } from './coupling.ts';
import { dailyGoalFixtures } from './daily-goals.ts';
import type { SchemaFixtures } from './define.ts';
import { energyFixtures } from './energy.ts';
import { errorFixtures } from './errors.ts';
import { islandFixtures } from './island.ts';
import { notificationFixtures } from './notifications.ts';
import { onboardingFixtures } from './onboarding.ts';
import { partnerFixtures } from './partner.ts';
import { personFixtures } from './person.ts';
import { portFixtures } from './ports.ts';
import { routeFixtures } from './routes.ts';
import { statusFixtures } from './status.ts';
import { syncFixtures } from './sync.ts';
import { todayFixtures } from './today.ts';
import { wirFixtures } from './wir.ts';

/** Test-Entität der Sync-Tests in App und Backend; kein Teil des Transportkatalogs. */
export { TestWaterRecord, TestWaterUpsert } from './sync.ts';

/**
 * Fixture-Register aller exportierten Schemas, je Teilpfad des Pakets. Ein neues Schema bekommt
 * hier mindestens ein gültiges und ein ungültiges Fixture; die Vertragstests in Paket, App und
 * Backend laufen dann automatisch auch darüber.
 */
export const contractFixtures: Readonly<Record<string, Readonly<Record<string, SchemaFixtures>>>> = {
  base: baseFixtures,
  errors: errorFixtures,
  routes: routeFixtures,
  person: personFixtures,
  auth: authFixtures,
  coupling: couplingFixtures,
  'daily-goals': dailyGoalFixtures,
  energy: energyFixtures,
  partner: partnerFixtures,
  island: islandFixtures,
  wir: wirFixtures,
  notifications: notificationFixtures,
  ports: portFixtures,
  today: todayFixtures,
  onboarding: onboardingFixtures,
  status: statusFixtures,
  sync: syncFixtures,
};

export type FixtureCase = Readonly<{ name: string; schema: z.ZodType; value: unknown; valid: boolean }>;

/** Alle Fixtures als flache Liste, benannt als `<Teilpfad>.<Schema> › gültig|ungültig: <Beispiel>`. */
export function fixtureCases(): FixtureCase[] {
  return Object.entries(contractFixtures).flatMap(([area, schemas]) =>
    Object.entries(schemas).flatMap(([schemaName, { schema, valid, invalid }]) => [
      ...Object.entries(valid).map(([example, value]) => ({
        name: `${area}.${schemaName} › gültig: ${example}`,
        schema,
        value,
        valid: true,
      })),
      ...Object.entries(invalid).map(([example, value]) => ({
        name: `${area}.${schemaName} › ungültig: ${example}`,
        schema,
        value,
        valid: false,
      })),
    ]),
  );
}
