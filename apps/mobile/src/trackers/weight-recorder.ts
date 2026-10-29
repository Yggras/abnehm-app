import { RecordManualWeight, type RecordManualWeightResult, type WeightRecorder } from '@abnehm/contracts/ports';
import type { ContractErrorCode } from '@abnehm/contracts/errors';

import { requireOwnPerson } from '../local-db/person-header';
import { InvalidTrackerInputError } from './invalid-input';
import type { TrackerDependencies } from './trackers';
import { recordWeightEntry } from './weight';
import { readWeightEntry } from './weight-repository';

// Schreib-Port `WeightRecorder` (Spezifikation 0, Abschnitt 3; Spezifikation 3, Abschnitt 7): Über ihn
// speichert *Ziele & Onboarding* das Startgewicht und das aktuelle Gewicht bei der Neuberechnung als
// gewöhnlichen manuellen Gewichtseintrag. Er validiert wie `recordWeight` und läuft in einer eigenen
// lokalen Transaktion. Die Frage „Tippfehler?“ gehört zum Formular dieses Bereichs, nicht zum Port.

const rejected = (code: ContractErrorCode): RecordManualWeightResult => ({ type: 'contract_error', error: { code, retryable: false } });

/**
 * `recordManualWeight` ist idempotent je `entryId`: Ein erneuter Aufruf aktualisiert den Eintrag,
 * statt ihn zu verdoppeln. Ungültige Eingaben und Zeitpunkte in der Zukunft beantwortet er mit
 * `invalid_payload`, eine fremde Person mit `forbidden` und einen schon gelöschten Eintrag mit
 * `conflict`, jeweils ohne zu schreiben. Ein technischer Fehler rollt die Transaktion zurück und wird
 * weitergeworfen.
 */
export function createWeightRecorder(dependencies: TrackerDependencies): WeightRecorder {
  const { database } = dependencies;
  return {
    async recordManualWeight(input) {
      const parsed = RecordManualWeight.safeParse(input);
      if (!parsed.success) return rejected('invalid_payload');
      const { entryId, personId, weightG, measuredAt } = parsed.data;
      try {
        return database.transaction((tx): RecordManualWeightResult => {
          if (requireOwnPerson(tx).id !== personId) return rejected('forbidden');
          // Löschen ist endgültig (Spezifikation 0, Abschnitt 10); ein gelöschter Eintrag wird nicht wieder lebendig.
          if (readWeightEntry(tx, entryId)?.deletedAt != null) return rejected('conflict');
          const { localDate } = recordWeightEntry(tx, dependencies, entryId, { weightG, measuredAt });
          return { type: 'recorded', entryId, localDate };
        });
      } catch (error) {
        if (error instanceof InvalidTrackerInputError) return rejected('invalid_payload');
        throw error;
      }
    },
  };
}
