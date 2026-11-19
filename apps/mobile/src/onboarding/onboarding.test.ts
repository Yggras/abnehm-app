/** @jest-environment node */
import { eq } from 'drizzle-orm';

import { createTestClock } from '@abnehm/clock/testing';
import { DisplayName, EntityId, Instant, LocalDate, TimeZone } from '@abnehm/contracts/base';

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

describe('Schritt 3 „Körperdaten“', () => {
  // Heute ist laut Testuhr der 14.10.2026 in Europe/Berlin.
  const body = { calculationSex: 'weiblich', birthDate: LocalDate.parse('1991-04-02'), heightCm: 168, weightG: 80_000 } as const;

  async function registered() {
    await device.onboarding.register({ ...anna, disclaimerAcceptedAt: acceptedAt });
    await device.onboarding.setUpAccount();
  }

  it('bestätigt vollständige Körperdaten und legt die `entryId` des Startgewichts genau einmal im Entwurf ab', async () => {
    await registered();
    const before = device.outbox();
    device.onboarding.updateDraft(body);

    expect(device.onboarding.confirmBodyData()).toEqual({ type: 'bestaetigt' });
    const { startWeightEntryId } = device.onboarding.readDraft();
    expect(startWeightEntryId).toEqual(expect.any(String));

    device.onboarding.updateDraft({ weightG: 79_500 });
    expect(device.onboarding.confirmBodyData()).toEqual({ type: 'bestaetigt' });
    expect(device.onboarding.readDraft()).toEqual({ ...body, weightG: 79_500, startWeightEntryId });
    expect(device.outbox()).toEqual(before);
  });

  it('sperrt unter 18: der 18. Geburtstag heute gilt als volljährig, morgen noch nicht', async () => {
    await registered();

    device.onboarding.updateDraft({ ...body, birthDate: LocalDate.parse('2008-10-15') });
    expect(device.onboarding.confirmBodyData()).toEqual({ type: 'minderjaehrig' });
    expect(device.onboarding.readDraft().startWeightEntryId).toBeUndefined();

    device.onboarding.updateDraft({ birthDate: LocalDate.parse('2008-10-14') });
    expect(device.onboarding.confirmBodyData()).toEqual({ type: 'bestaetigt' });
  });

  it('meldet fehlende Angaben und die Grenzen des Zielrechners, ohne eine `entryId` zu erzeugen', async () => {
    await registered();

    expect(device.onboarding.confirmBodyData()).toEqual({
      type: 'ungueltig',
      errors: ['calculation_sex_missing', 'birth_date_missing', 'height_missing', 'weight_missing'],
    });
    device.onboarding.updateDraft({ ...body, heightCm: 119, weightG: 300_100 });
    expect(device.onboarding.confirmBodyData()).toEqual({ type: 'ungueltig', errors: ['height_out_of_range', 'weight_out_of_range'] });
    expect(device.onboarding.readDraft().startWeightEntryId).toBeUndefined();
    device.onboarding.updateDraft({ heightCm: 120, weightG: 300_000 });
    expect(device.onboarding.confirmBodyData()).toEqual({ type: 'bestaetigt' });
  });

  it('die Sperre unter 18 geht vor fehlenden Angaben', async () => {
    await registered();
    device.onboarding.updateDraft({ birthDate: LocalDate.parse('2012-01-01') });

    expect(device.onboarding.confirmBodyData()).toEqual({ type: 'minderjaehrig' });
  });
});

