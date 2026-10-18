import { boolean, index, pgTable, timestamp, uuid } from 'drizzle-orm/pg-core';

import { text } from './columns.ts';

// Better-Auth-Tabellen des Auth-Moduls (Spezifikation 0, Abschnitte 8 und 9): nur Postgres, nicht
// im Fach-Sync. Die Eigenschaftsnamen sind die Feldnamen von Better Auth, die der Drizzle-Adapter
// erwartet (https://www.better-auth.com/docs/concepts/database#core-schema). Die Spaltennamen
// folgen dem übrigen Schema: Das Better-Auth-„user“ ist das Konto, Verweise darauf heißen
// `account_id`. Nur diese Tabellen führen eine E-Mail.

// Better Auth vergibt die IDs selbst (`advanced.database.generateId: 'uuid'`); der Default greift,
// falls es die ID der Datenbank überlässt.
const authId = () => uuid('id').primaryKey().defaultRandom();
const authInstant = (name: string) => timestamp(name, { withTimezone: true });

export const user = pgTable('user', {
  id: authId(),
  /** Bleibt leer: Der Anzeigename gehört der Person, nicht dem Konto. */
  name: text('name').notNull(),
  email: text('email').notNull().unique('user_email_uq'),
  emailVerified: boolean('email_verified').notNull(),
  image: text('image'),
  createdAt: authInstant('created_at').notNull(),
  updatedAt: authInstant('updated_at').notNull(),
});

export const session = pgTable(
  'session',
  {
    id: authId(),
    expiresAt: authInstant('expires_at').notNull(),
    token: text('token').notNull().unique('session_token_uq'),
    createdAt: authInstant('created_at').notNull(),
    updatedAt: authInstant('updated_at').notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: uuid('account_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
  },
  (t) => [index('session_account_idx').on(t.userId)],
);

/** Anmeldeverfahren eines Kontos; in V1 nur `credential` mit dem Passwort-Hash. */
export const account = pgTable(
  'account',
  {
    id: authId(),
    /** Kennung beim Anbieter; bei `credential` die Konto-ID selbst. */
    accountId: text('provider_account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: uuid('account_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: authInstant('access_token_expires_at'),
    refreshTokenExpiresAt: authInstant('refresh_token_expires_at'),
    scope: text('scope'),
    password: text('password'),
    createdAt: authInstant('created_at').notNull(),
    updatedAt: authInstant('updated_at').notNull(),
  },
  (t) => [index('account_account_idx').on(t.userId)],
);

/** Bestätigungstokens von Better Auth; ohne E-Mail-Verifikation und Mailversand in V1 ungenutzt. */
export const verification = pgTable(
  'verification',
  {
    id: authId(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: authInstant('expires_at').notNull(),
    createdAt: authInstant('created_at').notNull(),
    updatedAt: authInstant('updated_at').notNull(),
  },
  (t) => [index('verification_identifier_idx').on(t.identifier)],
);
