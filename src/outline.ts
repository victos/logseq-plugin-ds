/**
 * Rewrite commands that cover a whole subtree send the model an outline and
 * get one back. The model is free to merge or split lines, so the reply cannot
 * be matched to the original by position alone — it has to be parsed back into
 * a tree and reconciled against the blocks that already exist.
 */

export interface OutlineNode {
  text: string;
  children: OutlineNode[];
}

const BULLET = /^(\s*)(?:[-*+•]\s+|\d+[.)]\s+)?(.*)$/;

/** Width of one indent level: a tab, or two spaces. */
function depthOf(indent: string): number {
  const tabs = (indent.match(/\t/g) ?? []).length;
  const spaces = indent.replace(/\t/g, '').length;
  return tabs + Math.floor(spaces / 2);
}

/**
 * Parses an indented outline into a tree. The first line is the root; deeper
 * lines become its descendants. A line indented more than one level past its
 * parent is treated as one level deeper, so a model that over-indents still
 * produces a usable tree rather than nothing.
 */
export function parseOutline(text: string): OutlineNode | null {
  const rows: Array<{ depth: number; text: string }> = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) {
      continue;
    }
    const [, indent = '', body = ''] = BULLET.exec(line) ?? [];
    if (body.trim()) {
      rows.push({ depth: depthOf(indent), text: body.trim() });
    }
  }
  if (rows.length === 0) {
    return null;
  }

  const root: OutlineNode = { text: rows[0].text, children: [] };
  // stack[i] is the node that a row of depth i+1 attaches to.
  const stack: OutlineNode[] = [root];
  for (const row of rows.slice(1)) {
    const depth = Math.min(Math.max(row.depth, 1), stack.length);
    const node: OutlineNode = { text: row.text, children: [] };
    stack[depth - 1].children.push(node);
    stack.length = depth;
    stack.push(node);
  }
  return root;
}

/** Renders a tree back to the outline form the model is asked to mirror. */
export function renderOutline(node: OutlineNode, level = 0): string {
  const line = level === 0 ? node.text : `${'\t'.repeat(level)}- ${node.text}`;
  return [line, ...node.children.map((c) => renderOutline(c, level + 1))].join('\n');
}

/** An existing block, as much of it as reconciliation needs. */
export interface ExistingBlock {
  uuid: string;
  text: string;
  /** True when something links to this block, so deleting it would break a reference. */
  linked: boolean;
  children: ExistingBlock[];
}

export type Step =
  | { op: 'update'; uuid: string; text: string }
  | { op: 'insert'; parent: string; text: string; children: OutlineNode[] }
  | { op: 'remove'; uuid: string }
  | { op: 'keep'; uuid: string; reason: 'linked' };

/**
 * Matches a rewritten tree onto the blocks that exist, positionally.
 *
 * Overlapping positions are updated in place so uuids — and therefore block
 * references, properties and any `id::` — survive. Surplus rewritten lines are
 * inserted. Surplus existing blocks are removed, except where something links
 * to them: deleting those would break the link permanently, so they are kept
 * and reported instead.
 */
export function planRewrite(root: string, rewritten: OutlineNode, existing: ExistingBlock[]): Step[] {
  const steps: Step[] = [{ op: 'update', uuid: root, text: rewritten.text }];

  const walk = (parent: string, next: OutlineNode[], current: ExistingBlock[]) => {
    const shared = Math.min(next.length, current.length);
    for (let i = 0; i < shared; i++) {
      steps.push({ op: 'update', uuid: current[i].uuid, text: next[i].text });
      walk(current[i].uuid, next[i].children, current[i].children);
    }
    for (const extra of next.slice(shared)) {
      steps.push({ op: 'insert', parent, text: extra.text, children: extra.children });
    }
    for (const surplus of current.slice(shared)) {
      pruneOrKeep(surplus);
    }
  };

  const pruneOrKeep = (block: ExistingBlock) => {
    // A linked block keeps its whole subtree: removing a parent takes the
    // descendants with it, and one of those may be linked too.
    if (block.linked || hasLinkedDescendant(block)) {
      steps.push({ op: 'keep', uuid: block.uuid, reason: 'linked' });
      return;
    }
    steps.push({ op: 'remove', uuid: block.uuid });
  };

  walk(root, rewritten.children, existing);
  return steps;
}

function hasLinkedDescendant(block: ExistingBlock): boolean {
  return block.children.some((child) => child.linked || hasLinkedDescendant(child));
}
