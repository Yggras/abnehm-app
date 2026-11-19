import { createTestClock } from '@abnehm/clock/testing';
import { Instant, TimeZone } from '@abnehm/contracts/base';

import { unavailableHealthPlatform, type HealthImport } from '../health';
import { appHealthImport } from '../health/app-health';
import { createTestHealth } from './health';

// Nachweis für #183: Die Health-Attrappe in Development- und E2E-Build. Bis zum ersten Link `health` reicht
// sie an die Plattform des Builds durch, danach antwortet sie nach dem Szenario und verbindet den
// Health-Import des geöffneten Kontos.

const clock = createTestClock({ instant: Instant.parse('2026-10-14T10:00:00.000Z'), timeZone: TimeZone.parse('Europe/Berlin') });

describe('Health-Attrappe in Test-Artefakten', () => {
  it('reicht bis zum ersten Szenario an die Plattform durch und antwortet danach selbst', async () => {
    const health = createTestHealth(clock);
    const platform = health.platform(unavailableHealthPlatform('apple_health'));
    expect(platform.origin).toBe('apple_health');
    expect(await platform.availability()).toBe('nicht_verfuegbar');

    expect(await health.apply('fitbit_vorhanden')).toBeNull();

    expect(await platform.availability()).toBe('verfuegbar');
    expect((await platform.recentOrigins(30)).map(({ sourceApp }) => sourceApp.id)).toContain('com.fitbit.FitbitMobile');
  });

  it('verbindet nach dem Szenario den Health-Import des geöffneten Kontos', async () => {
    const health = createTestHealth(clock);
    health.platform(unavailableHealthPlatform('health_connect'));
    const connect = jest.fn(() => Promise.resolve({ type: 'verbunden', access: 'erteilt' } as const));
    const release = appHealthImport.opened({ connect } as unknown as HealthImport);

    expect(await health.apply('erstimport')).toEqual({ type: 'verbunden', access: 'erteilt' });
    expect(connect).toHaveBeenCalledTimes(1);
    release();
  });

  it('`zwei_weckungen` weckt zweimal den Import des geöffneten Kontos', async () => {
    const health = createTestHealth(clock);
    health.platform(unavailableHealthPlatform('apple_health'));
    const importNow = jest.fn(() => Promise.resolve());
    const connect = jest.fn(() => Promise.resolve({ type: 'verbunden', access: 'erteilt' } as const));
    const release = appHealthImport.opened({ connect, importNow } as unknown as HealthImport);

    await health.apply('zwei_weckungen');

    expect(importNow).toHaveBeenCalledTimes(2);
    release();
  });

  it('`geraet` stellt nach einem Szenario zurück auf die Plattform des Builds und verbindet sie (Gerätetest, #195)', async () => {
    const health = createTestHealth(clock);
    const device = { ...unavailableHealthPlatform('health_connect'), availability: () => Promise.resolve('installation_noetig' as const) };
    const platform = health.platform(device);
    const connect = jest.fn(() => Promise.resolve({ type: 'verbunden', access: 'erteilt' } as const));
    const release = appHealthImport.opened({ connect } as unknown as HealthImport);

    await health.apply('erstimport');
    expect(await platform.availability()).toBe('verfuegbar');

    expect(await health.apply('geraet')).toEqual({ type: 'verbunden', access: 'erteilt' });
    expect(await platform.availability()).toBe('installation_noetig');
    expect(connect).toHaveBeenCalledTimes(2);
    release();
  });

  it('ohne angeschlossene Plattform ist das Szenario ein Fehler', async () => {
    await expect(createTestHealth(clock).apply('erstimport')).rejects.toThrow('nicht angeschlossen');
  });
});
