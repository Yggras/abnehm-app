import type { z } from 'zod';

import type { ServerVersion } from '@abnehm/contracts/base';
import type { CommandType, EntityData, OutboxOperation, PushResult } from '@abnehm/contracts/sync';

import type { LocalDatabase, TransactionContext } from '../local-db';
import type { SyncWriter } from './outbox';

/** Ein Bereich besitzt seine lokale Fachänderung und deren Reconciliation; beides läuft mit der
 * Outbox in der Transaktion der Kontodatenbank. Die Registry öffnet keine zweite Transaktion. */
export type LocalCommand<P extends EntityData = EntityData> = Readonly<{
  type: CommandType;
  payload: z.ZodType<P>;
  apply(tx: TransactionContext, payload: P): void;
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
        command.apply(tx, parsed);
        writer.command(tx, { type, businessKey, payload: parsed, knownServerVersion });
      });
    },
    reconcileRejected(tx: TransactionContext, operation: Extract<OutboxOperation, { businessKey: string }>, result: Extract<PushResult, { type: 'permanently_rejected' }>) {
      requireCommand(operation.type).reconcileRejected(tx, operation, result);
    },
  };
}

export type LocalCommandRegistry = ReturnType<typeof createLocalCommandRegistry>;
