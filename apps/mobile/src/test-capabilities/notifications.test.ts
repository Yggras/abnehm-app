import { Instant } from '@abnehm/contracts/base';

import { deviceClock } from '../clock/device-clock';
import { createAppTestClock } from './clock';
import { createFaultController } from './faults';
import { createTestInbox } from './inbox';
import { parseTestLink } from './links';
import { createFakeNotificationPort, createNotificationTestControl, FakeNotificationError, type NotificationOperation } from './notifications';

// Nachweis für #125: Fake-Mitteilungs-Port mit steuerbarer Erlaubnis und steuerbaren Fehlern, sein
// Umschalter in Test-Artefakten und der Deep Link `mitteilungen`.

describe('Fake-Mitteilungs-Port', () => {
  const operations: [NotificationOperation, () => Promise<unknown>][] = [];
  const port = createFakeNotificationPort();
  operations.push(
    ['permission', () => port.permission()],
    ['requestPermission', () => port.requestPermission()],
    ['openSettings', () => port.openSettings()],
    ['createChannels', () => port.createChannels([])],
    ['schedule', () => port.schedule({ id: 'a', at: Instant.parse('2026-10-14T17:00:00.000Z'), channel: 'checkins', title: 't', body: 'b', data: {} })],
    ['cancel', () => port.cancel('a')],
    ['scheduled', () => port.scheduled()],
    ['expoPushToken', () => port.expoPushToken()],
    ['lastResponse', () => port.lastResponse()],
  );

  test.each(operations)('Fehler sind je Operation steuerbar: %s', async (operation, run) => {
    port.fail(operation);
    await expect(run()).rejects.toBeInstanceOf(FakeNotificationError);
    port.heal(operation);
    await expect(run()).resolves.not.toBeInstanceOf(Error);
  });

  test('steuerbare Erlaubnis: der Systemdialog erscheint nur, solange nichts entschieden ist', async () => {
    const fake = createFakeNotificationPort({ permission: 'undetermined', answer: 'denied' });
    expect(await fake.requestPermission()).toBe('denied');
    expect(await fake.requestPermission()).toBe('denied');
    expect(fake.systemDialogs()).toBe(1);

    fake.setPermission('undetermined');
    fake.answerWith('granted');
    expect(await fake.requestPermission()).toBe('granted');
    expect(fake.systemDialogs()).toBe(2);
  });

  test('plant, listet und bricht lokale Benachrichtigungen ab', async () => {
    const fake = createFakeNotificationPort();
    const at = Instant.parse('2026-10-14T17:00:00.000Z');
    await fake.schedule({ id: 'checkin:2026-10-14:abend', at, channel: 'checkins', title: 'Momo fragt nach', body: 'b', data: { ziel: 'today' } });
    await fake.schedule({ id: 'checkin:2026-10-15:abend', at, channel: 'checkins', title: 'Momo fragt nach', body: 'b', data: {} });
    await fake.cancel('checkin:2026-10-14:abend');
    expect(await fake.scheduled()).toEqual([{ id: 'checkin:2026-10-15:abend', data: {} }]);
  });

  test('Antippen: Listener bei laufender App, letzte Antwort beim Kaltstart', async () => {
    const fake = createFakeNotificationPort();
    const listener = jest.fn();
    const stop = fake.onResponse(listener);
    fake.respond({ notificationId: 'push-1', data: { intentId: 'i' } });
    expect(listener).toHaveBeenCalledWith({ notificationId: 'push-1', data: { intentId: 'i' } });

    stop();
    fake.respond({ notificationId: 'push-2', data: {} }, { launch: true });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(await fake.lastResponse()).toEqual({ notificationId: 'push-2', data: {} });
  });

  test('ohne festgelegtes Vordergrundverhalten erschiene ein Banner', () => {
    expect(createFakeNotificationPort().receive({ notificationId: 'x', data: {} })).toEqual({ banner: true });
  });
});

describe('Umschalter in Test-Artefakten', () => {
  test('spricht mit dem echten Port, bis er auf den Fake gestellt wird, und meldet jedes Umschalten', async () => {
    const system = createFakeNotificationPort({ permission: 'granted' });
    const control = createNotificationTestControl();
    const port = control.port(system);
    const changed = jest.fn();
    control.subscribe(changed);
    expect(await port.permission()).toBe('granted');

    control.simulate('undetermined', 'denied');
    expect(control.mode()).toEqual({ type: 'fake', permission: 'undetermined', answer: 'denied' });
    expect(await port.permission()).toBe('undetermined');
    expect(await port.requestPermission()).toBe('denied');
    expect(system.systemDialogs()).toBe(0);

    control.simulate(null);
    expect(control.mode()).toEqual({ type: 'system' });
    expect(await port.permission()).toBe('granted');
    expect(changed).toHaveBeenCalledTimes(2);
  });

  test('Kanäle und Vordergrundverhalten gelten immer auch für den echten Port', async () => {
    const system = createFakeNotificationPort();
    const control = createNotificationTestControl();
    const port = control.port(system);
    control.simulate('denied');
    await port.createChannels([{ key: 'checkins', name: 'Tages-Check-ins' }]);
    port.setForegroundBehavior(() => {});
    expect(system.channels()).toEqual([{ key: 'checkins', name: 'Tages-Check-ins' }]);
    expect(system.receive({ notificationId: 'x', data: {} })).toEqual({ banner: false });
  });
});

describe('Deep Link `mitteilungen`', () => {
  test.each([
    ['abnehmapp-dev://mitteilungen?erlaubnis=unentschieden', { type: 'mitteilungen', permission: 'undetermined', answer: 'granted' }],
    ['abnehmapp-e2e://mitteilungen?erlaubnis=unentschieden&antwort=verweigert', { type: 'mitteilungen', permission: 'undetermined', answer: 'denied' }],
    ['abnehmapp-dev://mitteilungen?erlaubnis=erlaubt', { type: 'mitteilungen', permission: 'granted', answer: 'granted' }],
    ['abnehmapp-dev://mitteilungen?erlaubnis=verweigert', { type: 'mitteilungen', permission: 'denied', answer: 'granted' }],
    ['abnehmapp-dev://mitteilungen?erlaubnis=system', { type: 'mitteilungen', permission: null, answer: 'granted' }],
    ['abnehmapp-dev://mitteilungen', { type: 'ungueltig', capability: 'mitteilungen' }],
    ['abnehmapp-dev://mitteilungen?erlaubnis=vorlaeufig', { type: 'ungueltig', capability: 'mitteilungen' }],
  ])('%s', (link, expected) => {
    expect(parseTestLink(link)).toEqual(expected);
  });

  test('der Eingang stellt den Port sofort um und meldet den Stand', async () => {
    const notifications = createNotificationTestControl();
    const port = notifications.port(createFakeNotificationPort({ permission: 'granted' }));
    const inbox = createTestInbox({ faults: createFaultController(), clock: createAppTestClock(deviceClock), notifications, deviceSuite: () => Promise.reject(new Error('nicht im Test')), health: { apply: () => Promise.resolve(null) } });

    inbox.receive(parseTestLink('abnehmapp-dev://mitteilungen?erlaubnis=verweigert')!);

    expect(inbox.status()).toEqual({ type: 'mitteilungen_gestellt', mode: { type: 'fake', permission: 'denied', answer: 'granted' } });
    expect(await port.permission()).toBe('denied');
  });
});
