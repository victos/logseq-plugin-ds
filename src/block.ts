/**
 * Pure helpers for reading and rewriting Logseq (markdown) block content.
 *
 * A block's `content` string is its text plus any `key:: value` property
 * lines. Logseq hides some of those in the editor (`id::`, `collapsed::`) but
 * still returns them from `getBlock`, so anything that appends to the raw
 * content must keep them intact on their own lines.
 */

/** A block as returned by `logseq.Editor.getBlock`; children may be `[":uuid", id]` tuples. */
export interface BlockLike {
  content?: string | null;
  /** DB graphs carry the prose here instead of in `content`. */
  title?: unknown;
  children?: unknown;
}

export interface SplitContent {
  /** Content with every property line removed. */
  body: string;
  /** Property lines, trimmed, in their original order. */
  properties: string[];
}

// `key:: value` or a bare `key::`. The whitespace after `::` is required so that
// `std::vector` or `a::b` inside prose is not mistaken for a property.
const PROPERTY_LINE = /^\s*([^\s:]+)::(?:\s.*)?$/;
// A fence marker on a line of its own, CommonMark style: three or more
// backticks (or tildes) with an optional info string that cannot contain the
// marker character. "```x```" and "```x``` more" are inline code, not fences.
const FENCE_OPEN = /^\s*(?:(`{3,})[^`]*|(~{3,})[^~]*)$/;
const FENCE_CLOSE = /^\s*(`{3,}|~{3,})\s*$/;

/** The marker run of a line that opens a fence (or is a bare marker), else `undefined`. */
export function fenceMarker(line: string): string | undefined {
  const match = FENCE_OPEN.exec(line);
  return match ? match[1] ?? match[2] : undefined;
}

/** Whether the line closes a fence opened with `marker`: same character, at least as long, nothing else. */
function closesFence(line: string, marker: string): boolean {
  const match = FENCE_CLOSE.exec(line);
  return match !== null && match[1][0] === marker[0] && match[1].length >= marker.length;
}

/** Whether the line is a fence marker (opening or closing); nothing else may share such a line. */
export function isFenceLine(line: string): boolean {
  return fenceMarker(line) !== undefined;
}

export type FenceRole = 'text' | 'open' | 'code' | 'close';

/**
 * Where each line stands with respect to fenced code. A fence runs from an
 * opener to the first closer of the same kind; an opener with no closer below
 * it is plain text. Without that last rule one stray ``` in a note would
 * silently turn every line after it — property lines, sibling points — into
 * code, and a rewrite would then merge all of them into one block.
 */
export function fenceRoles(
  lines: string[],
  openerText: (line: string) => string = (line) => line,
  /** A line the fence opened at `opener` cannot run across; reaching one leaves the opener plain text. */
  barrier: (opener: string, line: string) => boolean = () => false,
): FenceRole[] {
  const roles: FenceRole[] = new Array(lines.length).fill('text');
  for (let i = 0; i < lines.length; i++) {
    const marker = fenceMarker(openerText(lines[i]));
    if (!marker) continue;
    let end = -1;
    for (let j = i + 1; j < lines.length; j++) {
      if (closesFence(lines[j], marker)) {
        end = j;
        break;
      }
      if (barrier(lines[i], lines[j])) break;
    }
    if (end === -1) continue;
    roles[i] = 'open';
    roles.fill('code', i + 1, end);
    roles[end] = 'close';
    i = end;
  }
  return roles;
}

/**
 * `text` without any `id::` property line outside a fence. Logseq owns that
 * property — it is the block's identity, written when something references
 * the block — so a line of it in model output can only be an echo of one the
 * model was shown, and written back it would hand this block another block's
 * identity. Lines inside a code fence are content and stay.
 */
export function withoutIdProperty(text: string): string {
  const lines = text.split('\n');
  const roles = fenceRoles(lines);
  return lines.filter((line, i) => roles[i] !== 'text' || propertyLineKey(line) !== 'id').join('\n');
}

/**
 * `text` with a fence still open at its end closed. Logseq renders such a
 * block as code to its end, so the closer changes nothing on screen — but an
 * outline that carries an unclosed fence would have it swallow every point
 * after it when the reply is parsed back.
 */
export function closeFences(text: string): string {
  let open: string | undefined;
  for (const line of text.split('\n')) {
    if (open) {
      if (closesFence(line, open)) open = undefined;
    } else {
      open = fenceMarker(line);
    }
  }
  return open ? `${text}\n${open}` : text;
}

export function propertyLineKey(line: string): string | undefined {
  return PROPERTY_LINE.exec(line)?.[1].toLowerCase();
}

// Properties Logseq strips from the editor buffer of a file-based graph (its
// `hidden-built-in-properties`). If one of these is absent from the editor text
// it was hidden, not deleted by the user, and must be carried over from the DB.
const HIDDEN_PROPERTY_KEYS = new Set([
  'id', 'custom-id', 'collapsed', 'heading', 'background-color', 'background_color',
  'created-at', 'created_at', 'updated-at', 'last-modified-at', 'last_modified_at',
  'query-table', 'query-properties', 'query-sort-by', 'query-sort-desc',
  'ls-type', 'hl-type', 'hl-page', 'hl-stamp', 'hl-color',
  'todo', 'doing', 'now', 'later', 'done',
]);
const HIDDEN_PROPERTY_PREFIXES = ['logseq.', 'card-'];

/** Whether Logseq hides this property key from the block editor. */
export function isHiddenProperty(key: string): boolean {
  const name = key.toLowerCase();
  return HIDDEN_PROPERTY_KEYS.has(name) || HIDDEN_PROPERTY_PREFIXES.some((p) => name.startsWith(p));
}

/** Separates a block's text from its `key:: value` property lines (ignoring fenced code). */
export function splitProperties(content: string): SplitContent {
  const body: string[] = [];
  const properties: string[] = [];
  const lines = content.split('\n');
  const roles = fenceRoles(lines);

  lines.forEach((line, i) => {
    if (roles[i] === 'text' && propertyLineKey(line) !== undefined) {
      properties.push(line.trim());
    } else {
      body.push(line);
    }
  });

  return { body: body.join('\n').trim(), properties };
}

function isBlock(value: unknown): value is BlockLike {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Prose of one file-graph block: its content minus the `key:: value` lines. */
export function fileText(block: BlockLike): string {
  return splitProperties(blockContent(block)).body;
}

/**
 * The raw markdown of a file-graph block. Normally `content`; newer Logseq
 * builds (`@logseq/libs` 0.3.x types) make `content` optional and carry the
 * same string in `title`, so that is the fallback. Older builds declare no
 * `title` on a block at all, and have been observed to put a parsed AST there;
 * anything that is not a string is ignored, which covers both.
 */
export function blockContent(block: BlockLike): string {
  if (typeof block.content === 'string') return block.content;
  if (typeof block.title === 'string') return block.title;
  return '';
}

/**
 * Flattens a block and its descendants into the text sent to the model:
 * the root's text, then each child as an indented `- ` item. Metadata is
 * dropped: `textOf` decides how one block's prose is extracted, which differs
 * between file graphs (strip `key:: value` lines) and DB graphs (use `title`).
 * A code fence a block leaves open is closed at the block's end, so that the
 * outline is well-formed as a whole and the reply parses back block by block.
 *
 * A child carrying `excludeTag` is treated as this plugin's own earlier output
 * and is left out together with its subtree: feeding an `/Ask AI` answer back
 * in would make the next command rewrite the answer instead of the question.
 * The root is never skipped — it carries the tag itself once it has been
 * rewritten in place. The tag can only say "the plugin touched this", so a
 * nested block the plugin rewrote or tagged with a property is skipped too.
 */
export function blockToText(
  block: BlockLike,
  textOf: (block: BlockLike) => string = fileText,
  excludeTag = '',
): string {
  const lines = [closeFences(textOf(block))];

  const walk = (children: unknown, level: number) => {
    if (!Array.isArray(children)) {
      return;
    }
    for (const child of children) {
      if (!isBlock(child)) {
        continue;
      }
      const body = closeFences(textOf(child));
      if (hasTag(body, excludeTag)) {
        continue;
      }
      if (body) {
        const indent = '\t'.repeat(level);
        const [first, ...rest] = body.split('\n');
        lines.push(`${indent}- ${first}`);
        for (const line of rest) {
          lines.push(`${indent}  ${line}`);
        }
      }
      // A child with no text of its own is not a point in the outline; its
      // children stand in its place, at its level, so that the reconciliation
      // after a rewrite can find them where the model saw them.
      walk(child.children, body ? level + 1 : level);
    }
  };

  walk(block.children, 1);
  return lines.join('\n');
}

/**
 * Turns a prompt name into a valid Logseq property key: lower-case, no
 * whitespace or colons (`Ask AI` -> `ask-ai`).
 */
export function propertyKey(name: string): string {
  const key = name
    .trim()
    .toLowerCase()
    .replace(/[\s:]+/g, '-')
    .replace(/[^\p{L}\p{N}_.-]+/gu, '')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '');
  if (!key) {
    return 'ai';
  }
  return /^\d+$/.test(key) ? `ai-${key}` : key;
}

/** Property values live on one line; fold any whitespace runs (including newlines). */
export function propertyValue(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/** The ` #tag` suffix for AI output, or `''` when no tag is configured. */
export function tagSuffix(tag: string | undefined | null): string {
  const name = (tag ?? '').trim().replace(/^#+/, '');
  return name ? ` #${name}` : '';
}

/**
 * The tag as a whole-token pattern, or `undefined` for a blank tag. Matching
 * the bare string would make `#AI` hit `#AIDS`, `#AI-notes` and `#AI/sub`, so
 * the tag must not run straight into another tag character.
 */
function tagPattern(tag: string, flags = 'u'): RegExp | undefined {
  const token = tag.trim();
  if (!token) {
    return undefined;
  }
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`${escaped}(?![\\p{L}\\p{N}_/-])`, flags);
}

/** Whether `text` carries `tag` as a whole token (`''` never does). */
export function hasTag(text: string, tag: string): boolean {
  return tagPattern(tag)?.test(text) ?? false;
}

/**
 * Whether nothing may be added to the last line of `text`: a fence marker
 * (a tag after "```" stops it closing) or a `key:: value` line (a tag after
 * it becomes part of the value, and the block itself is left untagged).
 */
function endsWithReservedLine(text: string): boolean {
  const last = text.slice(text.lastIndexOf('\n') + 1);
  return isFenceLine(last) || propertyLineKey(last) !== undefined;
}

/**
 * Whether `addition` cannot continue a line of prose: it opens with a code
 * fence, a table row, a quote, a list item or a heading, which Markdown only
 * recognises at the start of a line.
 */
function startsBlockConstruct(addition: string): boolean {
  const [first] = addition.split('\n');
  return TITLELESS_FIRST_LINE.test(first) || /^\s*#+\s/.test(first);
}

/**
 * Where something may be added after `text`: on its last line, or below it. A
 * fence left open is closed first — what is added must not land inside it,
 * and an addition that opens a fence of its own would otherwise close it.
 */
function placeAfter(text: string): { base: string; ownLine: boolean } {
  const base = closeFences(text);
  return { base, ownLine: base !== text || endsWithReservedLine(base) };
}

/**
 * Appends the tag to the end of `text` unless it is already present. After a
 * closing fence or a property line the tag goes on a line of its own.
 */
export function withTag(text: string, tag: string): string {
  const token = tag.trim();
  if (!token || hasTag(text, tag)) {
    return text;
  }
  if (!text) {
    return token;
  }
  const { base, ownLine } = placeAfter(text);
  return ownLine ? `${base}\n${token}` : `${base}${tag}`;
}

/**
 * `text` followed by `addition`: on the same line when both are prose, on a
 * new line when the text ends with a fence or property line or the addition
 * opens with something that must start a line.
 */
export function appendToText(text: string, addition: string): string {
  if (!text) {
    return addition;
  }
  const { base, ownLine } = placeAfter(text);
  return ownLine || startsBlockConstruct(addition) ? `${base}\n${addition}` : `${base} ${addition}`;
}

/** Removes the tag token from text before it is sent to the model. */
export function stripTag(text: string, tag: string): string {
  const pattern = tagPattern(tag, 'gu');
  return pattern ? text.replace(pattern, '').replace(/[ \t]+$/gm, '') : text;
}

/**
 * Combines the live editor text with the saved (DB) content of the same block.
 *
 * The editor is the source of truth for the body and for every property the
 * user can see — a visible property they removed stays removed, and an edited
 * value wins over the saved one. Hidden built-ins (`id::`, `collapsed::`, …)
 * are not shown in the editor, so they are restored from the saved content.
 * If the editor text already carries them the merge is a no-op.
 */
export function mergeContent(editorContent: string, savedContent: string): string {
  const editor = splitProperties(editorContent);
  const saved = splitProperties(savedContent);
  const present = new Set(editor.properties.map((line) => propertyLineKey(line)));
  const restored = saved.properties.filter((line) => {
    const key = propertyLineKey(line);
    return key !== undefined && !present.has(key) && isHiddenProperty(key);
  });
  return joinBlock(editor.body, [...editor.properties, ...restored]);
}

/** The subset of `logseq.Editor` needed to read a block as the user sees it. */
export interface BlockReader {
  getBlock(uuid: string): Promise<BlockLike | null>;
  checkEditing(): Promise<string | boolean>;
  getEditingBlockContent(): Promise<string>;
}

/**
 * The block's content as the user currently sees it, with hidden properties
 * intact. While a block is being edited its saved content lags behind the
 * editor, so the editor text is merged over the saved one. Returns `null`
 * when the block no longer exists.
 */
export async function readCurrentContent(reader: BlockReader, uuid: string): Promise<string | null> {
  const block = await reader.getBlock(uuid);
  if (!block) {
    return null;
  }
  const saved = blockContent(block);
  if ((await reader.checkEditing()) === uuid) {
    return mergeContent(await reader.getEditingBlockContent(), saved);
  }
  return saved;
}

// A first line that does not start a paragraph or heading: a code fence, a
// table row, a quote, a list item, a `#+BEGIN` block, display math. Logseq
// treats such a block as having no title line.
const TITLELESS_FIRST_LINE = /^\s*(?:```|~~~|\||>|[-*+]\s|\d+[.)]\s|#\+|\$\$)/;

/**
 * Reassembles a block the way Logseq lays one out: first body line, then the
 * property lines, then the rest. A block whose first line is not a title —
 * one that opens with a code fence, say — keeps its properties in front
 * instead: put after the fence line they would sit inside the code, where
 * neither Logseq nor {@link splitProperties} reads them as properties, and an
 * `id::` written there no longer holds the block's references.
 */
export function joinBlock(body: string, properties: string[]): string {
  if (properties.length === 0) {
    return body;
  }
  if (!body) {
    return properties.join('\n');
  }
  const [first, ...rest] = body.split('\n');
  if (TITLELESS_FIRST_LINE.test(first)) {
    return [...properties, first, ...rest].join('\n');
  }
  return [first, ...properties, ...rest].join('\n');
}

/** A property line; a bare `key::` when the value is empty, as Logseq writes it. */
function propertyLine(key: string, value: string): string {
  return value ? `${key}:: ${value}` : `${key}::`;
}

function upsertProperty(properties: string[], key: string, value: string): string[] {
  const line = propertyLine(key, value);
  const index = properties.findIndex((existing) => propertyLineKey(existing) === key);
  if (index === -1) {
    return [...properties, line];
  }
  const next = [...properties];
  next[index] = line;
  return next;
}

/** `property` output: tag the text and set (or overwrite) `key:: value`. */
export function composeProperty(content: string, key: string, value: string, tag: string): string {
  const { body, properties } = splitProperties(content);
  return joinBlock(withTag(body, tag), upsertProperty(properties, key, propertyValue(value)));
}

/**
 * The block's properties, plus any `key:: value` line from the response whose
 * key the block does not have. To a file graph a property line is a property
 * wherever it stands, so one the model wrote is treated as such from the
 * start — set once, not left in the body to be read as a second copy on the
 * next pass. It never replaces one of the block's own: the model is not shown
 * properties, so a key it repeats is not an edit of the user's value.
 */
function mergeResponse(properties: string[], response: string): { body: string; properties: string[] } {
  const reply = splitProperties(response);
  const merged = [...properties];
  for (const line of reply.properties) {
    const key = propertyLineKey(line)!;
    if (!merged.some((existing) => propertyLineKey(existing) === key)) {
      merged.push(propertyLine(key, line.slice(line.indexOf('::') + 2).trim()));
    }
  }
  return { body: reply.body, properties: merged };
}

/** `append` output: response follows the existing text; properties are preserved. */
export function composeAppend(content: string, response: string, tag: string): string {
  const current = splitProperties(content);
  const { body, properties } = mergeResponse(current.properties, response);
  return joinBlock(withTag(appendToText(current.body, body), tag), properties);
}

/** `replace` output: response replaces the text; properties are preserved. */
export function composeReplace(content: string, response: string, tag: string): string {
  const { body, properties } = mergeResponse(splitProperties(content).properties, response);
  return joinBlock(withTag(body, tag), properties);
}
