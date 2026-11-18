import { createFakeNotificationPort, type FakeNotificationPort } from '../test-capabilities/notifications';
import { createNotifications } from './notifications';
import type { NotificationPort } from './port';

// Mitteilungen der App (#125; Spezifikation 5, Abschnitt 8) über den Fake-Mitteilungs-Port: Kanäle vor
// jeder Erlaubnisanfrage, Vordergrund ohne Banner, beobachtbare Erlaubnis und Fehler des Ports.

const flush = () => new Promise((resolve) => setImmediate(resolve));

function start(port: NotificationPort = createFakeNotificationPort()) {
  const errors: unknown[] = [];
  const received: unknown[] = [];
  const notifications = createNotifications({ port, onError: (error) => errors.push(error), onForegroundNotification: (n) => received.push(n) });
  return { notifications, errors, received };
}

test('legt beim Start beide Android-Kanäle mit ihren Namen an, vor jeder Erlaubnisanfrage', async () => {
  const port = createFakeNotificationPort();
  const { notifications } = start(port);
  await notifications.request();

  expect(port.channels()).toEqual([
    { key: 'checkins', name: 'Tages-Check-ins' },
    { key: 'partner_momo', name: 'Partner & Momo' },
  ]);
  expect(port.calls().indexOf('createChannels')).toBeLessThan(port.calls().indexOf('requestPermission'));
});

test('eine sofortige Anfrage wartet, bis die Kanäle angelegt sind (Android 13 fragt sonst nicht)', async () => {
  const fake = createFakeNotificationPort();
  let channelsDone: () => void = () => {};
  const port: NotificationPort = {
    ...fake,
    createChannels: (channels) => new Promise<void>((resolve) => {
      channelsDone = () => void fake.createChannels(channels).then(resolve);
    }),
  };
  const { notifications } = start(port);

  const answer = notifications.request();
  await flush();
  expect(fake.systemDialogs()).toBe(0);

  channelsDone();
  expect(await answer).toBe('granted');
  expect(fake.systemDialogs()).toBe(1);
});

test('scheitert das Anlegen der Kanäle, fragt die App trotzdem und meldet den Fehler', async () => {
  const port = createFakeNotificationPort();
  port.fail('createChannels');
  const { notifications, errors } = start(port);

  expect(await notifications.request()).toBe('granted');
  expect(errors).toHaveLength(1);
});

test('bei offener App erscheint keine Benachrichtigung als Banner; die App erfährt davon', () => {
  const port = createFakeNotificationPort();
  const { received } = start(port);

  expect(port.receive({ notificationId: 'checkin:2026-10-14:abend', data: {} })).toEqual({ banner: false });
  expect(received).toEqual([{ notificationId: 'checkin:2026-10-14:abend', data: {} }]);
});

describe('Erlaubnis', () => {
  let port: FakeNotificationPort;
  beforeEach(() => {
    port = createFakeNotificationPort({ permission: 'undetermined' });
  });

  test('ist bis zum Lesen `null` und danach beobachtbar', async () => {
    const { notifications } = start(port);
    expect(notifications.permission()).toBeNull();
    await flush();
    expect(notifications.permission()).toBe('undetermined');
  });

  test.each([
    ['granted', 'granted'],
    ['denied', 'denied'],
  ] as const)('die Antwort im Systemdialog (%s) wird zur Erlaubnis und meldet sich', async (answer, expected) => {
    port.answerWith(answer);
    const { notifications } = start(port);
    const listener = jest.fn();
    notifications.subscribe(listener);

    expect(await notifications.request()).toBe(expected);
    expect(notifications.permission()).toBe(expected);
    expect(listener).toHaveBeenCalled();
    expect(port.systemDialogs()).toBe(1);
  });

  test('eine entschiedene Erlaubnis fragt das System nicht erneut', async () => {
    port.setPermission('denied');
    const { notifications } = start(port);
    expect(await notifications.request()).toBe('denied');
    expect(port.systemDialogs()).toBe(0);
  });

  test('scheitert die Anfrage, liefert sie `null`, der gelesene Stand bleibt und der Fehler geht an onError', async () => {
    port.fail('requestPermission');
    const { notifications, errors } = start(port);

    expect(await notifications.request()).toBeNull();
    expect(notifications.permission()).toBe('undetermined');
    expect(errors).toHaveLength(1);
  });

  test('`refresh` übernimmt eine Änderung aus den System-Einstellungen', async () => {
    port.setPermission('denied');
    const { notifications } = start(port);
    await flush();

    port.setPermission('granted');
    await notifications.refresh();
    expect(notifications.permission()).toBe('granted');
  });

  test('scheitert das Lesen, bleibt die Erlaubnis unbekannt und der Fehler geht an onError', async () => {
    port.fail('permission');
    const { notifications, errors } = start(port);
    await flush();
    expect(notifications.permission()).toBeNull();
    expect(errors).toHaveLength(1);
  });

  test('„In den Systemeinstellungen erlauben“ öffnet die App-Einstellungen; ein Fehler geht an onError', async () => {
    const { notifications, errors } = start(port);
    await notifications.openSettings();
    expect(port.settingsOpened()).toBe(1);

    port.fail('openSettings');
    await notifications.openSettings();
    expect(errors).toHaveLength(1);
  });
});
