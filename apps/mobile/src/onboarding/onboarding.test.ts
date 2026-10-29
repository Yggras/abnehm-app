/** @jest-environment node */
import { eq } from 'drizzle-orm';

import { createTestClock } from '@abnehm/clock/testing';
import { DisplayName, EntityId, Instant, TimeZone } from '@abnehm/contracts/base';

import { deviceState } from '../local-db/schema';
import { sqliteOf } from '../local-db/sqlite';
import { createOnboardingDevice, type OnboardingDevice } from './testing/harness';

// Onboarding-Modul (Spezifikation 1, Abschnitt 9) mit echtem Auth-Modul über dem Fake-Server, echten
// Kontodatenbanken und echter Sitzungs-Weiche: Schritt 2 registriert bzw. meldet an, die Einrichtung
// holt die Person, danach steht die Bestätigung aus Schritt 1 als `disclaimer_accepted_at` an der
// Person, und der Entwurf bleibt Gerätezustand.

const clock = createTestClock({ instant: Instant.parse('2026-10-14T12:00:00.000Z'), timeZone: TimeZone.parse('Europe/Berlin') });
const acceptedAt = Instant.parse('2026-10-14T11:58:00.000Z');
const anna = { email: 'anna@example.test', password: 'momo-insel-testpasswort', displayName: DisplayName.parse('Anna') };

let device: OnboardingDevice;
beforeEach(() => {
  device = createOnboardingDevice(clock);
});
afterEach(() => device.cleanup());

describe('Registrieren', () => {
  it('legt Konto und Person an, holt die Person und setzt danach die Bestätigung aus Schritt 1', async () => {
    const { onboarding, gate } = device;

    const registered = await onboarding.register({ ...anna, disclaimerAcceptedAt: acceptedAt });
    expect(registered).toEqual({ type: 'registered', accountId: expect.any(String), person: expect.objectContaining({ displayName: 'Anna' }) });
    expect(gate.get()).toBe('bootstrap_ausstehend');
    expect(onboarding.progress()).toEqual({ type: 'laedt' });

    expect(await onboarding.setUpAccount()).toEqual({ type: 'eingerichtet' });

    expect(gate.get()).toBe('onboarding');
    expect(device.ownPerson()).toEqual(expect.objectContaining({ displayName: 'Anna', disclaimerAcceptedAt: acceptedAt, onboardingStatus: 'begonnen' }));
    expect(onboarding.progress()).toEqual({ type: 'bereit', disclaimerAccepted: true });
    // Über den Person-Upsert aus #110: vollständige Nutzlast in der Outbox, ohne Zeitzone.
    expect(device.outbox()).toEqual([
      expect.objectContaining({ type: 'upsert_entity', entityType: 'person', payload: expect.objectContaining({ disclaimerAcceptedAt: acceptedAt }) }),
    ]);
  });

  it('wiederholt einen ausstehenden Bootstrap mit dem Anzeigenamen aus Schritt 2', async () => {
    const { onboarding, server } = device;
    server.setBootstrapAvailable(false);

    const registered = await onboarding.register({ ...anna, disclaimerAcceptedAt: acceptedAt });
    expect(registered).toEqual({ type: 'person_pending', accountId: expect.any(String) });
    expect(await onboarding.setUpAccount()).toEqual({ type: 'offline' });

    server.setBootstrapAvailable(true);
    expect(await onboarding.setUpAccount()).toEqual({ type: 'eingerichtet' });

    expect(server.person(registered.type === 'person_pending' ? registered.accountId : '')).toEqual(expect.objectContaining({ displayName: 'Anna' }));
    expect(device.ownPerson()?.disclaimerAcceptedAt).toBe(acceptedAt);
  });

  it('ohne Netz: meldet „offline“, ohne ein Konto anzulegen', async () => {
    device.faults.set({ transport: 'offline' });

    expect(await device.onboarding.register({ ...anna, disclaimerAcceptedAt: acceptedAt })).toEqual({ type: 'unreachable' });
    expect(device.session.auth.state()).toEqual({ type: 'unbekannt' });
    expect(device.server.calls()).toEqual([]);
  });

  it('reicht die Ablehnung des Auth-Moduls unverändert weiter', async () => {
    expect(await device.onboarding.register({ ...anna, password: 'zu-kurz', disclaimerAcceptedAt: acceptedAt })).toEqual({
      type: 'rejected',
      reason: 'password_too_short',
    });
  });
});

describe('Anmelden', () => {
  it('setzt die Bestätigung an einer Person, die noch keine hat', async () => {
    await device.addAccount(anna);

    expect(await device.onboarding.signIn({ email: anna.email, password: anna.password, disclaimerAcceptedAt: acceptedAt })).toEqual({
      type: 'signed_in',
      accountId: expect.any(String),
    });
    expect(await device.onboarding.setUpAccount()).toEqual({ type: 'eingerichtet' });

    expect(device.ownPerson()?.disclaimerAcceptedAt).toBe(acceptedAt);
  });

  it('lässt eine schon bestätigte Person unverändert', async () => {
    await device.addAccount(anna);
    await device.onboarding.signIn({ ...anna, disclaimerAcceptedAt: acceptedAt });
    await device.onboarding.setUpAccount();
    await device.session.revocations.forgetSession();
    const earlier = device.ownPerson;

    await device.onboarding.signIn({ ...anna, disclaimerAcceptedAt: Instant.parse('2026-10-14T13:00:00.000Z') });
    expect(await device.onboarding.setUpAccount()).toEqual({ type: 'eingerichtet' });

    expect(earlier()?.disclaimerAcceptedAt).toBe(acceptedAt);
    expect(device.outbox()).toHaveLength(1);
  });

  it('meldet eine falsche Anmeldung, ohne die Datenbank eines Kontos zu öffnen', async () => {
    await device.addAccount(anna);

    expect(await device.onboarding.signIn({ email: anna.email, password: 'falsch-falsch-falsch', disclaimerAcceptedAt: acceptedAt })).toEqual({
      type: 'invalid_credentials',
    });
    expect(device.ownPerson()).toBeUndefined();
  });
});

