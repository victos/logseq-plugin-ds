/**
 * Property-based harness over the note-writing pipeline.
 *
 * A seeded generator builds a block tree out of the features that have
 * produced bugs (empty and whitespace text, property lines, hidden built-ins,
 * fences, in-block lists, tables, quotes, tagged subtrees, linked blocks),
 * drives the real `FileGraphOps` / `DbGraphOps` against an in-memory graph
 * with the same command sequences `main.ts` would issue, and checks invariants
 * that must hold whatever the model replied. Failures are shrunk to a minimal
 * case before being reported, so the assertion message is a reproduction.
 *
 * Deterministic: every case is a function of its seed. `FUZZ_CASES` raises the
 * count for a longer search.
 */
import { describe, expect, it } from 'vitest';
import { DbGraphOps, EditorApi, FileGraphOps, BlockOps, dbText } from '../src/graph';
import {
  closeFences,
  fenceRoles,
  fileText,
  hasTag,
  isFenceLine,
  propertyLineKey,
  splitProperties,
  stripTag,
  withTag,
  isHiddenProperty,
} from '../src/block';
import { OutlineNode, parseOutline, renderOutline } from '../src/outline';

// ---------------------------------------------------------------- randomness

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class Rng {
  private readonly next: () => number;
  constructor(seed: number) {
    this.next = mulberry32(seed);
  }
  int(n: number): number {
    return Math.floor(this.next() * n);
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
  pick<T>(items: readonly T[]): T {
    return items[this.int(items.length)];
  }
}

// ------------------------------------------------------------------ the case

type Backend = 'file' | 'db';

interface GenBlock {
  /** Prose lines (may contain fence markers, list markers, the tag). */
  body: string[];
  /** Property lines, `key:: value`. `id::` marks a linked block on a file graph. */
  props: string[];
  /** Where the property lines sit inside `content` (file graphs only). */
  layout: 'logseq' | 'end';
  children: GenBlock[];
}

type ReplyKind =
  | 'identity' // the outline exactly as sent
  | 'edit' // same shape, every point's text marked
  | 'drop' // one point removed
  | 'add' // one point added
  | 'merge' // two sibling points merged into one
  | 'split' // one point split into two
  | 'chatter' // preamble line before the outline
  | 'fenced' // whole reply wrapped in a code fence
  | 'spaces' // indented with two spaces per level instead of tabs
  | 'stars' // `*` bullets
  | 'numbered' // `1.` bullets
  | 'crlf' // CRLF line endings
  | 'props' // a `key:: value` line echoed inside a point
  | 'blank' // nothing but whitespace
  | 'fence-only' // a lone fence line
  | 'unclosed'; // a fence opened and never closed

type Command =
  | { kind: 'replace'; reply: ReplyKind; twice: boolean }
  | { kind: 'append'; text: string }
  | { kind: 'property'; key: string; value: string }
  | { kind: 'insert'; items: string[] };

interface Case {
  seed: number;
  backend: Backend;
  tag: string;
  /** Sibling before and after the root, to check nothing outside is touched. */
  before: GenBlock;
  root: GenBlock;
  after: GenBlock;
  editing: 'none' | 'faithful' | 'typing';
  commands: Command[];
}

const TAGS = [' #[[🤖]]', ' #ai', ''];

const PROSE = [
  'Hello',
  'Second line',
  'std::vector note',
  'a::b',
  'Meeting notes',
  'Churn rose 5% [[Q3]]',
  '- item',
  '* item',
  '1. step',
  '2) step',
  '| a | b |',
  '|---|---|',
  '> quote',
  '#+BEGIN_QUOTE',
  '$$x$$',
  '```',
  '```js',
  '~~~',
  'code line',
  '```x```',
  '   ',
  '',
  'Trailing space   ',
  '# Heading',
  'TODO write it',
  '#tag-like words #AI-notes',
];

const PROPS = [
  'id:: ',
  'collapsed:: true',
  'heading:: 2',
  'owner:: alice',
  'Owner:: bob',
  'tags:: x, y',
  'created-at:: 123',
  'logseq.order-list-type:: number',
  'card-last-score:: 5',
  'key::',
];

function genBody(r: Rng, tag: string, tagged: boolean): string[] {
  const n = r.pick([0, 1, 1, 2, 3, 4]);
  const lines: string[] = [];
  for (let i = 0; i < n; i++) lines.push(r.pick(PROSE));
  if (r.chance(0.15)) {
    // A closed fence around whatever is there.
    lines.unshift(r.pick(['```', '```py', '~~~']));
    lines.push('```');
  }
  if (tagged && tag) {
    const last = lines[lines.length - 1];
    if (lines.length && r.chance(0.7) && !isFenceLine(last) && !propertyLineKey(last)) lines[lines.length - 1] += tag;
    else lines.push(tag.trim());
  }
  return lines;
}

function genBlock(r: Rng, tag: string, uuid: () => string, depth: number, canTag: boolean): GenBlock {
  const kind = r.pick(['text', 'text', 'text', 'empty', 'blank', canTag ? 'tagged' : 'text']);
  const tagged = kind === 'tagged';
  const body = kind === 'empty' ? [] : kind === 'blank' ? ['   '] : genBody(r, tag, tagged);
  const props: string[] = [];
  const np = r.pick([0, 0, 0, 1, 1, 2, 3]);
  const id = uuid();
  for (let i = 0; i < np; i++) {
    const p = r.pick(PROPS);
    props.push(p === 'id:: ' ? `id:: ${id}` : p);
  }
  const children: GenBlock[] = [];
  if (depth < 3) {
    const nc = r.pick([0, 0, 1, 1, 2, 3]);
    for (let i = 0; i < nc; i++) children.push(genBlock(r, tag, uuid, depth + 1, canTag));
  }
  return { body, props, layout: r.chance(0.8) ? 'logseq' : 'end', children };
}

function genCommand(r: Rng, tag: string): Command {
  const kinds: ReplyKind[] = [
    'identity', 'identity', 'edit', 'edit', 'drop', 'add', 'merge', 'split', 'chatter',
    'fenced', 'spaces', 'stars', 'numbered', 'crlf', 'props', 'blank', 'fence-only', 'unclosed',
  ];
  switch (r.int(6)) {
    case 0:
    case 1:
    case 2:
      return { kind: 'replace', reply: r.pick(kinds), twice: r.chance(0.5) };
    case 3:
      return { kind: 'append', text: r.pick(['more', 'line1\nline2', '```\ncode\n```', tag.trim() || 'x', '']) };
    case 4:
      return { kind: 'property', key: r.pick(['summarize', 'ask-ai', 'owner']), value: r.pick(['v', 'a\nb', 'x:: y', '']) };
    default:
      return { kind: 'insert', items: r.pick([['one'], ['a', 'b'], ['```\ncode\n```'], []]) };
  }
}

function genCase(seed: number): Case {
  const r = new Rng(seed);
  let n = 0;
  const uuid = () => `b${++n}`;
  const tag = r.pick(TAGS);
  const size = 1 + Math.min(3, Math.floor(seed / 400));
  const commands: Command[] = [];
  for (let i = 0; i < 1 + r.int(size); i++) commands.push(genCommand(r, tag));
  return {
    seed,
    backend: r.chance(0.5) ? 'file' : 'db',
    tag,
    before: genBlock(r, tag, uuid, 2, true),
    root: genBlock(r, tag, uuid, 0, true),
    after: genBlock(r, tag, uuid, 2, true),
    editing: r.pick(['none', 'none', 'faithful', 'typing']),
    commands,
  };
}

// --------------------------------------------------------- in-memory graph

interface Node {
  uuid: string;
  /** File graph: the whole markdown string. */
  content: string;
  /** DB graph: the prose. */
  title: string;
  /** DB graph: separate property entities. */
  props: Record<string, string>;
  children: Node[];
  parent: Node | null;
}

interface Snapshot {
  uuid: string;
  content: string;
  title: string;
  props: Record<string, string>;
  parent: string | null;
  children: string[];
}

function fileContent(block: GenBlock): string {
  const body = block.body;
  if (block.props.length === 0) return body.join('\n');
  if (block.layout === 'end' || body.length === 0) return [...body, ...block.props].join('\n');
  const [first, ...rest] = body;
  return [first, ...block.props, ...rest].join('\n');
}

class Graph implements EditorApi {
  readonly nodes = new Map<string, Node>();
  readonly roots: Node[] = [];
  private counter = 0;
  editing: string | false = false;
  buffer = '';
  readonly log: string[] = [];

  constructor(readonly backend: Backend) {}

  add(block: GenBlock, parent: Node | null, uuid: string): Node {
    const props: Record<string, string> = {};
    for (const line of block.props) {
      const key = propertyLineKey(line);
      if (key) props[key] = line.slice(line.indexOf('::') + 2).trim();
    }
    const node: Node = {
      uuid,
      content: fileContent(block),
      title: block.body.join('\n'),
      props,
      children: [],
      parent,
    };
    this.nodes.set(uuid, node);
    (parent ? parent.children : this.roots).push(node);
    return node;
  }

  private serialize(node: Node, deep: boolean): Record<string, unknown> {
    const out: Record<string, unknown> = { uuid: node.uuid };
    if (this.backend === 'file') {
      out.content = node.content;
    } else {
      out.title = node.title;
      out.properties = { ...node.props };
    }
    out.children = deep
      ? node.children.map((c) => this.serialize(c, true))
      : node.children.map((c) => [':uuid', c.uuid]);
    return out;
  }

  async getBlock(uuid: string, opts?: { includeChildren?: boolean }) {
    const node = this.nodes.get(uuid);
    return node ? this.serialize(node, Boolean(opts?.includeChildren)) : null;
  }

  async updateBlock(uuid: string, content: string) {
    const node = this.nodes.get(uuid);
    if (!node) throw new Error(`updateBlock: no block ${uuid}`);
    this.log.push(`update ${uuid} ${JSON.stringify(content)}`);
    if (this.backend === 'file') node.content = content;
    else node.title = content;
  }

  async insertBlock(uuid: string, content: string, opts?: Record<string, unknown>) {
    const target = this.nodes.get(uuid);
    if (!target) throw new Error(`insertBlock: no block ${uuid}`);
    const fresh: Node = {
      uuid: `n${++this.counter}`,
      content: this.backend === 'file' ? content : '',
      title: this.backend === 'db' ? content : '',
      props: {},
      children: [],
      parent: null,
    };
    this.log.push(`insert ${opts?.sibling ? 'after' : 'under'} ${uuid} ${JSON.stringify(content)} -> ${fresh.uuid}`);
    if (opts?.sibling) {
      const siblings = target.parent ? target.parent.children : this.roots;
      siblings.splice(siblings.indexOf(target) + 1, 0, fresh);
      fresh.parent = target.parent;
    } else {
      target.children.push(fresh);
      fresh.parent = target;
    }
    this.nodes.set(fresh.uuid, fresh);
    return { uuid: fresh.uuid, content };
  }

  async removeBlock(uuid: string) {
    const node = this.nodes.get(uuid);
    if (!node) throw new Error(`removeBlock: no block ${uuid}`);
    this.log.push(`remove ${uuid}`);
    const siblings = node.parent ? node.parent.children : this.roots;
    siblings.splice(siblings.indexOf(node), 1);
    const drop = (n: Node) => {
      this.nodes.delete(n.uuid);
      n.children.forEach(drop);
    };
    drop(node);
  }

  async checkEditing() {
    return this.editing;
  }

  async getEditingBlockContent() {
    return this.buffer;
  }

  async upsertProperty() {
    return null;
  }

  async upsertBlockProperty(uuid: string, key: string, value: unknown) {
    const node = this.nodes.get(uuid);
    if (!node) throw new Error(`upsertBlockProperty: no block ${uuid}`);
    this.log.push(`prop ${uuid} ${key}=${JSON.stringify(value)}`);
    node.props[key] = String(value);
  }

  snapshot(): Map<string, Snapshot> {
    const out = new Map<string, Snapshot>();
    for (const node of this.nodes.values()) {
      out.set(node.uuid, {
        uuid: node.uuid,
        content: node.content,
        title: node.title,
        props: { ...node.props },
        parent: node.parent?.uuid ?? null,
        children: node.children.map((c) => c.uuid),
      });
    }
    return out;
  }

  /** The block's prose, the way the adapter under test reads it. */
  text(s: Snapshot): string {
    return this.backend === 'file' ? fileText({ content: s.content }) : dbText({ title: s.title });
  }

  /** Property lines (file) or entries (db), as a sorted list of strings. */
  properties(s: Snapshot): string[] {
    if (this.backend === 'file') return [...splitProperties(s.content).properties].sort();
    return Object.entries(s.props).map(([k, v]) => `${k}:: ${v}`).sort();
  }

  /** The editor buffer Logseq would show for this block. */
  bufferFor(uuid: string, typing: boolean): string {
    const node = this.nodes.get(uuid)!;
    let text: string;
    if (this.backend === 'db') {
      text = node.title;
    } else {
      const { body, properties } = splitProperties(node.content);
      const visible = properties.filter((p) => !isHiddenProperty(propertyLineKey(p) ?? ''));
      const typed = typing ? typeInto(body) : body;
      return visible.length ? `${typed}\n${visible.join('\n')}` : typed;
    }
    return typing ? typeInto(text) : text;
  }
}

/** The user typing a word onto the first line of the text they see. */
function typeInto(text: string): string {
  const [first = '', ...rest] = text.split('\n');
  return [`${first} typed`.trim(), ...rest].join('\n');
}

function build(c: Case): { graph: Graph; ops: BlockOps; root: string } {
  const graph = new Graph(c.backend);
  let n = 0;
  const uuid = () => `b${++n}`;
  const add = (block: GenBlock, parent: Node | null): Node => {
    const node = graph.add(block, parent, uuid());
    for (const child of block.children) add(child, node);
    return node;
  };
  add(c.before, null);
  const root = add(c.root, null);
  add(c.after, null);
  const ops = c.backend === 'file' ? new FileGraphOps(graph) : new DbGraphOps(graph);
  return { graph, ops, root: root.uuid };
}

// ------------------------------------------------------------- model replies

function mapTree(node: OutlineNode, f: (n: OutlineNode, depth: number) => OutlineNode[], depth = 0): OutlineNode[] {
  return f({ ...node, children: node.children.flatMap((c) => mapTree(c, f, depth + 1)) }, depth);
}

/** `f` applied to every line that is not part of fenced code. */
function outsideFences(text: string, f: (line: string) => string): string {
  const lines = text.split('\n');
  const roles = fenceRoles(lines, (line) => line.replace(/^(\s*)(?:[-*+•]\s+|\d+[.)]\s+)/, ''));
  return lines.map((line, i) => (roles[i] === 'text' ? f(line) : line)).join('\n');
}

