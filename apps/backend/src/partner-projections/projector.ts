import type { AreaKey, EntityId } from '@abnehm/contracts/base';
import type { PartnerSummaryContent, PartnerSummaryPeriod } from '@abnehm/contracts/partner';

import type { DbExecutor } from '../database.ts';

// Vertrag der Bereichs-Projectors (Spezifikation 0, Abschnitt 5). Je Bereich meldet ein Fachmodul genau
// einen `PartnerSummaryProjector` an. Er berechnet den Inhalt aus Eigentümer und Zeitraum, liest dafür
// nur die Tabellen seines eigenen Bereichs und bekommt alles andere als Reader-Port injiziert, etwa den
// `PlanReader` für Wasser- und Sportziel. Wann er läuft, entscheidet allein das Fundament.

/** Reader-Port eines anderen Bereichs, gebunden an die Transaktion, in der der Projector rechnet. */
export type ReaderPort<T> = (tx: DbExecutor) => T;

export type PartnerSummaryProjector<A extends AreaKey = AreaKey> = Readonly<{
  area: A;
  /** Inhalt der Zusammenfassung; das Fundament prüft ihn gegen `PartnerSummaryEnvelope`, bevor er gespeichert wird. */
  project(tx: DbExecutor, input: Readonly<{ ownerPersonId: EntityId; period: PartnerSummaryPeriod<A> }>): Promise<PartnerSummaryContent<A>>;
}>;

/** Ein Projector für irgendeinen Bereich, mit zum Bereich passendem Zeitraum und Inhalt. */
export type AnyPartnerSummaryProjector = { [A in AreaKey]: PartnerSummaryProjector<A> }[AreaKey];
