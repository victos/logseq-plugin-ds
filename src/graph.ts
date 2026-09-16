/**
 * Logseq has two storage backends and they model a block differently.
 *
 * File graphs keep everything in one markdown string: the prose and the
 * `key:: value` property lines live together in `block.content`, so writing a
 * block means re-emitting that whole string with the properties intact.
 *
 * DB graphs keep properties as separate entities. The prose is `block.title`,
 * `block.content` may be absent, and properties are read and written through
 * their own API — so the text can be replaced without touching them.
 *
 * Everything the plugin does to a block goes through {@link BlockOps} so that
 * `main.ts` never has to know which backend it is talking to.
 */
import {
  ExistingBlock,
  OutlineNode,
  Step,
  parseOutline,
  planRewrite,
} from './outline';
import {
  BlockLike,
  appendToText,
  blockContent,
  blockToText,
  composeAppend,
  composeProperty,
  composeReplace,
  fileText,
  hasTag,
  propertyLineKey,
  propertyValue,
  readCurrentContent,
  splitProperties,
  withTag,
} from './block';

export interface BlockOps {
  /**
   * The block's prose plus its descendants', for sending to the model.
   * Descendants tagged with `tag` are the plugin's own output and are excluded.
   */
  readContext(uuid: string, tag: string): Promise<string>;
  /** The block's own prose as the user currently sees it, or `null` if it is gone. */
  readText(uuid: string): Promise<string | null>;
  /** Replaces the block's prose. Properties are preserved. */
  replaceText(uuid: string, text: string, tag: string): Promise<void>;
  /** Appends to the block's prose. Properties are preserved. */
  appendText(uuid: string, addition: string, tag: string): Promise<void>;
  /** Sets `key` on the block, replacing any previous value. */
  setProperty(uuid: string, key: string, value: string, tag: string): Promise<void>;
  /** Adds a child block. */
  insertChild(uuid: string, text: string): Promise<void>;
  /**
   * Applies a rewritten outline over the block and its descendants. Existing
   * blocks are updated in place so their uuids — and any reference to them —
   * survive; the model is free to merge or split lines. Returns the number of
   * blocks that had to be kept because something links to them.
   */
  rewriteSubtree(uuid: string, outline: string, tag: string): Promise<number>;
}

interface BlockLikeWithChildren {
  children?: unknown;
}

/** Children come back as blocks or as `[":uuid", id]` tuples; keep the blocks. */
function asBlocks(children: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(children)) {
    return [];
  }
  return children.filter(
    (c): c is Record<string, unknown> => typeof c === 'object' && c !== null && !Array.isArray(c),
  );
}

/** The slice of `logseq.Editor` the adapters use. */
export interface EditorApi {
  getBlock(uuid: string, opts?: { includeChildren?: boolean }): Promise<Record<string, unknown> | null>;
  updateBlock(uuid: string, content: string): Promise<void>;
  insertBlock(uuid: string, content: string, opts?: Record<string, unknown>): Promise<unknown>;
  removeBlock(uuid: string): Promise<void>;
  checkEditing(): Promise<string | boolean>;
  getEditingBlockContent(): Promise<string>;
  /** Defines the property itself. On a DB graph it must exist before any block can carry it. */
  upsertProperty?(key: string, schema?: Record<string, unknown>, opts?: { name?: string }): Promise<unknown>;
  upsertBlockProperty?(uuid: string, key: string, value: unknown): Promise<void>;
}

/** File graphs: prose and properties share one markdown string. */
export class FileGraphOps implements BlockOps {
  constructor(private readonly editor: EditorApi) {}

  async readContext(uuid: string, tag: string) {
    const block = await this.editor.getBlock(uuid, { includeChildren: true });
    if (!block) {
      return '';
    }
    const live = await readCurrentContent(this.editor, uuid);
    return blockToText({ ...block, content: live ?? blockContent(block) }, fileText, tag);
  }

  async readText(uuid: string) {
    const content = await readCurrentContent(this.editor, uuid);
    return content === null ? null : splitProperties(content).body;
  }

  async replaceText(uuid: string, text: string, tag: string) {
    const latest = await readCurrentContent(this.editor, uuid);
    if (latest === null) return;
    await this.editor.updateBlock(uuid, composeReplace(latest, text, tag));
  }

  async appendText(uuid: string, addition: string, tag: string) {
    const latest = await readCurrentContent(this.editor, uuid);
    if (latest === null) return;
    await this.editor.updateBlock(uuid, composeAppend(latest, addition, tag));
  }

  async setProperty(uuid: string, key: string, value: string, tag: string) {
    const latest = await readCurrentContent(this.editor, uuid);
    if (latest === null) return;
    await this.editor.updateBlock(uuid, composeProperty(latest, key, value, tag));
  }

  /**
   * `id::` is the signal: Logseq writes it into a block only once something
   * references it, so a block carrying one cannot be deleted without breaking
   * that reference.
   */
  private toExisting(block: BlockLikeWithChildren, tag: string): ExistingBlock[] {
    return existingChildren(block, fileText, tag, hasIdProperty).children;
  }