function mark(text: string): string {
  const [first, ...rest] = text.split('\n');
  return /^\s*(```|~~~|\||>|[-*+]\s|\d+[.)]\s)/.test(first) ? text : [`R: ${first}`, ...rest].join('\n');
}

/** How every point's text changes under a shape-preserving `edit` reply. */
export const EDIT = mark;

function reply(kind: ReplyKind, context: string): string {
  const tree = parseOutline(context);
  if (!tree) return context;
  const render = (t: OutlineNode) => renderOutline(t);
  switch (kind) {
    case 'identity':
      return context;
    case 'edit':
      return render(mapTree(tree, (n) => [{ ...n, text: mark(n.text) }])[0]);
    case 'drop': {
      let dropped = false;
      return render(
        mapTree(tree, (n, d) => {
          if (d > 0 && !dropped) {
            dropped = true;
            return [];
          }
          return [n];
        })[0],
      );
    }
    case 'add':
      return `${render(tree)}\n\t- Added point`;
    case 'merge': {
      const t = { ...tree, children: [...tree.children] };
      if (t.children.length >= 2) {
        const [a, b, ...rest] = t.children;
        t.children = [{ text: `${a.text} ${b.text.split('\n')[0]}`, children: [...a.children, ...b.children] }, ...rest];
      }
      return render(t);
    }
    case 'split': {
      const t = { ...tree, children: [...tree.children] };
      if (t.children.length >= 1) {
        const [a, ...rest] = t.children;
        t.children = [{ text: a.text, children: [] }, { text: 'Split off', children: a.children }, ...rest];
      }
      return render(t);
    }
    case 'chatter':
      return `Here is the rewritten text:\n\n${render(tree)}`;
    case 'fenced':
      return `\`\`\`markdown\n${render(tree)}\n\`\`\``;
    case 'spaces':
      return render(tree).replace(/^\t+/gm, (m) => '  '.repeat(m.length));
    case 'stars':
      return outsideFences(render(tree), (line) => line.replace(/^(\t+)- /, '$1* '));
    case 'numbered':
      return outsideFences(render(tree), (line) => line.replace(/^(\t+)- /, '$11. '));
    case 'crlf':
      return render(tree).replace(/\n/g, '\r\n');
    case 'props':
      return render(mapTree(tree, (n) => [{ ...n, text: `${n.text}\nowner:: model` }])[0]);
    case 'blank':
      return '  \n\n';
    case 'fence-only':
      return '```';
    case 'unclosed':
      return `\`\`\`\n${render(tree)}`;
  }
  return context;
}