describe('Schritte 5–7: eigenes Budget im Entwurf', () => {
  const answered = {
    calculationSex: 'weiblich', birthDate: LocalDate.parse('1991-04-02'), heightCm: 168, weightG: 80_000,
    pregnantOrBreastfeeding: false, knownEatingDisorder: false,
  } as const;

  async function registered() {
    await device.onboarding.register({ ...anna, disclaimerAcceptedAt: acceptedAt });
    await device.onboarding.setUpAccount();
  }

  it('bleibt erhalten, solange es im erlaubten Bereich liegt, auch nach einer anderen Aktivitätsstufe', async () => {
    await registered();
    device.onboarding.updateDraft({ ...answered, activityLevel: 'wenig_aktiv', manualBudgetKcal: 1_700 });

    device.onboarding.updateDraft({ waterTargetMl: 2_000, weeklySportTargetMinutes: 160 });
    device.onboarding.updateDraft({ goalWeightG: 75_000, pace: 'zuegiger' });
    // mäßig aktiv: erlaubt sind 1.520 bis 2.420 kcal.
    device.onboarding.updateDraft({ activityLevel: 'maessig_aktiv' });

    expect(device.onboarding.readDraft()).toEqual(expect.objectContaining({ manualBudgetKcal: 1_700, waterTargetMl: 2_000 }));
  });

  it('entfällt außerhalb des neuen Bereichs; Wasser und Sport bleiben', async () => {
    await registered();
    // aktiv: erlaubt sind 1.520 bis 2.720 kcal, wenig aktiv nur bis 2.120 kcal.
    device.onboarding.updateDraft({ ...answered, activityLevel: 'aktiv', manualBudgetKcal: 2_500, waterTargetMl: 2_000 });

    const draft = device.onboarding.updateDraft({ activityLevel: 'wenig_aktiv' });

    expect(draft.manualBudgetKcal).toBeUndefined();
    expect(draft).toEqual(expect.objectContaining({ activityLevel: 'wenig_aktiv', waterTargetMl: 2_000 }));
    expect(device.onboarding.readDraft()).toEqual(draft);
  });

  it('entfällt im erzwungenen Haltemodus', async () => {
    await registered();
    device.onboarding.updateDraft({ ...answered, manualBudgetKcal: 1_700 });

    expect(device.onboarding.updateDraft({ knownEatingDisorder: true }).manualBudgetKcal).toBeUndefined();
  });
});

