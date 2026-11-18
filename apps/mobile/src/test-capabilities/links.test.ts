import { Instant, TimeZone } from '@abnehm/contracts/base';

import { deviceClock } from '../clock/device-clock';
import { createAppTestClock } from './clock';
import type { DeviceSuitePhase, DeviceSuiteReport } from './device-suite/suite';
import { createFaultController } from './faults';
import { createTestInbox, type TestInboxOptions } from './inbox';
import { parseTestLink } from './links';
import { createNotificationTestControl } from './notifications';
import type { SeedOutcome, SeedRun } from './seed/seed-flow';

// Nachweis für #112 und #114: Deep Links der Testfähigkeiten und ihr Eingang.

const passed = (phase: DeviceSuitePhase): DeviceSuiteReport => ({ phase, results: [{ key: 'rollback', title: 'Transaktionsrollback samt Outbox', error: null }] });

function inboxWith(options: Partial<TestInboxOptions> = {}) {
  return createTestInbox({
    faults: createFaultController(),
    clock: createAppTestClock(deviceClock),
    notifications: createNotificationTestControl(),
    deviceSuite: async (phase) => passed(phase),
    health: { apply: () => Promise.resolve(null) },
    ...options,
  });
}

describe('Link `momo-galerie` (#187)', () => {
  it('öffnet die Galerie in der Ansicht „Heute“ oder „Insel“; andere Ansichten sind ungültig', () => {
    expect(parseTestLink('abnehmapp-dev://momo-galerie')).toEqual({ type: 'momo-galerie', view: 'heute' });
    expect(parseTestLink('abnehmapp-e2e://momo-galerie?ansicht=insel')).toEqual({ type: 'momo-galerie', view: 'insel' });
    expect(parseTestLink('abnehmapp-dev://momo-galerie?ansicht=schrank')).toEqual({ type: 'ungueltig', capability: 'momo-galerie' });
  });

  it('der Eingang meldet die geöffnete Ansicht', () => {
    const inbox = inboxWith();
    inbox.receive(parseTestLink('abnehmapp-dev://momo-galerie?ansicht=insel')!);
    expect(inbox.status()).toEqual({ type: 'momo_galerie', view: 'insel' });
  });
});

describe('Link `health` (#183)', () => {
  it('nennt ein Szenario der Health-Attrappe; unbekannte Szenarien und fehlende Parameter sind ungültig', () => {
    expect(parseTestLink('abnehmapp-dev://health?szenario=erstimport')).toEqual({ type: 'health', scenario: 'erstimport' });
    expect(parseTestLink('abnehmapp-e2e://health?szenario=token_verfallen')).toEqual({ type: 'health', scenario: 'token_verfallen' });
    expect(parseTestLink('abnehmapp-dev://health?szenario=zufall')).toEqual({ type: 'ungueltig', capability: 'health' });
    expect(parseTestLink('abnehmapp-dev://health')).toEqual({ type: 'ungueltig', capability: 'health' });
  });

  it('der Eingang stellt das Szenario und meldet das Ergebnis des Verbindens', async () => {
    const applied: string[] = [];
    const inbox = inboxWith({
      health: {
        apply: (scenario) => {
          applied.push(scenario);
          return Promise.resolve(scenario === 'nicht_verfuegbar' ? { type: 'nicht_verfuegbar' } : { type: 'verbunden', access: 'erteilt' });
        },
      },
    });

    inbox.receive(parseTestLink('abnehmapp-dev://health?szenario=erstimport')!);
    await new Promise((resolve) => setImmediate(resolve));
    expect(inbox.status()).toEqual({ type: 'health_gestellt', scenario: 'erstimport', outcome: 'verbunden' });

    inbox.receive(parseTestLink('abnehmapp-dev://health?szenario=nicht_verfuegbar')!);
    await new Promise((resolve) => setImmediate(resolve));
    expect(inbox.status()).toEqual({ type: 'health_gestellt', scenario: 'nicht_verfuegbar', outcome: 'nicht_verfuegbar' });
    expect(applied).toEqual(['erstimport', 'nicht_verfuegbar']);
  });

  it('ohne geöffnetes Konto und bei einem Fehler meldet er das ebenfalls', async () => {
    const inbox = inboxWith({ health: { apply: () => Promise.resolve(null) } });
    inbox.receive(parseTestLink('abnehmapp-dev://health?szenario=keine_daten')!);
    await new Promise((resolve) => setImmediate(resolve));
    expect(inbox.status()).toEqual({ type: 'health_gestellt', scenario: 'keine_daten', outcome: 'ohne_konto' });

    const failing = inboxWith({ health: { apply: () => Promise.reject(new Error('kaputt')) } });
    failing.receive(parseTestLink('abnehmapp-dev://health?szenario=keine_daten')!);
    await new Promise((resolve) => setImmediate(resolve));
    expect(failing.status()).toEqual({ type: 'health_gestellt', scenario: 'keine_daten', outcome: 'fehlgeschlagen' });
  });
});