// -------------------------------------------------------------- the driver

/** What `runPrompt` in main.ts does around `rewriteSubtree`. */
async function runReplace(ops: BlockOps, uuid: string, tag: string, text: string) {
  const content = stripTag(await ops.readContext(uuid, tag), tag).trim();
  if (!content) return { skipped: 'empty' as const };
  const own = await ops.readText(uuid);
  if (!stripTag(own ?? '', tag).trim()) return { skipped: 'no-own-text' as const };
  return { kept: await ops.rewriteSubtree(uuid, text, tag), context: content };
}

class Failure extends Error {
  constructor(readonly invariant: string, message: string) {
    super(`${invariant}: ${message}`);
  }
}

/** Text up to what a rewrite may legitimately change: the tag, blank lines, a closing fence. */
function norm(text: string, tag: string): string {
  const lines = stripTag(text, tag).split('\n').map((l) => l.trimEnd()).filter((l) => l).join('\n').trim();
  return lines ? closeFences(lines) : lines;
}

function subtree(snap: Map<string, Snapshot>, uuid: string): Set<string> {
  const out = new Set<string>();
  const walk = (id: string) => {
    out.add(id);
    snap.get(id)?.children.forEach(walk);
  };
  walk(uuid);
  return out;
}

/** Blocks under `root` the model was shown, and the ones it was not (tagged subtrees). */
function seenAndUnseen(g: Graph, snap: Map<string, Snapshot>, root: string, tag: string) {
  const seen = new Set<string>();
  const unseen = new Set<string>();
  const walk = (id: string, hidden: boolean) => {
    const s = snap.get(id)!;
    const isTagged = id !== root && hasTag(g.text(s), tag);
    const h = hidden || isTagged;
    (h ? unseen : seen).add(id);
    s.children.forEach((c) => walk(c, h));
  };
  walk(root, false);
  return { seen, unseen };
}

