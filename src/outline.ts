/**
 * Rewrite commands that cover a whole subtree send the model an outline and
 * get one back. The model is free to merge or split lines, so the reply cannot
 * be matched to the original by position alone — it has to be parsed back into
 * a tree and reconciled against the blocks that already exist.
 */

import { FenceRole, fenceMarker, fenceRoles } from './block';

export interface OutlineNode {
  text: string;
  children: OutlineNode[];
}

const BULLET = /^(\s*)(?:[-*+•]\s+|\d+[.)]\s+)(.*)$/;
// The root line is the block's own text, verbatim. A model that bullets the
// whole reply leads it with "- ", which is dropped; a number ("1. First step")
// is what the block says and stays.
const ROOT_BULLET = /^(\s*)[-*+•]\s+(.*)$/;
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

export interface ParseOptions {
  /**
   * Take a reply that is nothing but one ```markdown … ``` block as the
   * outline inside it. Models wrap output that way often; taken literally it
   * would make the block a code block holding the whole outline and delete
   * every child. Off when the block being rewritten is itself a code block,
   * where a fenced reply is exactly what was asked for. A wrapper opened and
   * never closed is dropped either way — see {@link unwrapped}.
   */
  unwrapFence?: boolean;
}

const WRAPPER_OPEN = /^(`{3,}|~{3,})\s*(?:markdown|md|text|txt|plaintext)?\s*$/i;
const WRAPPER_CLOSE = /^(`{3,}|~{3,})\s*$/;

const bulletless = (line: string) => line.replace(BULLET, '$2');
// A sub-point as `blockToText` renders one; code inside a block never has this shape.
const OUTLINE_POINT = /^\t+(?:[-*+•]\s|\d+[.)]\s)/;

/**
 * The lines of a reply without a code fence wrapped around all of it. A bare
 * (or `markdown`) opener on the first line, unindented, is the candidate; what
 * it is depends on what it would pair with, because the outline inside may
 * hold fences of its own:
 *
 * - The last line is a bare closer that pairs with nothing inside the content:
 *   that is the wrapper's closer, and both go — unless `closed` is false,
 *   which says the block being rewritten is itself a code block, so a fully
 *   fenced reply is its content and stays.
 * - Otherwise the reply is read as it stands. If that reading has a fence
 *   swallow a sub-point, or leaves a marker unpaired, the opener has no
 *   closer of its own (a reply cut short, or the model forgot) and goes
 *   alone; left in place it would take every point up to the next fence into
 *   the block as code, and shift every fence after it. Unless the reading
 *   without the opener swallows a sub-point itself — then the fault lies
 *   elsewhere in the reply, and the opener stays.
 * - An opener that pairs with nothing at all is a stray wrapper on a prose
 *   block and goes; on a code block it is the block's own text — as is one
 *   that pairs with the block's own closer, whatever else in the reply is
 *   left unpaired.
 * - Anything else — an empty code block at the top, say — is content.
 */
