import { describe, expect, it } from 'vitest';

import { createTestClock } from '@abnehm/clock/testing';
import { Instant, TimeZone } from '@abnehm/contracts/base';

import { createJobRegistry } from '../src/jobs/job-registry.ts';
import { SECURITY_LOG_RETENTION_DAYS, type SecurityEvent } from '../src/security-log/security-log.ts';
import { createTestBackend } from './support/app.ts';
import { securityLogEntries } from './support/auth-client.ts';

// Sicherheitslog (Spezifikation 0, Abschnitt 11; #22) an seiner Schnittstelle, mit der Testuhr.

const DAY_MS = 24 * 60 * 60 * 1000;
const account = '7b0c6f3e-2a4d-4e8b-9c1f-5d6e7f8a9b0c';
const coupling = '1f2e3d4c-5b6a-4978-8695-a4b3c2d1e0f9';

const allowed: SecurityEvent[] = [
  { type: 'anmeldung', accountId: account, ipAddress: '203.0.113.7' },
  { type: 'anmeldung_fehlgeschlagen', accountId: null, reason: 'zugangsdaten_falsch', ipAddress: '2001:db8::1' },
  { type: 'abmeldung', accountId: account },
  { type: 'sitzungswiderruf', accountId: account, scope: 'alle', cause: 'passwortaenderung' },
  { type: 'passwortaenderung', accountId: account },
  { type: 'passwort_reset', accountId: account },
  { type: 'kopplung', accountId: account, couplingId: coupling, reactivated: false },
  { type: 'entkopplung', accountId: account, couplingId: coupling },
  { type: 'freigabeaenderung', accountId: account, couplingId: coupling, scope: 'gewicht', level: 'privat' },
  { type: 'freigabeaenderung', accountId: account, couplingId: coupling, scope: 'fotos', level: 'geteilt' },
  { type: 'fotozugriff_verweigert', accountId: account, operation: 'bildabruf' },
  { type: 'administrativer_zugriff', command: 'passwort_reset', targetAccountId: account },
];

const rejected: Record<string, unknown> = {
  'unbekannter Ereignistyp': { type: 'registrierung', accountId: account },
  'Zusatzfeld mit Passwort': { type: 'anmeldung', accountId: account, ipAddress: null, password: 'geheim-123' },
  'Zusatzfeld mit E-Mail': { type: 'passwortaenderung', accountId: account, email: 'anna@example.test' },
  'vollständiger Request': { type: 'abmeldung', accountId: account, request: { headers: {}, body: '{}' } },
  'Sitzungstoken statt Konto-ID': { type: 'abmeldung', accountId: 'zW8kX2qP9rT4vB7nM1cL5hJ3gF6dS0aE' },
  'Einladungscode statt IP': { type: 'anmeldung', accountId: account, ipAddress: '482913' },
  'Körperwert statt Freigabestufe': { type: 'freigabeaenderung', accountId: account, couplingId: coupling, scope: 'gewicht', level: '82.4' },
  'Fotodaten statt Vorgang': { type: 'fotozugriff_verweigert', accountId: account, operation: 'data:image/jpeg;base64,/9j/4AAQ' },
};

describe('Sicherheitslog', () => {
  it('nimmt jeden erlaubten Ereignistyp aus #22 mit seinen Feldern an', async () => {
    const backend = await createTestBackend();

    for (const event of allowed) await backend.securityLog.record(event);

    const entries = await securityLogEntries(backend);
    expect(entries.map((entry) => entry.eventType).sort()).toEqual(allowed.map((event) => event.type).sort());
    expect(entries).toContainEqual({
      eventType: 'administrativer_zugriff',
      accountId: account,
      details: { command: 'passwort_reset', targetAccountId: account },
    });
  });

  it.each(Object.entries(rejected))('weist ab: %s', async (_name, event) => {
    const backend = await createTestBackend();

    await expect(backend.securityLog.record(event as SecurityEvent)).rejects.toThrow();
    expect(await securityLogEntries(backend)).toEqual([]);
  });

  it('schreibt in der Transaktion des Aufrufers und verschwindet mit deren Rollback', async () => {
    const backend = await createTestBackend();

    await expect(
      backend.database.db.transaction(async (tx) => {
        await backend.securityLog.record({ type: 'entkopplung', accountId: account, couplingId: coupling }, tx);
        throw new Error('Fachänderung gescheitert');
      }),
    ).rejects.toThrow('Fachänderung gescheitert');
    expect(await securityLogEntries(backend)).toEqual([]);
  });

  it('löscht Einträge nach 90 Tagen über den registrierten Cleanup-Lauf', async () => {
    const clock = createTestClock({ instant: Instant.parse('2026-10-14T12:00:00.000Z'), timeZone: TimeZone.parse('UTC') });
    const backend = await createTestBackend({ clock });
    const jobs = createJobRegistry({ clock });
    jobs.register(backend.securityLog.cleanupJob);
    await backend.securityLog.record({ type: 'abmeldung', accountId: account });
    clock.advanceBy(DAY_MS);
    await backend.securityLog.record({ type: 'passwortaenderung', accountId: account });

    // Grenze: genau 90 Tage alt bleibt, eine Millisekunde älter wird gelöscht.
    clock.advanceBy((SECURITY_LOG_RETENTION_DAYS - 1) * DAY_MS);
    await jobs.runDue();
    expect((await securityLogEntries(backend)).map((entry) => entry.eventType).sort()).toEqual(['abmeldung', 'passwortaenderung']);
    clock.advanceBy(1);
    await backend.securityLog.cleanupJob.run();
    expect((await securityLogEntries(backend)).map((entry) => entry.eventType)).toEqual(['passwortaenderung']);

    // Am nächsten Tag ist der Lauf wieder fällig und löscht den jüngeren Eintrag.
    clock.advanceBy(DAY_MS - 2);
    await jobs.runDue();
    expect(await securityLogEntries(backend)).toHaveLength(1);
    clock.advanceBy(2);
    await jobs.runDue();
    expect(await securityLogEntries(backend)).toEqual([]);
  });

  it('meldet den Cleanup-Lauf unter festem Namen mit täglichem Intervall an', async () => {
    const backend = await createTestBackend();

    expect(backend.securityLog.cleanupJob).toMatchObject({ name: 'sicherheitslog_aufraeumen', intervalMs: DAY_MS });
  });
});
