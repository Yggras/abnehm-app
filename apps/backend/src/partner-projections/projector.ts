import type { AreaKey, EntityId, LocalDate } from '@abnehm/contracts/base';
import type { PartnerSummaryContent, PartnerSummaryPeriod } from '@abnehm/contracts/partner';

import type { DbExecutor } from '../database.ts';

// Vertrag der Bereichs-Projectors (Spezifikation 0, Abschnitt 5). Je Bereich meldet ein Fachmodul genau
// einen `PartnerSummaryProjector` an. Er berechnet den Inhalt aus Eigentümer und Zeitraum, liest dafür
// nur die Tabellen seines eigenen Bereichs und bekommt alles andere als Reader-Port injiziert, etwa den
// `PlanReader` für Wasser- und Sportziel. Wann er läuft, entscheidet allein das Fundament.
//
// Ergänzt in #181 (Nutzerentscheidungen):
// - `today` ist der aktuelle lokale Tag des Eigentümers, den das Fundament ohnehin bestimmt; der Zeitraum
//   enthält ihn immer. Das Sportwochenziel kommt aus der Zielversion von heute, wie im Sport-Mini-Tracker
//   der App, damit Partner und Eigentümer dasselbe Ziel sehen.
// - `null` heißt „noch nichts zu zeigen“, etwa ohne gültige Zielversion, solange der erste Plan noch in
//   der Outbox liegt. Das Fundament hält dann für den Zeitraum keine Zusammenfassung, und der Pull läuft
//   sonst normal weiter.

/** Reader-Port eines anderen Bereichs, gebunden an die Transaktion, in der der Projector rechnet. */
export type ReaderPort<T> = (tx: DbExecutor) => T;

export type PartnerSummaryProjector<A extends AreaKey = AreaKey> = Readonly<{
  area: A;
  /**
   * Inhalt der Zusammenfassung oder `null` für „noch nichts zu zeigen“; das Fundament prüft den Inhalt
   * gegen `PartnerSummaryEnvelope`, bevor es ihn speichert.
   */
  project(
    tx: DbExecutor,
    input: Readonly<{ ownerPersonId: EntityId; period: PartnerSummaryPeriod<A>; today: LocalDate }>,
  ): Promise<PartnerSummaryContent<A> | null>;
}>;

/** Ein Projector für irgendeinen Bereich, mit zum Bereich passendem Zeitraum und Inhalt. */
export type AnyPartnerSummaryProjector = { [A in AreaKey]: PartnerSummaryProjector<A> }[AreaKey];