describe('Schritt 8 „Wochenplan“: Plan speichern', () => {
  // Heute ist laut Testuhr Mittwoch, 14.10.2026, in Europe/Berlin.
  const today = LocalDate.parse('2026-10-14');
  const answered = {
    calculationSex: 'weiblich', birthDate: LocalDate.parse('1991-04-02'), heightCm: 168, weightG: 80_000,
    pregnantOrBreastfeeding: false, knownEatingDisorder: false, activityLevel: 'wenig_aktiv', goalWeightG: 76_000, pace: 'entspannt',
    waterTargetMl: 1_500, weeklySportTargetMinutes: 150,
  } as const;

  /** Registriert, füllt die Schritte 3–7 und bestätigt die Körperdaten wie „Weiter“ in Schritt 3. */
  async function throughStepSeven() {
    await device.onboarding.register({ ...anna, disclaimerAcceptedAt: acceptedAt });
    await device.onboarding.setUpAccount();
    device.onboarding.updateDraft(answered);
    expect(device.onboarding.confirmBodyData()).toEqual({ type: 'bestaetigt' });
    return device.onboarding.readDraft().startWeightEntryId!;
  }

  it('speichert mit der Vorauswahl Di/Do/Sa und Montag: Startgewicht, Personenfelder und heute drei Tagesziele', async () => {
    const entryId = await throughStepSeven();

    expect(await device.onboarding.savePlan()).toEqual({ type: 'gespeichert' });

    expect(device.startWeights()).toEqual([{ entryId, personId: device.ownPerson()!.id, weightG: 80_000, measuredAt: clock.read().instant }]);
    expect(device.ownPerson()).toEqual(
      expect.objectContaining({ calculationSex: 'weiblich', heightCm: 168, activityLevel: 'wenig_aktiv', onboardingStatus: 'begonnen' }),
    );
    // Mittwoch ist weder Sport- noch Wiegetag.
    expect(device.dailyGoalsOn(today).map(({ baustein }) => baustein)).toEqual(['ernaehrung_erfasst', 'wasserziel', 'im_kalorienbudget']);
  });

  it('übernimmt Sporttage und Wiegetag aus dem Entwurf; die Sporteinheit trägt die Mindestdauer', async () => {
    await throughStepSeven();
    device.onboarding.updateDraft({ sportDays: ['mittwoch', 'freitag'], weighDay: 'sonntag' });

    expect(await device.onboarding.savePlan()).toEqual({ type: 'gespeichert' });

    // 150 Minuten ÷ 2 Sporttage.
    expect(device.dailyGoalsOn(today)[2]).toEqual(
      expect.objectContaining({ baustein: 'sporteinheit', snapshot: expect.objectContaining({ minimumSingleSessionMinutes: 75 }) }),
    );
  });

  it('zweimal speichern, etwa nach „Zurück“: genau ein Startgewicht und heute genau drei Tagesziele', async () => {
    await throughStepSeven();
    expect(await device.onboarding.savePlan()).toEqual({ type: 'gespeichert' });

    expect(device.onboarding.hasPlanToday()).toBe(true);
    device.onboarding.updateDraft({ sportDays: ['mittwoch'] });
    expect(await device.onboarding.savePlan()).toEqual({ type: 'gespeichert' });

    expect(device.startWeights()).toHaveLength(1);
    // Die heutigen Tagesziele behalten die Werte des ersten Speicherns; der geänderte Wochenplan gilt ab
    // morgen (Entscheidung in #134).
    expect(device.dailyGoalsOn(today).map(({ baustein }) => baustein)).toEqual(['ernaehrung_erfasst', 'wasserziel', 'im_kalorienbudget']);
    expect(device.weeklyPlanVersions()).toEqual([today, LocalDate.parse('2026-10-15')]);
  });

  it('vor dem ersten Speichern gilt heute kein Plan', async () => {
    await throughStepSeven();

    expect(device.onboarding.hasPlanToday()).toBe(false);
  });

  it('scheitert der `WeightRecorder`, meldet es „fehlgeschlagen“ ohne Plan; Wiederholen speichert genau einmal', async () => {
    await throughStepSeven();
    device.failWeightRecorder('wirft');

    expect(await device.onboarding.savePlan()).toEqual({ type: 'fehlgeschlagen' });
    expect(device.takeErrors()).toEqual([new Error('WeightRecorder: Transaktion gescheitert')]);
    expect(device.dailyGoalsOn(today)).toEqual([]);

    device.failWeightRecorder(false);
    expect(await device.onboarding.savePlan()).toEqual({ type: 'gespeichert' });
    expect(device.startWeights()).toHaveLength(1);
    expect(device.dailyGoalsOn(today)).toHaveLength(3);
  });

  it('lehnt der `WeightRecorder` das Startgewicht mit einem Vertragsfehler ab, meldet es „fehlgeschlagen“ ohne Plan', async () => {
    await throughStepSeven();
    device.failWeightRecorder('lehnt_ab');

    expect(await device.onboarding.savePlan()).toEqual({ type: 'fehlgeschlagen' });
    expect(device.takeErrors()).toEqual([{ code: 'invalid_payload', retryable: false }]);
    expect(device.dailyGoalsOn(today)).toEqual([]);
    expect(device.weeklyPlanVersions()).toEqual([]);
  });

  it('lehnt das Plan-Modul den Entwurf ab, etwa ein Zielgewicht unter BMI 18,5, ist er unvollständig, und es entsteht nichts', async () => {
    await throughStepSeven();
    // 168 cm: BMI 18,5 liegt bei 52,2 kg.
    device.onboarding.updateDraft({ goalWeightG: 50_000 });

    expect(await device.onboarding.savePlan()).toEqual({ type: 'unvollstaendig' });
    expect(device.startWeights()).toEqual([]);
    expect(device.weeklyPlanVersions()).toEqual([]);
  });

  it('ohne bestätigte Körperdaten ist der Entwurf unvollständig, und es entsteht nichts', async () => {
    await device.onboarding.register({ ...anna, disclaimerAcceptedAt: acceptedAt });
    await device.onboarding.setUpAccount();
    device.onboarding.updateDraft(answered);

    expect(await device.onboarding.savePlan()).toEqual({ type: 'unvollstaendig' });
    expect(device.startWeights()).toEqual([]);
    expect(device.dailyGoalsOn(today)).toEqual([]);
  });
});

