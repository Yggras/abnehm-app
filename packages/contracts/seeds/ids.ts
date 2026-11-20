import { EntityId, LocalDate } from '../src/base.ts';
import { goalVersionId, weeklyPlanVersionId } from '../src/plan.ts';

// Gemeinsame IDs, Konten und Installationen aller Seed-Szenarien (Spezifikation 0, Abschnitt 12).
// Bereiche ergänzen Szenarien unter Wiederverwendung dieser Werte; eigene IDs eines Bereichs folgen
// demselben Muster `5eed<art>-0000-4000-8000-<laufende nummer>`, außer wo eine Regel die ID aus dem
// fachlichen Schlüssel ableitet. Alles ist synthetisch.

/** Feste Uhr aller Szenarien: Mittwoch, 14.10.2026, 14:00 Uhr in Berlin. */
export const seedClock = { instant: '2026-10-14T12:00:00.000Z', timeZone: 'Europe/Berlin' } as const;

/** Benannte lokale Tage in `Europe/Berlin` relativ zur festen Uhr. */
export const seedDays = {
  heute: '2026-10-14',
  gestern: '2026-10-13',
  vorgestern: '2026-10-12',
  zielstart: '2026-10-01',
} as const;

/** Beginn des Folgetags in Berlin (Sommerzeit, UTC+2), etwa für `day_ends_at` von heute. */
export const seedDayEnds = {
  heute: '2026-10-14T22:00:00.000Z',
  gestern: '2026-10-13T22:00:00.000Z',
  vorgestern: '2026-10-12T22:00:00.000Z',
} as const;

/** UTC-Offset in Berlin am 14.10.2026 (Sommerzeit). */
export const seedUtcOffsetMinutes = 120;

const id = (kind: string, n: number) => `5eed${kind}-0000-4000-8000-${n.toString().padStart(12, '0')}`;

const person = { philipp: id('0002', 1), anna: id('0002', 2) };

/**
 * Feste Bildschlüssel der synthetischen Fotos (#162): lesbar statt zufällig, aber im Format eines echten
 * Schlüssels (43 Zeichen base64url, `PhotoImageKey`).
 */
const imageKey = (name: string) => `seed_${name}`.padEnd(43, '0');
export const seedImageKeys = {
  mealPhoto: {
    philippHeute: imageKey('mahlzeitenfoto_philipp_heute'),
    annaHeute: imageKey('mahlzeitenfoto_anna_heute'),
    philippNichtGeteilt: imageKey('mahlzeitenfoto_philipp_privat'),
    philippVerwaist: imageKey('mahlzeitenfoto_philipp_verwaist'),
  },
  photoDraft: { philippAbgelaufen: imageKey('fotoentwurf_philipp_abgelaufen') },
} as const;

/**
 * Ziel- und Wochenplanversionen tragen die ID aus Person und `valid_from` (#128); nur so ersetzt eine
 * spätere Fassung desselben Tags die Zeile, statt am natürlichen Schlüssel zu scheitern.
 */
const planVersionIds = (idOf: (personId: EntityId, validFrom: LocalDate) => EntityId) => ({
  philipp: idOf(EntityId.parse(person.philipp), LocalDate.parse(seedDays.zielstart)) as string,
  anna: idOf(EntityId.parse(person.anna), LocalDate.parse(seedDays.zielstart)) as string,
});