function unwrapped(lines: string[], closed: boolean): string[] {
  const first = lines.findIndex((line) => line.trim());
  if (first === -1) return lines;
  const opener = WRAPPER_OPEN.exec(lines[first]);
  if (!opener) return lines;
  const content = lines.slice(first + 1);
  const inner = fenceRoles(content, bulletless);
  const last = content.length - 1 - [...content].reverse().findIndex((line) => line.trim());
  const closer = last >= 0 ? WRAPPER_CLOSE.exec(content[last]) : null;
  const closes = closer !== null && closer[1][0] === opener[1][0] && closer[1].length >= opener[1].length;
  if (closes && inner[last] === 'text') {
    return closed ? content.slice(0, last) : lines;
  }
  const outer = fenceRoles(lines, bulletless);
  if (outer[first] !== 'open') {
    return closed ? content : lines;
  }
  // On a code block the opener pairs with the block's own closer: it is the
  // block's text, whatever a spoiled fence further down leaves unpaired.
  if (!closed) return lines;
  const swallows = (rows: string[], roles: FenceRole[]) =>
    rows.some((line, i) => roles[i] === 'code' && OUTLINE_POINT.test(line));
  const unpaired = lines.some((line, i) => outer[i] === 'text' && fenceMarker(bulletless(line)) !== undefined);
  if (!swallows(lines, outer) && !unpaired) return lines;
  return swallows(content, inner) ? lines : content;
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
 *
 * A bulleted line can be a continuation too: a Markdown list inside one block.
 * `blockToText` indents a point's continuation lines with its tabs plus two
 * spaces, and a sub-point with tabs only, so in a tab-indented outline a bullet
 * whose indent ends in spaces — or that has no indent at all, under a root
 * with none — is a line of the point above it, not a point of its own. An
 * outline indented with spaces alone cannot tell the two apart, and there the
 * bullet is a point, as before.
 */
export function parseOutline(text: string, options: ParseOptions = {}): OutlineNode | null {
  let root: OutlineNode | null = null;
  // stack[d] is the latest node at depth d; a bulleted row of depth d+1 attaches to it.
  const stack: Open[] = [];
  let fenceOwner = 0;
  let blanks = 0;

  const raw = text.replace(/\r\n?/g, '\n').split('\n');
  const lines = unwrapped(raw, options.unwrapFence ?? false);
  // A point's fence opens on its bullet line, so the bullet is looked past.
  // And a fence inside a sub-point stops at the next point, at any depth:
  // code under a point at depth d is indented d tabs and two spaces, so a
  // bullet led by tabs alone — fewer, as many, or more — cannot be a line of
  // it. Without this a closing fence the model spoiled ("``` and so on")
  // would run into the next fence below, in a sibling or in a sub-point, and
  // take every point in between with it as code.
  const roles = fenceRoles(lines, bulletless, (opener, line) => {
    const depth = (INDENT.exec(opener)![0].match(/\t/g) ?? []).length;
    return depth >= 1 && /^\t*(?:[-*+•]\s|\d+[.)]\s)/.test(line);
  });
  const tabbed = lines.some((line) => line.startsWith('\t'));

  const open = (indent: string, bulleted: boolean, body: string, depth: number, role: FenceRole) => {
    const node: OutlineNode = { text: body.trim(), children: [] };
    if (depth > 0) {
      stack[depth - 1].node.children.push(node);
    }
    stack.length = depth;
    stack.push({ node, indent, bulleted });
    if (role === 'open') {
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

  const append = (index: number, line: string, role: FenceRole) => {
    const { node, indent, bulleted } = stack[index];
    const prefix = bulleted ? `${indent}  ` : indent;
    const stripped = line.startsWith(prefix)
      ? line.slice(prefix.length)
      : line.startsWith(indent) ? line.slice(indent.length) : line.trimStart();
    node.text += `${'\n'.repeat(blanks + 1)}${stripped.trimEnd()}`;
    if (role === 'open') {
      fenceOwner = index;
    }
  };

  // The open point whose continuation lines a bulleted line is aligned with,
  // when the outline's indentation says it is one of those and not a sub-point.
  const listOwner = (indent: string): number | undefined => {
    if (!tabbed) return undefined;
    if (indent === '') return stack[0].bulleted ? undefined : 0;
    if (!indent.includes('\t') || !indent.endsWith(' ')) return undefined;
    for (let i = stack.length - 1; i > 0; i--) {
      const { indent: own, bulleted } = stack[i];
      if (indent.startsWith(bulleted ? `${own}  ` : own)) return i;
    }
    return undefined;
  };

  lines.forEach((line, i) => {
    const role = roles[i];
    if (!line.trim()) {
      if (root) blanks++;
      return;
    }
    if (root && (role === 'code' || role === 'close')) {
      append(fenceOwner, line, role);
      blanks = 0;
      return;
    }
    if (!root) {
      const bullet = ROOT_BULLET.exec(line);
      const [, indent = '', body = ''] = bullet ?? [];
      const text = bullet ? body : line;
      if (!text.trim()) return;
      root = open(indent, Boolean(bullet), text, 0, role);
      blanks = 0;
      return;
    }
    const bullet = BULLET.exec(line);
    if (bullet) {
      const [, indent, body] = bullet;
      const list = listOwner(indent);
      if (list !== undefined) {
        append(list, line, role);
      } else if (body.trim()) {
        open(indent, true, body, Math.min(Math.max(depthOf(indent), 1), stack.length), role);
      }
    } else {
      append(owner(line), line, role);
    }
    blanks = 0;
  });
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
