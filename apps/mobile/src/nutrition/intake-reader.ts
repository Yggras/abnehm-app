import { localDateAfter } from '@abnehm/contracts/base';
import type { DailyIntakeSeries, IntakeReader } from '@abnehm/contracts/ports';

import type { ReadAccess } from '../area-ports';
import { intakeByDay } from './entry-repository';

/**
 * `IntakeReader` über SQLite (Spezifikation 0, Abschnitt 3; Spezifikation 2, Abschnitt 10): für jeden
 * lokalen Tag von `from` bis `to` die Summe der `milli_kcal` und die Zahl der Mahlzeiten mit Einträgen
 * (0–4), gezählt wie in der Partner-Zusammenfassung `ernaehrung`. Tage ohne Einträge liefern 0; ist
 * `from` nach `to`, ist die Reihe leer. Er liest in einer Lesetransaktion; die Rückgabe prüft
 * `composeAreaPorts` am Composition Root gegen `DailyIntakeSeries`; dort ist er die Fabrik des Ports
 * (`intakeReader: intakeReaderOf`).
 */
export function intakeReaderOf(db: ReadAccess): IntakeReader {
  return {
    async dailyIntake(personId, from, to) {
      const intakes = db.read((tx) => intakeByDay(tx, personId, from, to));
      const series: DailyIntakeSeries = [];
      // Lokale Tage `YYYY-MM-DD` ordnen sich als Zeichenfolgen kalendarisch.
      for (let day = from; day <= to; day = localDateAfter(day, 1)) {
        series.push({ localDate: day, ...(intakes.get(day) ?? { intakeMilliKcal: 0, recordedMealCategories: 0 }) });
      }
      return series;
    },
  };
}