export const seedIds = {
  account: { philipp: id('0001', 1), anna: id('0001', 2) },
  person,
  /** `philippIpad` ist Philipps zweites Gerät, nur in `zwei_installationen` (#116), `doppelausgabe` (#191) und `feldkonflikt` (#194). */
  installation: { philippIphone: id('0003', 1), annaAndroid: id('0003', 2), philippIpad: id('0003', 3) },
  goalVersion: planVersionIds(goalVersionId),
  weeklyPlanVersion: planVersionIds(weeklyPlanVersionId),
  dailyGoal: {
    philippHeute: [id('0012', 1), id('0012', 2), id('0012', 3)],
    annaHeute: [id('0012', 4), id('0012', 5), id('0012', 6)],
    /** Nur in den Randzuständen zum Tagesende (#113) und in `solo-energie` (#180). */
    philippGestern: [id('0012', 7), id('0012', 8), id('0012', 9)],
    // 0012/10–12: Philipps Tagesziele von vorgestern, nur in `solo-energie` (#180).
    philippVorgestern: [id('0012', 10), id('0012', 11), id('0012', 12)],
    /** Energieverlauf der Partner-Szenarien (#191): je Person, Tag und Platz eine ID, fortlaufend. */
    verlauf: (n: number) => id('0013', n),
  },
  // 0020/5–7 sind Philipps Einträge 3–5, nur in den Varianten `solo-wasser-*` (#171) und den Randzuständen (#113);
  // 0020/3–4 gehören Anna (#117), 0020/15 ist ihr dritter Eintrag über dem Ziel (#181).
  waterEntry: {
    philippHeute: [id('0020', 1), id('0020', 2), id('0020', 5), id('0020', 6), id('0020', 7)],
    annaHeute: [id('0020', 3), id('0020', 4), id('0020', 15)],
    /** Nur in den Randzuständen zum Tagesende (#113). */
    philippGestern: [id('0020', 8), id('0020', 9)],
    /** Offline gebucht, nur in `zwei_installationen` (#116): je Gerät ein Eintrag. */
    philippIphoneOffline: id('0020', 10),
    philippIpadOffline: id('0020', 11),
    /** Offline gebucht und noch nicht gesichert, nur in `offline_sync` (#116). */
    philippUngesichert: id('0020', 12),
    /** In `tage_ohne_app_oeffnung` (#131): am 07.10. außerhalb, am 10.10. innerhalb des Nachholfensters. */
    philippOhneAppOeffnung: [id('0020', 13), id('0020', 14)],
  },
  // 0021/4–6: Philipps weitere Messungen in den Gewichts-Varianten von `solo` (#176).
  // 0021/7–15: Philipps frühere Messungen der letzten 30 Tage in den Partner-Szenarien (#181), 0021/16: sein Waagenimport.
  // 0021/17–20: Annas frühere Messungen in den Partner-Szenarien (#181).
  // 0021/21–30: Philipps Startgewicht und Messungen der letzten 21 Tage in den Budgetvorschlag-Szenarien (#150).
  // 0021/31: die `entryId` des Startgewichts im Onboarding-Entwurf von `onboarding-unterbrochen` (#146); noch
  // ohne Zeile, sie entsteht erst mit „Plan speichern“ in Schritt 8.
  weightEntry: {
    philippVorgestern: id('0021', 1), philippGestern: id('0021', 2), annaGestern: id('0021', 3), philippVerlauf: [id('0021', 4), id('0021', 5), id('0021', 6)],
    philippMonat: Array.from({ length: 9 }, (_, index) => id('0021', 7 + index)),
    philippWaage: id('0021', 16),
    annaVerlauf: [id('0021', 17), id('0021', 18), id('0021', 19), id('0021', 20)],
    philippBudgetvorschlag: Array.from({ length: 10 }, (_, index) => id('0021', 21 + index)),
    philippOnboardingEntwurf: id('0021', 31),
  },
  // 0022/4: Philipps kurze Einheit von heute, nur im Randzustand `teilweise` (#113).
  // 0022/5–8: Philipps übrige Einheiten dieser Woche in `solo` und seinen Sport-Varianten (#173).
  // 0022/9–11: Philipps Einheiten der Vorwoche in `solo` und seinen Varianten (#174).
  // 0022/12–15: Philipps Sportwoche in den Partner-Szenarien mit Import, Ersetzung und Ausblendung (#181).
  // 0022/16–17: Annas importierte Einheiten dieser Woche in den Partner-Szenarien (#181).
  sportEntry: {
    philippGestern: id('0022', 1), philippHeute: id('0022', 2), annaHeute: id('0022', 3), philippHeuteKurz: id('0022', 4),
    philippVorgestern: id('0022', 5), philippWoche: [id('0022', 6), id('0022', 7), id('0022', 8)],
    philippVorwoche: [id('0022', 9), id('0022', 10), id('0022', 11)],
    philippPartner: { montag: id('0022', 12), dienstagImport: id('0022', 13), dienstagErsetzt: id('0022', 14), heuteAusgeblendet: id('0022', 15) },
    annaWoche: [id('0022', 16), id('0022', 17)],
  },
  // 0031/3–4: Philipps Frühstück aus der Suche (#155), in `solo` und damit auch in den Partner-Szenarien.
  // 0031/5–7: Philipps Mahlzeiten von gestern, nur in den Randzuständen zum Tagesende (#113).
  // 0031/8–9: Philipps Frühstück und Mittagessen von heute, nur in den Randzuständen der Ernährung (#166).
  // 0031/13–14: Philipps Fotoeinträge in `gekoppelt` (#164): der zum nicht geteilten Foto von heute und der
  // gestern gelöschte des verwaisten Fotos.
  // 0031/39–40: Philipps Frühstück in und vor dem 30-Tage-Fenster von „Zuletzt verwendet“ in `solo` (#158).
  nutritionEntry: {
    philippMittag: id('0031', 1),
    annaMittag: id('0031', 2),
    philippFruehstueck: [id('0031', 3), id('0031', 4)],
    philippGestern: [id('0031', 5), id('0031', 6), id('0031', 7)],
    philippRandzustand: { fruehstueck: id('0031', 8), mittag: id('0031', 9) },
    /** `solo`: Einträge am Vortag ohne Abendessen (#156). */
    philippVortag: [id('0031', 10), id('0031', 11), id('0031', 12)],
    /** Budgetvorschlag-Szenarien (#150): je erfasstem Tag Frühstück und Abendessen, 0031/13–36. */
    philippBudgetvorschlag: Array.from({ length: 24 }, (_, index) => id('0031', 13 + index)),
    /** `gekoppelt`: Philipps einzeln vom Teilen ausgenommener Obstsalat und der gelöschte Eintrag seines verwaisten Fotos (#164). */
    philippNichtGeteilt: id('0031', 37),
    philippVerwaist: id('0031', 38),
    /** `solo`: Frühstück am ersten Tag in und am letzten Tag vor dem 30-Tage-Fenster von „Zuletzt verwendet“ (#158). */
    philippZuletztFenster: { innerhalb: id('0031', 39), ausserhalb: id('0031', 40) },
  },
  /**
   * Operations-IDs, die der Sync-Writer einer Installation in einem Schritt `tagesziele_auswerten` (#113)
   * oder `tagesziele_sicherstellen` (#131) nacheinander vergibt; so steht auch die Outbox des Sollzustands fest.
   */
  operation: {
    erfuellt: [id('0090', 1)],
    tagesendeOffen: [id('0090', 2), id('0090', 3)],
    tagesendeAbgeschlossen: [id('0090', 4), id('0090', 5)],
    /** Offene Operationen der Mehrgeräte- und Sync-Szenarien (#116), je Gerät in Entstehungsreihenfolge. */
    zweiInstallationen: {
      iphone: { gewicht: id('0090', 6), wasser: id('0090', 7), erfuellung: id('0090', 8) },
      ipad: { gewicht: id('0090', 9), wasser: id('0090', 10), erfuellung: id('0090', 11) },
    },
    offlineSync: {
      gewicht: id('0090', 12), tippfehler: id('0090', 13), erfuellung: id('0090', 17), korrektur: id('0090', 14), gegenLoeschung: id('0090', 15), ungesichert: id('0090', 16),
    },
    /** Schritt `tagesziele_sicherstellen` in `tage_ohne_app_oeffnung` (#131): sieben Materialisierungen, eine Erfüllung. */
    tageOhneAppOeffnung: Array.from({ length: 8 }, (_, index) => id('0090', 18 + index)),
    /** Die vier Schritte `tagesziele_sicherstellen` in `zeitzonen_reisen` (#131), zusammen 16 Materialisierungen. */
    zeitzonenReisen: Array.from({ length: 16 }, (_, index) => id('0090', 26 + index)),
    /** Offline-Bauten in `doppelausgabe` (#191): je Gerät vier, in Entstehungsreihenfolge. */
    doppelausgabe: {
      iphone: Array.from({ length: 4 }, (_, index) => id('0090', 42 + index)),
      ipad: Array.from({ length: 4 }, (_, index) => id('0090', 46 + index)),
    },
    /** Offline-Platzierungen in `feldkonflikt` (#194): je Gerät eine. */
    feldkonflikt: { iphone: id('0090', 50), ipad: id('0090', 51) },
    /** Annas Offline-Bauten in `levelaufstieg-ausstehend` (#200), in Entstehungsreihenfolge. */
    levelaufstiegAusstehend: Array.from({ length: 3 }, (_, index) => id('0090', 54 + index)),
    /** Erfüllungen in den Randzuständen der Ernährung (#166). */
    ernaehrungErfuellt: [id('0090', 52)],
    kalorienbudgetInnerhalb: [id('0090', 53)],
    /** Upsert des neuen Budgetvorschlags im Schritt `budgetvorschlag_pruefen` (#150). */
    budgetvorschlag: { senken: id('0090', 57), anheben: id('0090', 58) },
  },
  /**
   * Mahlzeitenfotos in `gekoppelt`: je Person ein geteiltes von heute (#162), dazu Philipps einzeln vom Teilen
   * ausgenommenes Foto und als Randzustand sein verwaistes Foto, dessen einziger Eintrag seit gestern gelöscht ist (#164).
   */
  mealPhoto: { philippHeute: id('0032', 1), annaHeute: id('0032', 2), philippNichtGeteilt: id('0032', 3), philippVerwaist: id('0032', 4) },
  /** Philipps eigene Lebensmittel in `solo` und seinen Varianten (#157): ein eigenes mit Portion, eine BLS-Korrektur. */
  ownFood: { philippBircher: id('0034', 1), philippApfel: id('0034', 2) },
  /** Server-only; ein abgelaufener Fotoentwurf als Randzustand (#162). */
  photoDraft: { philippAbgelaufen: id('0033', 1) },
  coupling: { philippAnna: id('0040', 1) },
  couplingMember: { philipp: id('0041', 1), anna: id('0041', 2) },
  island: { philippAnna: id('0042', 1) },
  /** Inhalte der geschlüpften Insel (#184): je Feld der Grundinsel eine ID in Katalogreihenfolge. */
  islandField: (n: number) => id('0046', n),
  blueprintUnlock: (n: number) => id('0047', n),
  communityProject: { gartenhaeuschen: id('0048', 1) },
  islandEvent: { geschluepft: id('0049', 1) },
  islandProgress: { philippAnna: id('0052', 1) },
  /** Gebaute Objekte (#191) und die IDs ihrer Spielbefehle, je Bau dieselbe laufende Nummer. */
  islandObject: (n: number) => id('0053', n),
  buildCommand: (n: number) => id('0054', n),
  /** IDs der Spielbefehle `placeObject` (#194), fortlaufend. */
  placeCommand: (n: number) => id('0055', n),
  partnerSharing: {
    philipp: { ernaehrung: id('0043', 1), wasser: id('0043', 2), sport: id('0043', 3), gewicht: id('0043', 4) },
    anna: { ernaehrung: id('0043', 5), wasser: id('0043', 6), sport: id('0043', 7), gewicht: id('0043', 8) },
  },
  photoSharing: { philipp: id('0044', 1), anna: id('0044', 2) },
  // 0045/3: Annas offene Rollenwahl in `rollenwahl-offen` (#180).
  sharedAction: { dekoGeschenk: id('0045', 1), annasEntkopplung: id('0045', 2), annasRollenwahl: id('0045', 3) },
  /** Zusammenfassungen je Eigentümer, also an den jeweils anderen Partner. */
  partnerSummary: {
    philipp: { ernaehrung: id('0050', 1), wasser: id('0050', 2), sport: id('0050', 3), gewicht: id('0050', 4) },
    anna: { wasser: id('0050', 6), sport: id('0050', 7), gewicht: id('0050', 8) },
  },
  /** Tageszielstand je Eigentümer, also an den jeweils anderen Partner. */
  partnerDailyGoalStatus: { philipp: id('0051', 1), anna: id('0051', 2) },
  /** Philipps drei Anfeuerungen an Anna von heute in `gekoppelt` (#123). */
  encouragement: { philippHeute: [id('0055', 1), id('0055', 2), id('0055', 3)] },
  /** Annas offene Einladung in `einladung-nach-entkopplung` (#120). */
  invitation: { annasEinladung: id('0056', 1) },
  /** Philipps Challenge-Vorschläge in `challenge-vorgeschlagen` und `challenge-verfallen` (#210). */
  challenge: { philippsVorschlag: id('0057', 1), philippsVerfallenerVorschlag: id('0057', 2) },
} as const;

