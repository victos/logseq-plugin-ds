/**
 * Rewrite commands that cover a whole subtree send the model an outline and
 * get one back. The model is free to merge or split lines, so the reply cannot
 * be matched to the original by position alone — it has to be parsed back into
 * a tree and reconciled against the blocks that already exist.
 */

import { isFenceLine } from './block';

export interface OutlineNode {
  text: string;
  children: OutlineNode[];
}

const BULLET = /^(\s*)(?:[-*+•]\s+|\d+[.)]\s+)(.*)$/;
const INDENT = /^\s*/;

/** Width of one indent level: a tab, or two spaces. */
function depthOf(indent: string): number {
  const tabs = (indent.match(/\t/g) ?? []).length;
  const spaces = indent.replace(/\t/g, '').length;
  return tabs + Math.floor(spaces / 2);
}

interface Open {
  node: OutlineNode;
  /** The indent the line carried, and whether a bullet followed it. */
  indent: string;
  bulleted: boolean;
}

/**
 * Parses an indented outline into a tree. The first line is the root; bulleted
 * lines deeper down become its descendants. A line indented more than one level
 * past its parent is treated as one level deeper, so a model that over-indents
 * still produces a usable tree rather than nothing.
 *
 * A line with no bullet is not a point of its own but the continuation of one:
 * a block's second paragraph, or a line of a fenced code block. It is appended
 * to the nearest open node at or above its indent — the one whose continuation
 * lines it is aligned with — with blank lines between kept. Without this a
 * multi-line block would come back as one block per line.
 */
export function parseOutline(text: string): OutlineNode | null {
  let root: OutlineNode | null = null;
  // stack[d] is the latest node at depth d; a bulleted row of depth d+1 attaches to it.
  const stack: Open[] = [];
  let inFence = false;
  let fenceOwner = 0;
  let blanks = 0;

  const open = (indent: string, bulleted: boolean, body: string, depth: number) => {
    const node: OutlineNode = { text: body.trim(), children: [] };
    if (depth > 0) {
      stack[depth - 1].node.children.push(node);
    }
    stack.length = depth;
    stack.push({ node, indent, bulleted });
    if (isFenceLine(body)) {
      inFence = true;
      fenceOwner = depth;
    }
    return node;
  };

  const owner = (line: string): number => {
    // Aligned with a node's continuation lines (its indent plus the bullet's
    // width) is the reliable signal; the depth of the indent is the fallback.
    for (let i = stack.length - 1; i > 0; i--) {
      const { indent, bulleted } = stack[i];
      if (line.startsWith(bulleted ? `${indent}  ` : indent)) {
        return i;
      }
    }
    return Math.min(depthOf(INDENT.exec(line)![0]), stack.length - 1);
  };

  const append = (index: number, line: string) => {
    const { node, indent, bulleted } = stack[index];
    const prefix = bulleted ? `${indent}  ` : indent;
    const stripped = line.startsWith(prefix)
      ? line.slice(prefix.length)
      : line.startsWith(indent) ? line.slice(indent.length) : line.trimStart();
    node.text += `${'\n'.repeat(blanks + 1)}${stripped.trimEnd()}`;
    if (isFenceLine(line)) {
      inFence = !inFence;
      fenceOwner = index;
    }
  };

  for (const line of text.split('\n')) {
    if (!line.trim()) {
      if (root) blanks++;
      continue;
    }
    if (inFence && root) {
      append(fenceOwner, line);
      blanks = 0;
      continue;
    }
    const bullet = BULLET.exec(line);
    if (!root) {
      const [, indent = '', body = ''] = bullet ?? [];
      const text = bullet ? body : line;
      if (!text.trim()) continue;
      root = open(indent, Boolean(bullet), text, 0);
    } else if (bullet) {
      const [, indent, body] = bullet;
      if (body.trim()) {
        open(indent, true, body, Math.min(Math.max(depthOf(indent), 1), stack.length));
      }
    } else {
      append(owner(line), line);
    }
    blanks = 0;
  }
  return root;
}

/**
 * Renders a tree back to the outline form the model is asked to mirror, the
 * same form `blockToText` produces: continuation lines sit under their point,
 * indented past the bullet.
 */
export function renderOutline(node: OutlineNode, level = 0): string {
  const [first, ...rest] = node.text.split('\n');
  const indent = '\t'.repeat(level);
  const lines = level === 0
    ? [first, ...rest]
    : [`${indent}- ${first}`, ...rest.map((line) => `${indent}  ${line}`)];
  return [...lines, ...node.children.map((c) => renderOutline(c, level + 1))].join('\n');
}

/** An existing block, as much of it as reconciliation needs. */
export interface ExistingBlock {
  uuid: string;
  text: string;
  /**
   * True when removing this block would break a reference: something links to
   * it, or to a block below it that the model was never shown.
   */
  linked: boolean;
  children: ExistingBlock[];
}

export type Step =
  | { op: 'update'; uuid: string; text: string }
  | {
      op: 'insert';
      parent: string;
      text: string;
      children: OutlineNode[];
      /** The block this one follows; absent when the parent had no block the model saw. */
      after?: string;
    }
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
    // A surplus line goes after the block that took the line before it, so an
    // added point follows its predecessor even when the parent also holds
    // children the model was not shown.
    const after = current[shared - 1]?.uuid;
    for (const extra of next.slice(shared)) {
      steps.push({
        op: 'insert', parent, text: extra.text, children: extra.children, ...(after ? { after } : {}),
      });
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
