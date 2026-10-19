import { createFaultController } from './faults';
import { createTestInbox } from './inbox';
import { parseTestLink } from './links';
import type { SeedOutcome, SeedRun } from './seed/seed-flow';

// Nachweis für #112: Deep Links der Testfähigkeiten und ihr Eingang.

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

  it('lässt alle anderen Links unverändert', () => {
    for (const link of ['abnehmapp-dev://capture/water', '/', '/settings/goals', 'abnehmapp-dev://seedling']) expect(parseTestLink(link)).toBeNull();
  });
});

describe('Eingang der Testfähigkeiten', () => {
  const run: SeedRun = { scenario: 'solo', installation: null, target: { type: 'today' } };
  const done: SeedOutcome = { type: 'geseedet', scenario: 'solo', installation: 'philipp-iphone', target: { type: 'today' } };

  it('stellt Fehler-Adapter sofort und setzt sie mit einem leeren Link zurück', () => {
    const faults = createFaultController();
    const inbox = createTestInbox(faults);
    inbox.receive({ type: 'fehler', plan: { server: 'unavailable' } });
    expect(faults.plan().server).toBe('unavailable');
    expect(inbox.status()).toEqual({ type: 'fehler_gestellt', plan: faults.plan() });
    inbox.receive({ type: 'fehler', plan: {} });
    expect(faults.plan()).toEqual({ transport: 'ok', server: 'ok', auth: 'ok', storage: 'ok' });
  });

  it('hält einen Seed vom Kaltstart zurück, bis die App-Shell ihn ausführt, und führt ihn genau einmal aus', async () => {
    const inbox = createTestInbox(createFaultController());
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
    const inbox = createTestInbox(createFaultController());
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