describe('Einrichtung ohne bekannten Anzeigenamen', () => {
  it('fragt nach dem Namen, wenn der Server keine Person kennt, und richtet das Konto damit ein', async () => {
    // Etwa nach einem Neustart zwischen Kontoanlage und Bootstrap: Das Konto existiert ohne Person.
    device.server.addAccount(anna);
    await device.session.auth.signIn(anna);

    expect(await device.onboarding.setUpAccount()).toEqual({ type: 'name_fehlt' });
    expect(await device.onboarding.setUpAccount({ displayName: DisplayName.parse('Anna B.') })).toEqual({ type: 'eingerichtet' });

    expect(device.ownPerson()).toEqual(expect.objectContaining({ displayName: 'Anna B.', disclaimerAcceptedAt: null }));
    expect(device.onboarding.progress()).toEqual({ type: 'bereit', disclaimerAccepted: false });
  });

  it('ohne Netz: „offline“ statt „Name fehlt“', async () => {
    device.server.addAccount(anna);
    await device.session.auth.signIn(anna);
    device.faults.set({ transport: 'offline' });

    expect(await device.onboarding.setUpAccount()).toEqual({ type: 'offline' });
  });
});

describe('Schritt 1 mit Konto', () => {
  it('setzt `disclaimer_accepted_at` auf jetzt, wenn die Person ihn noch nicht bestätigt hat', async () => {
    device.server.addAccount(anna);
    await device.session.auth.signIn(anna);
    await device.onboarding.setUpAccount({ displayName: anna.displayName });

    device.onboarding.acceptDisclaimer();

    expect(device.ownPerson()?.disclaimerAcceptedAt).toBe(clock.read().instant);
    expect(device.onboarding.progress()).toEqual({ type: 'bereit', disclaimerAccepted: true });
  });
});

describe('Onboarding-Entwurf', () => {
  async function registered() {
    await device.onboarding.register({ ...anna, disclaimerAcceptedAt: acceptedAt });
    await device.onboarding.setUpAccount();
  }

  it('legt Eingaben als Gerätezustand ab, ohne sie zu synchronisieren', async () => {
    await registered();
    const entryId = EntityId.parse('0c000000-0000-4000-8000-000000000001');
    const before = device.outbox();

    device.onboarding.updateDraft({ calculationSex: 'weiblich', heightCm: 168, weightG: 80_000, startWeightEntryId: entryId });
    const draft = device.onboarding.updateDraft({ activityLevel: 'wenig_aktiv', sportDays: ['dienstag', 'donnerstag', 'samstag'] });

    expect(draft).toEqual({
      calculationSex: 'weiblich', heightCm: 168, weightG: 80_000, startWeightEntryId: entryId,
      activityLevel: 'wenig_aktiv', sportDays: ['dienstag', 'donnerstag', 'samstag'],
    });
    expect(device.onboarding.readDraft()).toEqual(draft);
    expect(device.outbox()).toEqual(before);
  });

  it('löscht ein Feld mit `undefined` und lehnt ungültige Werte ab, ohne zu schreiben', async () => {
    await registered();
    device.onboarding.updateDraft({ heightCm: 168, pace: 'entspannt' });

    expect(() => device.onboarding.updateDraft({ heightCm: -1 })).toThrow();
    expect(device.onboarding.updateDraft({ pace: undefined })).toEqual({ heightCm: 168 });
  });

  it('bleibt beim erneuten Öffnen der Kontodatenbank erhalten und gehört nur ihrem Konto', async () => {
    await registered();
    device.onboarding.updateDraft({ heightCm: 168 });
    await device.session.revocations.forgetSession();

    device.server.addAccount({ email: 'philipp@example.test', password: anna.password });
    await device.session.auth.signIn({ email: 'philipp@example.test', password: anna.password });
    await device.onboarding.setUpAccount({ displayName: DisplayName.parse('Philipp') });
    expect(device.onboarding.readDraft()).toEqual({});
    await device.session.revocations.forgetSession();

    await device.session.auth.signIn(anna);
    expect(device.onboarding.readDraft()).toEqual({ heightCm: 168 });
  });

  it('ein nicht mehr passender gespeicherter Entwurf gilt als leer', async () => {
    await registered();
    device.onboarding.updateDraft({ heightCm: 168 });
    device.session.databases.current()!.transaction((tx) =>
      sqliteOf(tx).update(deviceState).set({ value: { heightCm: 'groß' } }).where(eq(deviceState.key, 'onboarding_draft')).run(),
    );

    expect(device.onboarding.readDraft()).toEqual({});
  });

  it('ohne geöffnete Kontodatenbank ist der Entwurf ein Aufruffehler', () => {
    expect(() => device.onboarding.readDraft()).toThrow('Onboarding ohne geöffnete Kontodatenbank');
  });
});
