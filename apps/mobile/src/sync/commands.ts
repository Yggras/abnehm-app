import type { z } from 'zod';

import type { EntityId, ServerVersion } from '@abnehm/contracts/base';
import type { CommandType, EntityData, OutboxOperation, PushResult } from '@abnehm/contracts/sync';

import type { LocalDatabase, TransactionContext } from '../local-db';
import type { SyncWriter } from './outbox';

/** Ein Bereich besitzt seine lokale Fachänderung und deren Reconciliation; beides läuft mit der
 * Outbox in der Transaktion der Kontodatenbank. Die Registry öffnet keine zweite Transaktion. */
export type LocalCommand<P extends EntityData = EntityData> = Readonly<{
  type: CommandType;
  payload: z.ZodType<P>;
  /** Ausdrücklich referenztragende Stellen; freie Textwerte bleiben unverändert. */
  referencePaths: readonly (readonly string[])[];
  /** Liefert jede lokal optimistisch geänderte Entität, auch abgeleitete Zeilen. */
  apply(tx: TransactionContext, payload: P): readonly { entityType: string; entityId: EntityId }[];
  reconcileRejected(tx: TransactionContext, operation: Extract<OutboxOperation, { businessKey: string }>, result: Extract<PushResult, { type: 'permanently_rejected' }>): void;
}>;

export function createLocalCommandRegistry({ database, writer, commands }: {
  database: LocalDatabase; writer: SyncWriter; commands: readonly LocalCommand[];
}) {
  const byType = new Map<CommandType, LocalCommand>();
  for (const command of commands) {
    if (byType.has(command.type)) throw new Error(`Fachbefehl ${command.type} ist doppelt angemeldet`);
    byType.set(command.type, command);
  }
  function requireCommand(type: CommandType): LocalCommand {
    const command = byType.get(type);
    if (command === undefined) throw new Error(`Fachbefehl ${type} ist lokal nicht angemeldet`);
    return command;
  }
  return {
    execute(type: CommandType, businessKey: string, payload: EntityData, knownServerVersion: ServerVersion | null = null) {
      const command = requireCommand(type);
      const parsed = command.payload.parse(payload);
      database.transaction((tx) => {
        const affectedRefs = command.apply(tx, parsed);
        writer.command(tx, { type, businessKey, payload: parsed, knownServerVersion, affectedRefs,
          referencePaths: command.referencePaths });
      });
    },
    reconcileRejected(tx: TransactionContext, operation: Extract<OutboxOperation, { businessKey: string }>, result: Extract<PushResult, { type: 'permanently_rejected' }>) {
      requireCommand(operation.type).reconcileRejected(tx, operation, result);
    },
  };
}

export type LocalCommandRegistry = ReturnType<typeof createLocalCommandRegistry>;
