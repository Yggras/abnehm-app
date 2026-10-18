import type { ContractError } from '@abnehm/contracts/errors';
import {
  DailyIntakeSeries,
  EffectivePlan,
  IslandCheckInHint,
  LatestWeight,
  RecordManualWeight,
  RecordManualWeightResult,
  WeightTrendSeries,
  type IntakeReader,
  type IslandCheckInHintReader,
  type PlanReader,
  type WeightRecorder,
  type WeightTrendReader,
} from '@abnehm/contracts/ports';
import type { z } from 'zod';

import type { LocalDatabase } from '../local-db';

// Ports zwischen Bereichen (Spezifikation 0, Abschnitt 3). Sie sind keine Registry, sondern
// explizite Pflichtabhängigkeiten der konsumierenden Module: Wer einen Port braucht, nimmt ihn als
// Parameter seines Moduls entgegen. Diese Datei setzt die Ports am Composition Root zusammen, prüft
// sie dort vollständig und validiert jede Rückgabe gegen das Vertragsschema.

/** Die Ports der lokalen Datenbank eines Kontos. Nur der Insel-Hinweis ist optional. */
export type AreaPorts = {
  planReader: PlanReader;
  weightTrendReader: WeightTrendReader;
  intakeReader: IntakeReader;
  weightRecorder: WeightRecorder;
  /** Ohne ihn entfällt der Insel-Zusatz der Tages-Check-ins. */
  islandCheckInHintReader: IslandCheckInHintReader | null;
};

/** Lese-Ports bekommen nur Lesetransaktionen; Schreibversuche darin scheitern. */
export type ReadAccess = Pick<LocalDatabase, 'read'>;
/** Der Write-Port `WeightRecorder` öffnet seine eigene lokale Transaktion. */
export type WriteAccess = Pick<LocalDatabase, 'read' | 'transaction'>;

/** Was die Bereiche am Composition Root liefern: je Port eine Fabrik über die Datenbank des Kontos. */
export type AreaPortProviders = {
  planReader: (db: ReadAccess) => PlanReader;
  weightTrendReader: (db: ReadAccess) => WeightTrendReader;
  intakeReader: (db: ReadAccess) => IntakeReader;
  weightRecorder: (db: WriteAccess) => WeightRecorder;
  islandCheckInHintReader?: (db: ReadAccess) => IslandCheckInHintReader;
};

/** Am Composition Root fehlt ein Pflichtport oder eine seiner Methoden. */
export class IncompleteAreaPortsError extends Error {
  override name = 'IncompleteAreaPortsError';
  readonly problems: readonly string[];
  constructor(problems: readonly string[]) {
    super(`Ports unvollständig: ${problems.join(', ')}`);
    this.problems = problems;
  }
}

/** Ein Port hat einen Wert geliefert, den sein Vertragsschema ablehnt. */
export class PortContractError extends Error {
  override name = 'PortContractError';
  readonly port: string;
  readonly method: string;
  readonly issues: readonly z.core.$ZodIssue[];
  constructor(port: string, method: string, issues: readonly z.core.$ZodIssue[]) {
    super(`${port}.${method} verletzt den Vertrag: ${issues.map((issue) => issue.message).join('; ')}`);
    this.port = port;
    this.method = method;
    this.issues = issues;
  }
}

/** Rückgabeschema je Methode; daraus ergibt sich auch, welche Methoden ein Port haben muss. */
const portContracts = {
  planReader: { effectivePlan: EffectivePlan },
  weightTrendReader: { series: WeightTrendSeries, latest: LatestWeight },
  intakeReader: { dailyIntake: DailyIntakeSeries },
  weightRecorder: { recordManualWeight: RecordManualWeightResult },
  islandCheckInHintReader: { hint: IslandCheckInHint },
} as const;

type PortName = keyof typeof portContracts;
const requiredPorts = ['planReader', 'weightTrendReader', 'intakeReader', 'weightRecorder'] as const satisfies readonly PortName[];

/**
 * Setzt die Ports für die Datenbank eines Kontos zusammen. Fehlt ein Pflichtport oder eine Methode,
 * wirft es einmal mit allen Lücken. Jede Rückgabe wird gegen das Vertragsschema geprüft; eine
 * ungültige Eingabe an den `WeightRecorder` beantwortet es mit `invalid_payload`, ohne ihn aufzurufen.
 */
export function composeAreaPorts(database: LocalDatabase, providers: Partial<AreaPortProviders>): AreaPorts {
  const read: ReadAccess = { read: (work) => database.read(work) };
  const write: WriteAccess = { read: read.read, transaction: (work) => database.transaction(work) };
  // Fehlende Fabriken ergeben fehlende Ports; `checkAreaPorts` meldet alle Lücken auf einmal.
  return checkAreaPorts({
    planReader: providers.planReader?.(read),
    weightTrendReader: providers.weightTrendReader?.(read),
    intakeReader: providers.intakeReader?.(read),
    weightRecorder: providers.weightRecorder?.(write),
    islandCheckInHintReader: providers.islandCheckInHintReader?.(read) ?? null,
  } as AreaPorts);
}

/** Prüft fertige Ports auf Vollständigkeit und validiert ihre Rückgaben; auch für Fake-Ports. */
export function checkAreaPorts(ports: AreaPorts): AreaPorts {
  const problems: string[] = [];
  for (const name of Object.keys(portContracts) as PortName[]) {
    const port = ports[name] as unknown;
    if ((port === null || port === undefined) && !(requiredPorts as readonly string[]).includes(name)) continue;
    if (typeof port !== 'object' || port === null) {
      problems.push(name);
      continue;
    }
    for (const method of Object.keys(portContracts[name])) {
      if (typeof (port as Record<string, unknown>)[method] !== 'function') problems.push(`${name}.${method}`);
    }
  }
  if (problems.length > 0) throw new IncompleteAreaPortsError(problems);

  const weightRecorder = validated('weightRecorder', ports.weightRecorder);
  return Object.freeze({
    planReader: validated('planReader', ports.planReader),
    weightTrendReader: validated('weightTrendReader', ports.weightTrendReader),
    intakeReader: validated('intakeReader', ports.intakeReader),
    weightRecorder: {
      recordManualWeight: async (input) => {
        if (!RecordManualWeight.safeParse(input).success) return { type: 'contract_error', error: invalidPayload };
        return weightRecorder.recordManualWeight(input);
      },
    },
    islandCheckInHintReader: ports.islandCheckInHintReader ? validated('islandCheckInHintReader', ports.islandCheckInHintReader) : null,
  });
}

const invalidPayload: ContractError = { code: 'invalid_payload', retryable: false };

function validated<N extends PortName, P extends object>(name: N, port: P): P {
  const contracts: Record<string, z.ZodType> = portContracts[name];
  const wrapped: Record<string, unknown> = {};
  for (const [method, schema] of Object.entries(contracts)) {
    const call = (port as Record<string, (...args: unknown[]) => Promise<unknown>>)[method]!.bind(port);
    wrapped[method] = async (...args: unknown[]) => {
      const parsed = schema.safeParse(await call(...args));
      if (!parsed.success) throw new PortContractError(name, method, parsed.error.issues);
      return parsed.data;
    };
  }
  return Object.freeze(wrapped) as P;
}