function isLinked(g: Graph, s: Snapshot): boolean {
  return g.backend === 'db' || g.properties(s).some((p) => propertyLineKey(p) === 'id');
}

function checkCommon(
  g: Graph,
  before: Map<string, Snapshot>,
  after: Map<string, Snapshot>,
  root: string,
  tag: string,
  cmd: Command,
) {
  const inside = subtree(before, root);
  // Nothing outside the subtree changes.
  for (const [id, s] of before) {
    if (inside.has(id)) continue;
    const a = after.get(id);
    if (!a) throw new Failure('outside-untouched', `${id} outside the subtree was removed`);
    if (JSON.stringify(a) !== JSON.stringify(s)) {
      throw new Failure('outside-untouched', `${id} outside the subtree changed: ${JSON.stringify(s)} -> ${JSON.stringify(a)}`);
    }
  }
  const { unseen } = seenAndUnseen(g, before, root, tag);
  for (const id of inside) {
    const s = before.get(id)!;
    if (after.has(id)) continue;
    if (isLinked(g, s)) throw new Failure('linked-kept', `${id} is linked (${g.properties(s).join(', ')}) but was removed`);
    // The plugin's own tagged output may go with the point it answered; a note of the user's under it may not.
    if (unseen.has(id) && !hasTag(g.text(s), tag) && g.text(s)) {
      throw new Failure('unseen-kept', `${id} was never shown to the model (under a tagged block) and was removed`);
    }
  }
  for (const id of inside) {
    const s = before.get(id)!;
    const a = after.get(id);
    if (!a) continue;
    // Properties survive on every block that survives.
    const pb = g.properties(s);
    const pa = g.properties(a);
    const isTarget = id === root && cmd.kind === 'property';
    const missing = pb.filter((p) => !pa.includes(p) && !(isTarget && propertyLineKey(p) === cmd.key));
    if (missing.length) throw new Failure('properties-kept', `${id} lost properties ${JSON.stringify(missing)}: ${JSON.stringify(pb)} -> ${JSON.stringify(pa)}`);
    const idsBefore = pb.filter((p) => propertyLineKey(p) === 'id');
    const idsAfter = pa.filter((p) => propertyLineKey(p) === 'id');
    if (JSON.stringify(idsBefore) !== JSON.stringify(idsAfter)) {
      throw new Failure('id-kept', `${id}: id properties changed ${JSON.stringify(idsBefore)} -> ${JSON.stringify(idsAfter)}`);
    }
    if (a.parent !== s.parent) throw new Failure('not-moved', `${id} moved from ${s.parent} to ${a.parent}`);
    // Unseen blocks are not rewritten.
    if (unseen.has(id) && (a.content !== s.content || a.title !== s.title)) {
      throw new Failure('unseen-kept', `${id} was never shown to the model but was rewritten: ${JSON.stringify(s)} -> ${JSON.stringify(a)}`);
    }
    if (id !== root && !unseen.has(id) && tag && !hasTag(g.text(s), tag) && hasTag(g.text(a), tag)) {
      throw new Failure('tag-on-root-only', `${id} gained the tag: ${JSON.stringify(g.text(a))}`);
    }
  }
  // Tag appears once on the root, never doubled.
  if (tag) {
    const count = (t: string) => t.split(tag.trim()).length - 1;
    const rb = before.get(root)!;
    const ra = after.get(root);
    const added = cmd.kind === 'append' ? count(cmd.text) : cmd.kind === 'property' ? count(cmd.value) : 0;
    if (ra && count(g.text(ra)) > Math.max(1, count(g.text(rb))) + added) {
      throw new Failure('tag-once', `root carries the tag ${count(g.text(ra))} times: ${JSON.stringify(g.text(ra))}`);
    }
  }
}

