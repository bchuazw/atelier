// Tree-aware auto-layout for the variant graph. Atelier's edges include
// merge contributions from a second parent, but every node has at most ONE
// `parent_id` (the merge target), so the canonical layout is a tree rooted
// at every seed.
//
// Algorithm: classic "Reingold–Tilford-lite" — recursively compute each
// subtree's width, place each child centered under its parent, and the
// subtree's left edge respects every prior child's right edge.

import type { NodeDTO } from "./api";

// Cards are 260px wide. 340 column width = 80px gap between siblings —
// roomy enough that variants don't visually crowd each other and edge
// labels have space to render. Bumped from a tight 290 (only 30px gap)
// after the canvas was reading as cramped/buggy under heavier subtrees.
const COLUMN_WIDTH = 340;
// Cards are ~280px tall (140 thumbnail + ~140 metadata + actions). 320
// row height gives ~40px vertical breathing room between parent and
// child rows, matching the same airy feel the column bump introduced.
const ROW_HEIGHT = 320;

type LayoutOut = Record<string, { x: number; y: number }>;

/**
 * Compute new positions for every node so the tree fans out evenly.
 * Returns a partial map keyed by node id; nodes whose position is
 * already correct are still included (the caller can diff before
 * sending PATCHes to avoid no-op writes).
 */
export function computeTreeLayout(nodes: NodeDTO[]): LayoutOut {
  if (nodes.length === 0) return {};

  // Group children by parent id.
  const childrenOf = new Map<string | null, NodeDTO[]>();
  for (const n of nodes) {
    const pid = n.parent_id ?? null;
    const list = childrenOf.get(pid) ?? [];
    list.push(n);
    childrenOf.set(pid, list);
  }

  // Recursive walk: returns the width of the subtree rooted at `nodeId`
  // (in columns) and writes positions along the way.
  const out: LayoutOut = {};

  function placeSubtree(node: NodeDTO, leftCol: number, depth: number): number {
    const children = childrenOf.get(node.id) ?? [];

    if (children.length === 0) {
      out[node.id] = { x: leftCol * COLUMN_WIDTH, y: depth * ROW_HEIGHT };
      return 1; // 1 column wide
    }

    // Place each child first; track total width.
    let consumed = 0;
    for (const child of children) {
      const childWidth = placeSubtree(child, leftCol + consumed, depth + 1);
      consumed += childWidth;
    }

    // Center the parent over its children's bounding box.
    const parentCol = leftCol + (consumed - 1) / 2;
    out[node.id] = { x: parentCol * COLUMN_WIDTH, y: depth * ROW_HEIGHT };
    return consumed;
  }

  // Root forest: every node whose parent_id is null OR whose parent isn't
  // in this set (orphans / archived parents) is treated as a root.
  const idSet = new Set(nodes.map((n) => n.id));
  const roots = nodes.filter((n) => !n.parent_id || !idSet.has(n.parent_id));

  let leftCol = 0;
  for (const r of roots) {
    const rootWidth = placeSubtree(r, leftCol, 0);
    leftCol += rootWidth + 1; // 1-column gap between disconnected roots
  }

  return out;
}

/**
 * Returns only the nodes whose position would actually change beyond a
 * tiny tolerance — saves a wave of PATCH /nodes/:id calls when the user
 * hits Tidy on an already-clean canvas.
 */
export function diffPositions(
  nodes: NodeDTO[],
  next: LayoutOut,
  epsilon = 0.5
): { id: string; x: number; y: number }[] {
  const result: { id: string; x: number; y: number }[] = [];
  for (const n of nodes) {
    const target = next[n.id];
    if (!target) continue;
    if (
      Math.abs(target.x - n.position.x) > epsilon ||
      Math.abs(target.y - n.position.y) > epsilon
    ) {
      result.push({ id: n.id, x: target.x, y: target.y });
    }
  }
  return result;
}