describe('Deep Links der Testfähigkeiten', () => {
  it('Seed-Link mit Szenario, optionaler Installation und Ziel', () => {
    expect(parseTestLink('abnehmapp-dev://seed?szenario=solo')).toEqual({ type: 'seed', scenario: 'solo', installation: null, target: { type: 'today' } });
    expect(parseTestLink('abnehmapp-dev://seed?szenario=solo&installation=philipp-iphone&ziel=%2Fcapture%2Fwater')).toEqual({
      type: 'seed',
      scenario: 'solo',
      installation: 'philipp-iphone',
      target: { type: 'capture.water' },
    });
    // Expo Router reicht Links auch als Pfad weiter.
    expect(parseTestLink('/seed?szenario=solo')).toEqual(expect.objectContaining({ type: 'seed', scenario: 'solo' }));
  });

  it('unbekannte Szenarien und Ziele', () => {
    expect(parseTestLink('abnehmapp-dev://seed?szenario=gibtsnicht')).toEqual({ type: 'ungueltig', capability: 'seed' });
    expect(parseTestLink('abnehmapp-dev://seed')).toEqual({ type: 'ungueltig', capability: 'seed' });
    expect(parseTestLink('abnehmapp-dev://seed?szenario=solo&ziel=/gibtsnicht')).toEqual(expect.objectContaining({ target: { type: 'today' } }));
  });

  it('Fehler-Link stellt einzelne Adapter; unbekannte Werte sind ungültig', () => {
    expect(parseTestLink('abnehmapp-dev://fehler?transport=offline&auth=session_rejected')).toEqual({
      type: 'fehler',
      plan: { transport: 'offline', auth: 'session_rejected' },
    });
    expect(parseTestLink('abnehmapp-dev://fehler')).toEqual({ type: 'fehler', plan: {} });
    expect(parseTestLink('abnehmapp-dev://fehler?transport=zufall')).toEqual({ type: 'ungueltig', capability: 'fehler' });
  });

  it('Uhr-Link stellt Stunden vor und/oder eine neue Zone (#114)', () => {
    expect(parseTestLink('abnehmapp-e2e://uhr?stunden=25&zone=Pacific%2FKiritimati')).toEqual({
      type: 'uhr',
      adjustment: { advanceHours: 25, timeZone: 'Pacific/Kiritimati' },
    });
    expect(parseTestLink('abnehmapp-e2e://uhr?zone=Europe/Lisbon')).toEqual({ type: 'uhr', adjustment: { timeZone: 'Europe/Lisbon' } });
    for (const link of ['abnehmapp-e2e://uhr', 'abnehmapp-e2e://uhr?stunden=-1', 'abnehmapp-e2e://uhr?stunden=1.5', 'abnehmapp-e2e://uhr?zone=Mars/Olympus']) {
      expect(parseTestLink(link)).toEqual({ type: 'ungueltig', capability: 'uhr' });
    }
  });

  it('Gerätetest-Link nennt die Phase der On-Device-Suite (#114)', () => {
    expect(parseTestLink('abnehmapp-e2e://geraetetest?phase=vor_neustart')).toEqual({ type: 'geraetetest', phase: 'vor_neustart' });
    expect(parseTestLink('abnehmapp-e2e://geraetetest?phase=nach_neustart')).toEqual({ type: 'geraetetest', phase: 'nach_neustart' });
    expect(parseTestLink('abnehmapp-e2e://geraetetest')).toEqual({ type: 'ungueltig', capability: 'geraetetest' });
  });

  it('lässt alle anderen Links unverändert', () => {
    for (const link of ['abnehmapp-dev://capture/water', '/', '/settings/goals', 'abnehmapp-dev://seedling', 'abnehmapp-e2e://uhrzeit']) expect(parseTestLink(link)).toBeNull();
  });
});