/** Runs one case, throwing a Failure describing the first broken invariant. */
async function run(c: Case): Promise<void> {
  const { graph: g, ops, root } = build(c);
  const setEditing = () => {
    if (c.editing === 'none' || !g.nodes.has(root)) {
      g.editing = false;
      return;
    }
    g.editing = root;
    g.buffer = g.bufferFor(root, c.editing === 'typing');
  };

  for (const cmd of c.commands) {
    setEditing();
    const before = g.snapshot();
    // What the plugin sees as the root's text right now (buffer included).
    const rootText = (await ops.readText(root)) ?? '';
    // The buffer is what the user had typed when the command ran; once the
    // plugin has written the block, Logseq's editor shows the written text.
    const editingOff = () => {
      g.editing = false;
    };
    g.log.length = 0;
    switch (cmd.kind) {
      case 'append':
        await ops.appendText(root, cmd.text, c.tag);
        break;
      case 'property':
        await ops.setProperty(root, cmd.key, cmd.value, c.tag);
        break;
      case 'insert':
        for (const item of cmd.items) await ops.insertChild(root, withTag(item, c.tag));
        break;
      case 'replace': {
        const context = stripTag(await ops.readContext(root, c.tag), c.tag).trim();
        const text = reply(cmd.reply, context);
        let result;
        try {
          result = await runReplace(ops, root, c.tag, text);
          editingOff();
        } catch (error) {
          editingOff();
          // An unparseable reply is a refusal, not a write; nothing may have changed.
          if (JSON.stringify([...g.snapshot()]) !== JSON.stringify([...before])) {
            throw new Failure('atomic', `threw "${(error as Error).message}" after writing ${g.log.join('; ')}`);
          }
          continue;
        }
        const after = g.snapshot();
        checkCommon(g, before, after, root, c.tag, cmd);
        if ('skipped' in result) {
          if (JSON.stringify([...after]) !== JSON.stringify([...before])) {
            throw new Failure('refusal-writes-nothing', `refused (${result.skipped}) but wrote ${g.log.join('; ')}`);
          }
          continue;
        }
        const { seen } = seenAndUnseen(g, before, root, c.tag);
        const rootIsCode = isFenceLine(stripTag(rootText, c.tag).trim().split('\n')[0]);
        const parsed = parseOutline(text, { unwrapFence: !rootIsCode });
        const reparsed = parsed && parseOutline(renderOutline(parsed));
        const wellFormed = parsed !== null && reparsed !== null && renderOutline(parsed) === renderOutline(reparsed);
        // These prepend something to the root's text but must leave the children alone.
        const rootChanged: ReplyKind[] = ['chatter', 'unclosed'];
        // Format variants of the same outline must land like the outline itself.
        const identityClass: ReplyKind[] = ['identity', 'edit', 'stars', 'numbered', 'spaces', 'crlf', 'fenced', 'chatter', 'unclosed'];
        // A code-block root is not unwrapped: a reply that starts with a bare fence is
        // its content, whatever the model meant by it. Documented, not checked.
        const codeRootWrapped = rootIsCode && (cmd.reply === 'fenced' || cmd.reply === 'unclosed');
        if (codeRootWrapped) {
          limitations.codeRootWrapped++;
          identityClass.length = 0;
        }
        // Known limitation: in an outline with no tab indentation a list line inside a
        // point cannot be told from a sub-point. That is the root of a block with no
        // children, or any reply the model indented with spaces.
        const listLine = (l: string) => /^\s*(?:[-*+•]\s|\d+[.)]\s)/.test(l);
        const hasListLines = (n: OutlineNode): boolean => n.text.split('\n').slice(1).some(listLine) || n.children.some(hasListLines);
        const ctxTree = parseOutline(context);
        const tabbed = (t: string) => /^\t/m.test(t);
        const untabbedList =
          (!tabbed(context) && context.split('\n').slice(1).some(listLine)) ||
          (!tabbed(text) && ctxTree !== null && hasListLines(ctxTree)) ||
          (rootChanged.includes(cmd.reply) && !tabbed(text) && listLine(context));
        if (untabbedList) {
          limitations.untabbedList++;
          identityClass.length = 0;
        }
        if (process.env.FUZZ_DEBUG === String(c.seed)) {
          console.log(`seed ${c.seed} ${cmd.reply}\n-- context --\n${context}\n-- reply --\n${text}\n-- flags -- untabbedList=${untabbedList} codeRootWrapped=${codeRootWrapped} identity=${identityClass.join(',')}\n-- log --\n${g.log.join('\n')}`);
        }
        // Known limitation: a root line led by "- " is read as the model's bullet, not the block's text.
        if (/^\s*[-*+•]\s/.test(context)) {
          limitations.rootBullet++;
          identityClass.length = 0;
        }
        if (identityClass.includes(cmd.reply)) {
          const expect = cmd.reply === 'edit' ? mark : (t: string) => t;
          const trimmed = (t: string) => t.split('\n').map((l) => l.trimEnd()).filter((l) => l).join('\n');
          const roundTrips = trimmed(renderOutline(parseOutline(context)!)) === trimmed(context);
          if (!roundTrips) {
            throw new Failure('outline-roundtrip', `the context does not survive parseOutline/renderOutline:\n${context}\n-- came back as --\n${renderOutline(parseOutline(context)!)}`);
          }
          for (const id of seen) {
            const s = before.get(id)!;
            const a = after.get(id);
            if (!a) throw new Failure('seen-kept-on-identity', `${id} removed by a ${cmd.reply} reply`);
            // A block with no text of its own is not a point; its children stand in for it.
            const blank = id !== root && !norm(g.text(s), c.tag);
            const want = expect(norm(id === root ? rootText : g.text(s), c.tag));
            if (blank || (id === root && rootChanged.includes(cmd.reply))) {
              // fall through to the shape check only
            } else if (norm(g.text(a), c.tag) !== want) {
              throw new Failure('own-text', `${id} got someone else's text on a ${cmd.reply} reply: ${JSON.stringify(norm(g.text(s), c.tag))} -> ${JSON.stringify(norm(g.text(a), c.tag))}, wanted ${JSON.stringify(want)}`);
            }
            if (JSON.stringify(a.children) !== JSON.stringify(s.children)) {
              throw new Failure('shape-kept', `${id} children changed on a ${cmd.reply} reply: ${s.children} -> ${a.children}; log: ${g.log.join('; ')}`);
            }
          }
        }
        // On a file graph a property line in the reply is a property, not prose; the model cannot have it both ways.
        const hasPropertyLine = (n: OutlineNode): boolean => splitProperties(n.text).properties.length > 0 || n.children.some(hasPropertyLine);
        const echoesProperty = c.backend === 'file' && parsed !== null && hasPropertyLine(parsed);
        if (wellFormed && result.kept === 0 && parsed && !identityClass.includes(cmd.reply) && !echoesProperty && !codeRootWrapped) {
          const blankless = (t: string) => t.split('\n').filter((l) => l.trim()).join('\n');
          const now = blankless(stripTag(await ops.readContext(root, c.tag), c.tag));
          const closed = (n: OutlineNode): OutlineNode => ({ text: closeFences(n.text), children: n.children.map(closed) });
          const want = blankless(renderOutline(closed(parsed)));
          if (now !== want) {
            throw new Failure('reply-written', `what the model said is not what is in the graph.\n-- reply --\n${want}\n-- graph --\n${now}\n-- log --\n${g.log.join('\n')}`);
          }
        }
        // A root whose text was only the tag plus a code block turns into a code block once
        // rewritten, and a fenced reply is then taken literally; documented, not checked.
        const nowCode = isFenceLine(((await ops.readText(root)) ?? '').split('\n')[0]);
        if (cmd.twice && nowCode === rootIsCode && !codeRootWrapped) {
          g.log.length = 0;
          const second = await runReplace(ops, root, c.tag, text);
          if ('skipped' in second) throw new Failure('idempotent', `second application refused: ${second.skipped}`);
          const again = g.snapshot();
          const diff = [...after.keys(), ...again.keys()].filter(
            (id) => JSON.stringify(after.get(id)) !== JSON.stringify(again.get(id)),
          );
          if (diff.length) {
            throw new Failure('idempotent', `applying the same reply twice changed ${[...new Set(diff)].join(', ')}:\n${diff.map((id) => `${id}: ${JSON.stringify(after.get(id))} -> ${JSON.stringify(again.get(id))}`).join('\n')}\nlog: ${g.log.join('; ')}`);
          }
        }
        continue;
      }
    }
    editingOff();
    const after = g.snapshot();
    checkCommon(g, before, after, root, c.tag, cmd);
    const ra = after.get(root)!;
    if (cmd.kind === 'append' && cmd.text) {
      const blankless = (t: string) => t.split('\n').filter((l) => l.trim()).join('\n');
      const want = blankless(norm(rootText, c.tag));
      const got = blankless(norm(g.text(ra), c.tag));
      if (!got.startsWith(want) || !got.endsWith(blankless(norm(cmd.text, c.tag)))) {
        throw new Failure('append', `${JSON.stringify(rootText)} + ${JSON.stringify(cmd.text)} -> ${JSON.stringify(g.text(ra))}`);
      }
    }
    if (cmd.kind === 'property') {
      const had = g.properties(before.get(root)!).filter((p) => propertyLineKey(p) === cmd.key).length;
      const lines = g.properties(ra).filter((p) => propertyLineKey(p) === cmd.key);
      if (lines.length !== Math.max(1, had)) throw new Failure('property-once', `${cmd.key} appears ${lines.length} times: ${g.properties(ra)}`);
    }
    if (cmd.kind === 'insert') {
      const added = [...after.keys()].filter((id) => !before.has(id));
      if (added.length !== cmd.items.length) throw new Failure('insert-count', `${cmd.items.length} items, ${added.length} blocks`);
      for (const id of added) {
        if (after.get(id)!.parent !== root) throw new Failure('insert-under-root', `${id} under ${after.get(id)!.parent}`);
      }
    }
  }
}

