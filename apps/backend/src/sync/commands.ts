import type { z } from 'zod';

import type { CanonicalChange, CanonicalIdMapping, CommandType, EntityData, OutboxOperation, PushResult } from '@abnehm/contracts/sync';
import type { ContractErrorCode } from '@abnehm/contracts/errors';

import type { PersonActor, ResourceFacts, ResourcePolicy, ResourceTarget } from '../authorization/authorization.ts';
import type { DbExecutor } from '../database.ts';

/**
 * Dauerhaft ungültige Fachregel: nur die Teiloperation rollt zurück, nicht der übrige Batch. Nach
 * erfolgreicher Objekt-Autorisierung darf die Ablehnung den kanonischen Datensatz der betroffenen
 * Entität nennen (Spezifikation 0, Abschnitt 10); die App übernimmt ihn dann. Ohne ihn antwortet der
 * Rahmen mit `absent`.
 */
export class CommandRejection extends Error {
  readonly code: Exclude<ContractErrorCode, 'forbidden' | 'operation_conflict'>;
  readonly canonical: CanonicalChange | null;
  constructor(code: Exclude<ContractErrorCode, 'forbidden' | 'operation_conflict'>, canonical: CanonicalChange | null = null) {
    super(code);
    this.code = code;
    this.canonical = canonical;
  }
}

/** Ein Bereich registriert einen fachlichen Befehl samt Autorisierung. `execute` läuft in einem
 * Savepoint des Push-Batches und muss seine Fachzeilen, Ableitungen und Änderungspositionen dort schreiben. */
export type ServerCommand<P extends EntityData = EntityData> = Readonly<{
  type: CommandType;
  /** `mapped` für Befehle, die lokal eine fachlich eindeutige Entität anlegen. */
  identity: 'none' | 'mapped';
  policy: ResourcePolicy;
  payload: z.ZodType<P>;
  target(operation: Extract<OutboxOperation, { businessKey: string }>): ResourceTarget;
  /** Request-Hash ohne rein lokale Identitäten; Fachwerte dürfen nicht herausfallen. */
  canonicalRequest(operation: Extract<OutboxOperation, { businessKey: string }>): EntityData;
  /** Ordnet bei gleichem fachlichen Schlüssel neue Geräte-IDs den IDs des gespeicherten Ergebnisses zu. */
  duplicate(operation: Extract<OutboxOperation, { businessKey: string }>, original: Extract<PushResult, { type: 'applied' | 'already_applied' }>): CanonicalIdMapping[];
  /** `resource` sind die Fakten, mit denen die Autorisierung den Befehl erlaubt hat, aus Postgres gelesen. */
  execute(tx: DbExecutor, input: Readonly<{ actor: PersonActor; resource: ResourceFacts; payload: P; businessKey: string; at: Date }>): Promise<Readonly<{
    changes: CanonicalChange[];
    idMappings: CanonicalIdMapping[];
  }>>;
}>;