describe('Eingang der Testfähigkeiten', () => {
  const run: SeedRun = { scenario: 'solo', installation: null, target: { type: 'today' } };
  const done: SeedOutcome = { type: 'geseedet', scenario: 'solo', installation: 'philipp-iphone', target: { type: 'today' } };

  it('stellt Fehler-Adapter sofort und setzt sie mit einem leeren Link zurück', () => {
    const faults = createFaultController();
    const inbox = inboxWith({ faults });
    inbox.receive({ type: 'fehler', plan: { server: 'unavailable' } });
    expect(faults.plan().server).toBe('unavailable');
    expect(inbox.status()).toEqual({ type: 'fehler_gestellt', plan: faults.plan() });
    inbox.receive({ type: 'fehler', plan: {} });
    expect(faults.plan()).toEqual({ transport: 'ok', server: 'ok', auth: 'ok', storage: 'ok' });
  });

  it('stellt die Testuhr und meldet die neue Ablesung', () => {
    const clock = createAppTestClock(deviceClock);
    clock.fix({ instant: Instant.parse('2026-10-14T12:00:00.000Z'), timeZone: TimeZone.parse('Europe/Berlin') });
    const inbox = inboxWith({ clock });
    inbox.receive({ type: 'uhr', adjustment: { advanceHours: 25, timeZone: TimeZone.parse('Pacific/Kiritimati') } });
    expect(inbox.status()).toEqual({ type: 'uhr_gestellt', reading: { instant: '2026-10-15T13:00:00.000Z', timeZone: 'Pacific/Kiritimati', localDate: '2026-10-16', utcOffsetMinutes: 840 } });
  });

  it('führt die On-Device-Suite je Link genau einmal und nacheinander aus', async () => {
    const phases: DeviceSuitePhase[] = [];
    let finish: () => void = () => {};
    const inbox = inboxWith({
      deviceSuite: async (phase) => {
        phases.push(phase);
        if (phase === 'vor_neustart') await new Promise<void>((resolve) => (finish = resolve));
        return passed(phase);
      },
    });
    inbox.receive({ type: 'geraetetest', phase: 'vor_neustart' });
    inbox.receive({ type: 'geraetetest', phase: 'nach_neustart' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(inbox.status()).toEqual({ type: 'geraetetest_laeuft', phase: 'vor_neustart' });
    expect(phases).toEqual(['vor_neustart']);
    finish();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(phases).toEqual(['vor_neustart', 'nach_neustart']);
    expect(inbox.status()).toEqual({ type: 'geraetetest_fertig', report: passed('nach_neustart') });
  });

  it('hält einen Seed vom Kaltstart zurück, bis die App-Shell ihn ausführt, und führt ihn genau einmal aus', async () => {
    const inbox = inboxWith();
    inbox.receive({ type: 'seed', ...run });
    expect(inbox.status()).toEqual({ type: 'ruhe' });
    const handler = jest.fn(async () => done);
    inbox.handleSeeds(handler);
    expect(inbox.status()).toEqual({ type: 'seed_laeuft', run });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(handler).toHaveBeenCalledTimes(1);
    expect(inbox.status()).toEqual({ type: 'seed_fertig', outcome: done });
  });

  it('meldet Fehlschläge und unerwartete Ausnahmen', async () => {
    const inbox = inboxWith();
    const results: SeedOutcome[] = [{ type: 'fehlgeschlagen', step: 'backend' }];
    inbox.handleSeeds(async () => {
      const next = results.shift();
      if (next === undefined) throw new Error('kaputt');
      return next;
    });
    inbox.receive({ type: 'seed', ...run });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(inbox.status()).toEqual({ type: 'seed_fehlgeschlagen', step: 'backend' });
    inbox.receive({ type: 'seed', ...run });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(inbox.status()).toEqual({ type: 'seed_fehlgeschlagen', step: 'unerwartet' });
  });
});
