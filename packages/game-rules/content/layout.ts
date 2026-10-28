import type { FieldPlanEntry, FieldSide, OwnedFieldKind, SharedFieldKind } from '../src/catalog.ts';

type FieldPlan = Readonly<{ kind: SharedFieldKind } | { kind: OwnedFieldKind; side: FieldSide }>;

/** Rechteckiger Block gleichartiger Felder ab (x, y), zeilenweise. */
export function rect(x: number, y: number, width: number, height: number, plan: FieldPlan): FieldPlanEntry[] {
  return Array.from({ length: width * height }, (_, index) => ({ x: x + (index % width), y: y + Math.floor(index / width), ...plan }));
}