describe('Ladezustand bis zum ersten vollständigen Pull', () => {
  it('bleibt beim Laden, solange der erste Pull die Person, aber noch nicht alle Seiten gebracht hat', async () => {
    device.interruptPull(true);
    await device.onboarding.register({ ...anna, disclaimerAcceptedAt: acceptedAt });
    expect(await device.onboarding.setUpAccount()).toEqual({ type: 'offline' });

    // Die Weiche steht mit der Person schon im Onboarding, das Onboarding wartet noch auf den Rest des Pulls.
    expect(device.gate.get()).toBe('onboarding');
    expect(device.onboarding.progress()).toEqual({ type: 'laedt' });

    device.interruptPull(false);
    await device.pull();

    expect(device.onboarding.progress()).toEqual({ type: 'bereit', disclaimerAccepted: true });
    expect(device.ownPerson()?.disclaimerAcceptedAt).toBe(acceptedAt);
  });
});

describe('Fortsetzen', () => {
  const today = LocalDate.parse('2026-10-14');
  const answered = {
    calculationSex: 'weiblich', birthDate: LocalDate.parse('1991-04-02'), heightCm: 168, weightG: 80_000,
    pregnantOrBreastfeeding: false, knownEatingDisorder: false, activityLevel: 'wenig_aktiv',
  } as const;

  async function registered() {
    await device.onboarding.register({ ...anna, disclaimerAcceptedAt: acceptedAt });
    await device.onboarding.setUpAccount();
  }

  /** Meldet ab, ohne die Kontodatenbank zu löschen, und wieder an: wie ein Neustart der App. */
  async function reopen() {
    await device.session.revocations.forgetSession();
    await device.session.auth.signIn(anna);
  }

  const forgetStep = () => device.forgetDeviceState('onboarding_step');

  it('ohne Entwurf beginnt es bei Schritt 3', async () => {
    await registered();

    expect(device.onboarding.resume()).toBe('koerperdaten');
  });

  it('setzt nach einem Abbruch aus dem lokalen Entwurf am letzten offenen Schritt fort, ohne etwas zu synchronisieren', async () => {
    await registered();
    const before = device.outbox();
    device.onboarding.updateDraft(answered);
    expect(device.onboarding.confirmBodyData()).toEqual({ type: 'bestaetigt' });
    device.onboarding.enterStep('zielgewicht');

    await reopen();

    expect(device.onboarding.resume()).toBe('zielgewicht');
    expect(device.onboarding.readDraft()).toEqual(expect.objectContaining(answered));
    expect(device.outbox()).toEqual(before);
  });

  it('ohne bestätigte Körperdaten beginnt es bei Schritt 3, auch wenn ein späterer Schritt gemerkt ist', async () => {
    await registered();
    device.onboarding.updateDraft(answered);
    device.onboarding.enterStep('ergebnis');

    expect(device.onboarding.resume()).toBe('koerperdaten');
  });

  it('ergibt das Geburtsdatum im Entwurf unter 18 Jahre, steht dort der Sperrbildschirm', async () => {
    await registered();
    device.onboarding.updateDraft({ birthDate: LocalDate.parse('2008-10-15') });
    device.onboarding.enterStep('koerperdaten');

    expect(device.onboarding.resume()).toBe('minderjaehrig');
  });

  it('mit Zielversion: Schritt 9 oder der gemerkte der Schritte 9–11; geht er verloren, wieder Schritt 9', async () => {
    await registered();
    device.onboarding.updateDraft({ ...answered, goalWeightG: 76_000, pace: 'entspannt', waterTargetMl: 1_500, weeklySportTargetMinutes: 150 });
    device.onboarding.confirmBodyData();
    device.onboarding.enterStep('wochenplan');
    expect(await device.onboarding.savePlan()).toEqual({ type: 'gespeichert' });
    expect(device.dailyGoalsOn(today)).toHaveLength(3);

    // Abbruch direkt nach dem Speichern, noch vor Schritt 9.
    expect(device.onboarding.resume()).toBe('health');

    device.onboarding.enterStep('notifications');
    await reopen();
    expect(device.onboarding.resume()).toBe('notifications');

    forgetStep();
    expect(device.onboarding.resume()).toBe('health');

    // Wer aus Schritt 9 in die Schritte davor zurückgeht und abbricht, landet wieder bei Schritt 9.
    device.onboarding.enterStep('ergebnis');
    expect(device.onboarding.resume()).toBe('health');
  });

  it('„Zurück“ aus Schritt 9 nur mit bestätigten Körperdaten im Entwurf dieses Geräts', async () => {
    await registered();
    expect(device.onboarding.hasConfirmedDraft()).toBe(false);

    device.onboarding.updateDraft(answered);
    expect(device.onboarding.hasConfirmedDraft()).toBe(false);
    device.onboarding.confirmBodyData();
    expect(device.onboarding.hasConfirmedDraft()).toBe(true);
  });

  it('der gemerkte Schritt ist Gerätezustand und wird nicht synchronisiert', async () => {
    await registered();
    const before = device.outbox();

    device.onboarding.enterStep('aktivitaetsstufe');

    expect(device.outbox()).toEqual(before);
  });
});

