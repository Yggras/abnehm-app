import { resourceEntities, type ResourceClass, type ResourceEntity } from './resources.ts';

// Policies der zentralen Autorisierung (Spezifikation 0, Abschnitt 11). Jede Route und jeder
// Fachbefehl nennt genau eine davon. Gültig ist nur eine Policy, die `policies` erzeugt hat; ein von
// Hand gebautes Objekt gleicher Form lehnt das Modul ab.

/** Wogegen eine Policy schützt; das Negativtest-Gerüst erzeugt daraus seine Fälle. */
export type ProtectionDimension =
  | 'ohne_sitzung'
  | 'fremde_person'
  | 'manipulierte_id'
  | 'entkopplung'
  | 'freigabeentzug'
  | 'verbotene_operation';

/**
 * Operation auf einer Ressource: Lesen, generisches Upsert bzw. Löschen über das Sync-Schema oder
 * ein benannter, servervalidierter Fachbefehl.
 */
export const operations = ['lesen', 'upsert', 'loeschen', 'befehl'] as const;
export type Operation = (typeof operations)[number];

/** Serverseitige Kommandos des Betriebs; dieselbe Liste wie im Sicherheitslog. */
export type AdminCommand = 'passwort_reset';

type MatrixRow = Readonly<{
  /** Erlaubte Operationen; alles andere ist eine verbotene Operation. */
  operations: readonly Operation[];
  /** Operationen, die eine aktive Kopplung voraussetzen. */
  coupled: readonly Operation[];
  /** Operationen, die zusätzlich eine Freigabe des Eigentümers voraussetzen. */
  shared: readonly Operation[];
}>;

/**
 * Die verbindliche Operationsmatrix aus Abschnitt 11. Welche Person eine Operation ausführen darf,
 * regeln die Ressourcenregeln in `resources.ts`; hier steht, welche Operationen es überhaupt gibt.
 */
export const operationMatrix = {
  eigene_eintraege: { operations: ['lesen', 'upsert', 'loeschen', 'befehl'], coupled: [], shared: [] },
  zielversionen: { operations: ['lesen', 'befehl'], coupled: [], shared: [] },
  fachbuchungen: { operations: ['lesen', 'befehl'], coupled: [], shared: [] },
  kopplungsinhalte: { operations: ['lesen', 'befehl'], coupled: ['lesen', 'befehl'], shared: [] },
  inselfortschritt: { operations: ['lesen'], coupled: ['lesen'], shared: [] },
  personenstand: { operations: ['lesen', 'befehl'], coupled: [], shared: [] },
  anfeuern: { operations: ['lesen', 'befehl'], coupled: ['lesen', 'befehl'], shared: [] },
  partnerfreigabe: { operations: ['lesen', 'upsert'], coupled: [], shared: [] },
  partner_zusammenfassung: { operations: ['lesen'], coupled: ['lesen'], shared: ['lesen'] },
  partner_tageszielstatus: { operations: ['lesen'], coupled: ['lesen'], shared: [] },
  widerrufshinweis: { operations: ['lesen'], coupled: [], shared: [] },
  fotofreigabe: { operations: ['lesen', 'upsert'], coupled: [], shared: [] },
  // Schreiben „nur Eigentümer gemäß Foto-Fachregeln“: Freigabeschalter und Löschen generisch, das
  // Anlegen nur über den Fachbefehl `confirmPhotoDraft` (Spezifikation 2, Abschnitt 11; #162).
  partnerfoto: { operations: ['lesen', 'upsert', 'loeschen', 'befehl'], coupled: ['lesen'], shared: ['lesen'] },
  push_installation: { operations: ['lesen', 'upsert'], coupled: [], shared: [] },
  serverdaten: { operations: [], coupled: [], shared: [] },
} as const satisfies Readonly<Record<ResourceClass, MatrixRow>>;

type RowOf<E extends ResourceEntity> = (typeof operationMatrix)[(typeof resourceEntities)[E]['resourceClass']];
type OperationsOf<E extends ResourceEntity> = (typeof resourceEntities)[E] extends { onlyOperations: infer Only extends readonly Operation[] }
  ? Only
  : RowOf<E>['operations'];

/** Schutzdimensionen einer Ressourcenoperation, schon in der Typprüfung bekannt. */
export type DimensionsOf<E extends ResourceEntity, O extends Operation> =
  | 'ohne_sitzung'
  | 'fremde_person'
  | ((typeof resourceEntities)[E]['locatedBy'] extends 'id' ? 'manipulierte_id' : never)
  | (O extends RowOf<E>['coupled'][number] ? 'entkopplung' : never)
  | (O extends RowOf<E>['shared'][number] ? 'freigabeentzug' : never)
  | (OperationsOf<E>['length'] extends (typeof operations)['length'] ? never : 'verbotene_operation');