/**
 * Klartext der geseedeten Einladungscodes (#120). Der Server speichert nur ihren HMAC unter dem Einladungs-Secret;
 * der Seeder bildet ihn beim Einfügen (`inviteCodes` im Manifest). Nur in Development- und Testartefakten.
 */
export const seedInviteCodes = { annasEinladung: '271828' } as const;

/** Dokumentiertes Testpasswort aller Seed-Konten; nur in Development- und Testartefakten. */
export const seedPassword = 'momo-insel-testpasswort';

export const seedAccounts = {
  philipp: { key: 'philipp', accountId: seedIds.account.philipp, personId: seedIds.person.philipp, email: 'philipp@example.test', password: seedPassword },
  anna: { key: 'anna', accountId: seedIds.account.anna, personId: seedIds.person.anna, email: 'anna@example.test', password: seedPassword },
} as const;

export const seedInstallations = {
  philippIphone: { key: 'philipp-iphone', installationId: seedIds.installation.philippIphone, account: 'philipp', platform: 'ios' },
  annaAndroid: { key: 'anna-android', installationId: seedIds.installation.annaAndroid, account: 'anna', platform: 'android' },
  philippIpad: { key: 'philipp-ipad', installationId: seedIds.installation.philippIpad, account: 'philipp', platform: 'ios' },
} as const;