  async rewriteSubtree(uuid: string, outline: string, tag: string) {
    const rewritten = parseOutline(outline);
    if (!rewritten) {
      throw new Error('DeepSeek returned nothing to write back.');
    }
    const block = await this.editor.getBlock(uuid, { includeChildren: true });
    if (!block) {
      return 0;
    }
    const steps = planRewrite(uuid, rewritten, this.toExisting(block as BlockLikeWithChildren, tag));
    return applyPlan(this.editor, steps, async (target, text) => {
      // Only the block the command was run on is tagged: tagging the rewritten
      // children would hide them from the next command's context.
      const current = (await readCurrentContent(this.editor, target)) ?? '';
      await this.editor.updateBlock(target, composeReplace(current, text, target === uuid ? tag : ''));
    });
  }

  async insertChild(uuid: string, text: string) {
    await this.editor.insertBlock(uuid, text);
  }
}

/** DB graphs: prose is `title`, properties are separate entities. */
export class DbGraphOps implements BlockOps {
  constructor(private readonly editor: EditorApi) {}

  /** In a DB graph the editor buffer holds the prose only — nothing to merge. */
  private async currentText(uuid: string): Promise<string | null> {
    const block = await this.editor.getBlock(uuid);
    if (!block) {
      return null;
    }
    if ((await this.editor.checkEditing()) === uuid) {
      return this.editor.getEditingBlockContent();
    }
    return dbText(block);
  }

  async readContext(uuid: string, tag: string) {
    const block = await this.editor.getBlock(uuid, { includeChildren: true });
    if (!block) {
      return '';
    }
    const live = await this.currentText(uuid);
    return blockToText({ ...block, title: live ?? dbText(block) }, dbText, tag);
  }

  readText(uuid: string) {
    return this.currentText(uuid);
  }

  async replaceText(uuid: string, text: string, tag: string) {
    if ((await this.currentText(uuid)) === null) return;
    await this.editor.updateBlock(uuid, withTag(text, tag));
  }

  async appendText(uuid: string, addition: string, tag: string) {
    const latest = await this.currentText(uuid);
    if (latest === null) return;
    await this.editor.updateBlock(uuid, withTag(appendToText(latest, addition), tag));
  }