export type PublicPolicy = Readonly<{ kind: 'public'; dimensions: readonly never[] }>;
export type AuthenticatedPolicy = Readonly<{ kind: 'authenticated'; dimensions: readonly 'ohne_sitzung'[] }>;
export type LogoutPolicy = Readonly<{ kind: 'logout'; dimensions: readonly 'ohne_sitzung'[] }>;
export type AdminCommandPolicy = Readonly<{ kind: 'adminCommand'; command: AdminCommand; dimensions: readonly never[] }>;
export type ResourcePolicy<
  E extends ResourceEntity = ResourceEntity,
  O extends Operation = Operation,
  D extends ProtectionDimension = ProtectionDimension,
> = Readonly<{ kind: 'resourceOperation'; entity: E; operation: O; dimensions: readonly D[] }>;
export type Policy = PublicPolicy | AuthenticatedPolicy | LogoutPolicy | AdminCommandPolicy | ResourcePolicy;

const created = new WeakSet<Policy>();

function create<P extends Policy>(policy: P): P {
  const frozen = Object.freeze({ ...policy, dimensions: Object.freeze([...policy.dimensions]) }) as P;
  created.add(frozen);
  return frozen;
}

/** Erlaubte Operationen einer Ressource: die ihrer Klasse, bei manchen Entitäten enger. */
function operationsOf(entity: ResourceEntity): readonly Operation[] {
  const rule: { resourceClass: ResourceClass; onlyOperations?: readonly Operation[] } = resourceEntities[entity];
  const matrix: MatrixRow = operationMatrix[rule.resourceClass];
  return rule.onlyOperations ?? matrix.operations;
}

function resourceDimensions(entity: ResourceEntity, operation: Operation): ProtectionDimension[] {
  const { resourceClass, locatedBy } = resourceEntities[entity];
  const matrix: MatrixRow = operationMatrix[resourceClass];
  const dimensions: ProtectionDimension[] = ['ohne_sitzung', 'fremde_person'];
  if (locatedBy === 'id') dimensions.push('manipulierte_id');
  if (matrix.coupled.includes(operation)) dimensions.push('entkopplung');
  if (matrix.shared.includes(operation)) dimensions.push('freigabeentzug');
  if (operationsOf(entity).length < operations.length) dimensions.push('verbotene_operation');
  return dimensions;
}

export const policies = {
  /** Ohne Sitzung erreichbar; Konto und Person gibt es dann nicht. Nur Status und Auth-Abläufe. */
  public: (): PublicPolicy => create({ kind: 'public', dimensions: [] }),
  /** Verlangt eine gültige Sitzung; Konto und Person stammen ausschließlich aus ihr. */
  authenticated: (): AuthenticatedPolicy => create({ kind: 'authenticated', dimensions: ['ohne_sitzung'] }),
  /**
   * Nur der Abmeldeablauf (Spezifikation 0, Abschnitt 9): wie `authenticated`, doch die Route erhält
   * ohne gültige Sitzung `actor = null` statt einer `401`. Dann darf sie ausschließlich ihr eigenes, an
   * das vorgelegte Sitzungstoken gebundenes Ergebnis liefern, sonst antwortet sie selbst mit `401`.
   */
  logout: (): LogoutPolicy => create({ kind: 'logout', dimensions: ['ohne_sitzung'] }),
  /** Serverseitiges Kommando des Betriebs; nie über HTTP oder Sync erreichbar. */
  adminCommand: (command: AdminCommand): AdminCommandPolicy => create({ kind: 'adminCommand', command, dimensions: [] }),
  /** Operation auf einer Ressource; die Regel ihrer Klasse aus der Matrix entscheidet. */
  resource: <E extends ResourceEntity, O extends Operation>(entity: E, operation: O) =>
    create<ResourcePolicy>({
      kind: 'resourceOperation',
      entity,
      operation,
      dimensions: resourceDimensions(entity, operation),
    }) as ResourcePolicy<E, O, DimensionsOf<E, O>>,
};

/**
 * Warum eine Policy unvollständig ist, oder `null`. Unvollständig sind fremd erzeugte Objekte und
 * Ressourcenoperationen, für die die Matrix keine Regel kennt, etwa Schreiben auf einer Projektion.
 */
export function policyProblem(policy: unknown): string | null {
  if (typeof policy !== 'object' || policy === null || !created.has(policy as Policy)) return 'keine Policy des Autorisierungsmoduls';
  const known = policy as Policy;
  if (known.kind !== 'resourceOperation') return null;
  if (!operationsOf(known.entity).includes(known.operation)) {
    return `keine Regel für ${known.operation} auf ${known.entity} (${resourceEntities[known.entity].resourceClass})`;
  }
  return null;
}