// ---------------------------------------------------------------- shrinking

function* smaller(c: Case): Generator<Case> {
  // Fewer commands.
  for (let i = 0; i < c.commands.length; i++) {
    if (c.commands.length > 1) yield { ...c, commands: c.commands.filter((_, j) => j !== i) };
  }
  for (const [i, cmd] of c.commands.entries()) {
    if (cmd.kind === 'replace' && cmd.twice) yield { ...c, commands: c.commands.map((x, j) => (j === i ? { ...cmd, twice: false } : x)) };
  }
  // Plain neighbours, no editing.
  const plain: GenBlock = { body: ['x'], props: [], layout: 'logseq', children: [] };
  if (JSON.stringify(c.before) !== JSON.stringify(plain)) yield { ...c, before: plain };
  if (JSON.stringify(c.after) !== JSON.stringify(plain)) yield { ...c, after: plain };
  if (c.editing !== 'none') yield { ...c, editing: 'none' };
  // Simpler root subtree: drop a child, drop a line, drop a property, shorten a line.
  const variants = (b: GenBlock): GenBlock[] => {
    const out: GenBlock[] = [];
    for (let i = 0; i < b.children.length; i++) out.push({ ...b, children: b.children.filter((_, j) => j !== i) });
    for (let i = 0; i < b.body.length; i++) out.push({ ...b, body: b.body.filter((_, j) => j !== i) });
    for (let i = 0; i < b.props.length; i++) out.push({ ...b, props: b.props.filter((_, j) => j !== i) });
    for (let i = 0; i < b.body.length; i++) {
      if (b.body[i].length > 1 && !/^(```|~~~)/.test(b.body[i])) out.push({ ...b, body: b.body.map((l, j) => (j === i ? l.slice(0, Math.ceil(l.length / 2)) : l)) });
    }
    if (b.layout === 'end') out.push({ ...b, layout: 'logseq' });
    for (let i = 0; i < b.children.length; i++) {
      for (const v of variants(b.children[i])) out.push({ ...b, children: b.children.map((ch, j) => (j === i ? v : ch)) });
    }
    return out;
  };
  for (const v of variants(c.root)) yield { ...c, root: v };
}

async function failureOf(c: Case): Promise<Failure | null> {
  try {
    await run(c);
    return null;
  } catch (error) {
    if (error instanceof Failure) return error;
    return new Failure('crash', String(error instanceof Error ? error.stack : error));
  }
}

async function shrink(c: Case, original: Failure): Promise<{ c: Case; f: Failure }> {
  let current = { c, f: original };
  let progress = true;
  while (progress) {
    progress = false;
    for (const candidate of smaller(current.c)) {
      const f = await failureOf(candidate);
      if (f && f.invariant === original.invariant) {
        current = { c: candidate, f };
        progress = true;
        break;
      }
    }
  }
  return current;
}

function describeCase(c: Case): string {
  const block = (b: GenBlock, depth: number): string =>
    [`${'  '.repeat(depth)}- body=${JSON.stringify(b.body)} props=${JSON.stringify(b.props)}${b.layout === 'end' ? ' layout=end' : ''}`, ...b.children.map((ch) => block(ch, depth + 1))].join('\n');
  return [
    `seed=${c.seed} backend=${c.backend} tag=${JSON.stringify(c.tag)} editing=${c.editing}`,
    `commands=${JSON.stringify(c.commands)}`,
    'root subtree:',
    block(c.root, 0),
  ].join('\n');
}

// ------------------------------------------------------------------- tests

// FUZZ_CASES=50000 runs a longer search; FUZZ_SEED=n runs one case, FUZZ_DEBUG=n traces it.
const CASES = Number(process.env.FUZZ_CASES ?? 3000);
const ONLY = process.env.FUZZ_SEED === undefined ? undefined : Number(process.env.FUZZ_SEED);
/** Cases that hit a documented limitation rather than a bug; counted, not failed. */
const limitations = { untabbedList: 0, codeRootWrapped: 0, rootBullet: 0 };

describe('note-writing pipeline (property-based)', () => {
  it(`holds its invariants over ${CASES} generated cases`, async () => {
    const found = new Map<string, string>();
    let ran = 0;
    for (let seed = ONLY ?? 0; seed < (ONLY === undefined ? CASES : ONLY + 1); seed++) {
      const c = genCase(seed);
      ran++;
      const f = await failureOf(c);
      if (!f || found.has(f.invariant)) continue;
      const min = await shrink(c, f);
      found.set(f.invariant, `${min.f.message}\n${describeCase(min.c)}`);
    }
    const report = [...found.entries()].map(([k, v]) => `### ${k}\n${v}`).join('\n\n');
    if (process.env.FUZZ_CASES) console.log(`ran ${ran} cases; known limitations hit: ${JSON.stringify(limitations)}`);
    expect(report, `${found.size} distinct invariant(s) broken in ${ran} cases:\n\n${report}`).toBe('');
  }, 120_000);
});
