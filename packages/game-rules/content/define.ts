import type { FieldPlanEntry, FieldSide, OwnedFieldKind, SharedFieldKind, StageArt } from '../src/catalog.ts';

// Helfer zum Schreiben von Katalogeinträgen.

type FieldPlan = Readonly<{ kind: SharedFieldKind } | { kind: OwnedFieldKind; side: FieldSide }>;

/** Rechteckiger Block gleichartiger Felder ab (x, y), zeilenweise. */
export function rect(x: number, y: number, width: number, height: number, plan: FieldPlan): FieldPlanEntry[] {
  return Array.from({ length: width * height }, (_, index) => ({ x: x + (index % width), y: y + Math.floor(index / width), ...plan }));
}

/** Grafikschlüssel je Stufe: `‹schlüssel›_1` bis `‹schlüssel›_3`. */
export function stageArt(key: string): StageArt {
  return [`${key}_1`, `${key}_2`, `${key}_3`];
}
