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
const FENCE_LINE = /^\s*(```|~~~)/;

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
  let inFence = false;

  for (const line of content.split('\n')) {
    if (FENCE_LINE.test(line)) {
      inFence = !inFence;
      body.push(line);
    } else if (!inFence && propertyLineKey(line) !== undefined) {
      properties.push(line.trim());
    } else {
      body.push(line);
    }
  }

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
  const lines = [textOf(block)];

  const walk = (children: unknown, level: number) => {
    if (!Array.isArray(children)) {
      return;
    }
    for (const child of children) {
      if (!isBlock(child)) {
        continue;
      }
      const body = textOf(child);
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

/** Appends the tag to the end of `text` unless it is already present. */
export function withTag(text: string, tag: string): string {
  const token = tag.trim();
  if (!token || hasTag(text, tag)) {
    return text;
  }
  return text ? `${text}${tag}` : token;
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

/**
 * Reassembles a block: first body line, then the property lines, then the
 * remaining body. That is where Logseq expects block properties to live.
 */
export function joinBlock(body: string, properties: string[]): string {
  if (properties.length === 0) {
    return body;
  }
  if (!body) {
    return properties.join('\n');
  }
  const [first, ...rest] = body.split('\n');
  return [first, ...properties, ...rest].join('\n');
}

function upsertProperty(properties: string[], key: string, value: string): string[] {
  const line = `${key}:: ${value}`;
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

/** `append` output: response follows the existing text; properties are preserved. */
export function composeAppend(content: string, response: string, tag: string): string {
  const { body, properties } = splitProperties(content);
  const text = body ? `${body} ${response}` : response;
  return joinBlock(withTag(text, tag), properties);
}

/** `replace` output: response replaces the text; properties are preserved. */
export function composeReplace(content: string, response: string, tag: string): string {
  const { properties } = splitProperties(content);
  return joinBlock(withTag(response, tag), properties);
}