describe('Abschluss', () => {
  async function planSaved() {
    await device.onboarding.register({ ...anna, disclaimerAcceptedAt: acceptedAt });
    await device.onboarding.setUpAccount();
    device.onboarding.updateDraft({
      calculationSex: 'weiblich', birthDate: LocalDate.parse('1991-04-02'), heightCm: 168, weightG: 80_000,
      pregnantOrBreastfeeding: false, knownEatingDisorder: false, activityLevel: 'wenig_aktiv', goalWeightG: 76_000, pace: 'entspannt',
    });
    device.onboarding.confirmBodyData();
    expect(await device.onboarding.savePlan()).toEqual({ type: 'gespeichert' });
  }

  it('setzt `abgeschlossen` samt Zeitpunkt über den Person-Upsert, und die Weiche wechselt zu „Heute“', async () => {
    await planSaved();
    expect(device.gate.get()).toBe('onboarding');

    expect(device.onboarding.complete()).toEqual({ type: 'abgeschlossen' });

    const now = clock.read().instant;
    expect(device.ownPerson()).toEqual(expect.objectContaining({ onboardingStatus: 'abgeschlossen', onboardingCompletedAt: now }));
    expect(device.gate.get()).toBe('today');
    expect(device.outbox().at(-1)).toEqual(
      expect.objectContaining({
        type: 'upsert_entity',
        entityType: 'person',
        payload: expect.objectContaining({ onboardingStatus: 'abgeschlossen', onboardingCompletedAt: now }),
      }),
    );
  });

  it('scheitert die lokale Transaktion, meldet es den Fehler und bleibt im Onboarding', async () => {
    // Ohne gespeicherten Plan fehlen die Personenfelder, die `abgeschlossen` verlangt.
    await device.onboarding.register({ ...anna, disclaimerAcceptedAt: acceptedAt });
    await device.onboarding.setUpAccount();

    expect(device.onboarding.complete()).toEqual({ type: 'fehlgeschlagen' });

    expect(device.takeErrors()).toHaveLength(1);
    expect(device.ownPerson()?.onboardingStatus).toBe('begonnen');
    expect(device.gate.get()).toBe('onboarding');
  });
});
