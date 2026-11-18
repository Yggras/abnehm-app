import { kaulquappe } from './forms/kaulquappe';
import { lagunendrache } from './forms/lagunendrache';
import { laichkugel } from './forms/laichkugel';
import type { Joint, RigForm, RigManifest, RigNode } from './types';

export type { RigManifest } from './types';

export const manifests: Readonly<Record<RigForm, RigManifest>> = { kaulquappe, lagunendrache, laichkugel };

/** Alle Knoten eines Manifests in Zeichenreihenfolge. */
export function nodesOf(manifest: RigManifest): RigNode[] {
  const nodes: RigNode[] = [];
  const visit = (joint: Joint) => {
    for (const node of joint.children) {
      nodes.push(node);
      if (node.type === 'gelenk') visit(node.joint);
    }
  };
  visit(manifest.root);
  return nodes;
}

