/** Eine Eingabe verletzt die Tracker-Regeln; es wurde nichts geschrieben. */
export class InvalidTrackerInputError extends Error {
  override name = 'InvalidTrackerInputError';
}