  /**
   * A DB graph refuses to put a property on a block before the property itself
   * exists ("Property :summarize doesn't exist yet", observed against a real
   * graph), and it stores it under a namespaced ident of its own choosing
   * rather than under the key given here. So the property is defined first;
   * `upsertProperty` is a no-op when it already exists.
   */
  async setProperty(uuid: string, key: string, value: string, tag: string) {
    const latest = await this.currentText(uuid);
    if (latest === null) return;
    if (!this.editor.upsertBlockProperty) {
      throw new Error(
        'This Logseq version cannot set block properties on a DB graph. Update Logseq, ' +
          'or change the prompt’s "output" away from "property".',
      );
    }

    if (this.editor.upsertProperty) {
      try {
        await this.editor.upsertProperty(key, { type: 'default', cardinality: 'one' }, { name: key });
      } catch (error) {
        // Already defined, or defined with a different schema — either is fine;
        // the write below is what decides whether this actually worked.
        console.warn(`[DeepSeek Assistant] could not define property "${key}":`, error);
      }
    }

    try {
      await this.editor.upsertBlockProperty(uuid, key, propertyValue(value));
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Could not write the "${key}" property on this DB graph: ${detail}. ` +
          'Create the property in Logseq first, or change the prompt’s "output" ' +
          'to "insert" so the answer becomes a child block instead.',
      );
    }

    const tagged = withTag(latest, tag);
    if (tagged !== latest) {
      await this.editor.updateBlock(uuid, tagged);
    }
  }

  /**
   * A DB graph gives the plugin no way to ask what links to a block, so nothing
   * is ever deleted here — a surplus block is kept and reported instead.
   */
  private toExisting(block: BlockLikeWithChildren, tag: string): ExistingBlock[] {
    return existingChildren(block, dbText, tag, () => true).children;
  }

  async rewriteSubtree(uuid: string, outline: string, tag: string) {
    const rewritten = parseOutline(outline);
    if (!rewritten) {
      throw new Error('DeepSeek returned nothing to write back.');
    }
    const block = await this.editor.getBlock(uuid, { includeChildren: true });
    if (!block) {
      return 0;
    }
    const steps = planRewrite(uuid, rewritten, this.toExisting(block as BlockLikeWithChildren, tag));
    return applyPlan(this.editor, steps, async (target, text) => {
      await this.editor.updateBlock(target, target === uuid ? withTag(text, tag) : text);
    });
  }

  async insertChild(uuid: string, text: string) {
    await this.editor.insertBlock(uuid, text);
  }
}

interface ExistingTree {
  children: ExistingBlock[];
  /** A block the model was not shown, somewhere below, is linked. */
  hiddenLinked: boolean;
}

/**
 * The children as the model saw them, for reconciliation. `blockToText` leaves
 * two kinds of child out of the outline, and they have to be left out here in
 * the same way or every line after them lands one block off: a child tagged as
 * the plugin's own output is skipped with its subtree and never touched, and a
 * child with no text of its own is stood in for by its children.
 *
 * What is left out can still be linked, and removing an ancestor would take it
 * along. So a linked block below a skipped one marks the nearest block that is
 * in the tree as linked, and the plan keeps that block.
 */
function existingChildren(
  block: BlockLikeWithChildren,
  textOf: (block: BlockLike) => string,
  tag: string,
  isLinked: (child: Record<string, unknown>) => boolean,
): ExistingTree {
  const children: ExistingBlock[] = [];
  let hiddenLinked = false;
  for (const child of asBlocks(block.children)) {
    const text = textOf(child);
    if (hasTag(text, tag)) {
      if (subtreeLinked(child, isLinked)) {
        hiddenLinked = true;
      }
      continue;
    }
    const below = existingChildren(child, textOf, tag, isLinked);
    if (!text) {
      children.push(...below.children);
      if (isLinked(child) || below.hiddenLinked) {
        hiddenLinked = true;
      }
      continue;
    }
    children.push({
      uuid: String(child.uuid ?? ''),
      text,
      linked: isLinked(child) || below.hiddenLinked,
      children: below.children,
    });
  }
  return { children, hiddenLinked };
}

function subtreeLinked(
  block: Record<string, unknown>,
  isLinked: (child: Record<string, unknown>) => boolean,
): boolean {
  return isLinked(block) || asBlocks(block.children).some((child) => subtreeLinked(child, isLinked));
}

/**
 * `id::` is the signal on a file graph: Logseq writes it into a block only
 * once something references it. Only a real property line counts — not the
 * words `id::` inside the prose or a code fence.
 */
function hasIdProperty(block: Record<string, unknown>): boolean {
  return splitProperties(blockContent(block)).properties.some((line) => propertyLineKey(line) === 'id');
}

/**
 * Runs a rewrite plan. `write` is backend-specific because a file graph has to
 * re-emit the block's property lines around the new text, while a DB graph
 * stores them separately and can set the text on its own.
 */
async function applyPlan(
  editor: EditorApi,
  steps: Step[],
  write: (uuid: string, text: string) => Promise<void>,
): Promise<number> {
  let kept = 0;
  // The last block put under each parent, so the next surplus line follows it.
  const lastInserted = new Map<string, string>();
  for (const step of steps) {
    switch (step.op) {
      case 'update':
        await write(step.uuid, step.text);
        break;
      case 'insert': {
        const after = lastInserted.get(step.parent) ?? step.after;
        const uuid = await insertTree(editor, step.parent, after, step.text, step.children);
        if (uuid) {
          lastInserted.set(step.parent, uuid);
        }
        break;
      }
      case 'remove':
        await editor.removeBlock(step.uuid);
        break;
      case 'keep':
        kept += 1;
        break;
    }
  }
  return kept;
}

/**
 * Inserts a block and its subtree: as the sibling after `after` when there is
 * one, otherwise as the last child of `parent`. Returns the new block's uuid,
 * or nothing when the host did not hand one back (the subtree is dropped then;
 * there is nowhere to put it).
 */
async function insertTree(
  editor: EditorApi,
  parent: string,
  after: string | undefined,
  text: string,
  children: OutlineNode[],
): Promise<string | undefined> {
  const inserted = (after
    ? await editor.insertBlock(after, text, { sibling: true })
    : await editor.insertBlock(parent, text)) as { uuid?: unknown } | null;
  const uuid = inserted?.uuid;
  if (typeof uuid !== 'string' || !uuid) {
    return undefined;
  }
  let previous: string | undefined;
  for (const child of children) {
    previous = (await insertTree(editor, uuid, previous, child.text, child.children)) ?? previous;
  }
  return uuid;
}

/** Prose of one block in a DB graph. Trimmed: a whitespace-only title is no text, like an empty one. */
export function dbText(block: { title?: unknown; content?: unknown }): string {
  if (typeof block.title === 'string') return block.title.trim();
  if (typeof block.content === 'string') return block.content.trim();
  return '';
}

/** The slice of `logseq.App` used to tell the backends apart. */
export interface AppApi {
  // Declared as `Promise<Boolean>` by the SDK; the result is coerced either way.
  checkCurrentIsDbGraph?(): Promise<unknown>;
}

/**
 * Whether the current graph uses the DB backend. Older Logseq builds have no
 * such API at all, and those are always file graphs — so an absent or failing
 * call is not an error, it is the answer.
 */
export async function isDbGraph(app: AppApi): Promise<boolean> {
  try {
    if (typeof app?.checkCurrentIsDbGraph !== 'function') {
      return false;
    }
    return Boolean(await app.checkCurrentIsDbGraph());
  } catch {
    return false;
  }
}

/** Picks the adapter for the graph that is open right now. */
export async function blockOps(app: AppApi, editor: EditorApi): Promise<BlockOps> {
  return (await isDbGraph(app)) ? new DbGraphOps(editor) : new FileGraphOps(editor);
}
