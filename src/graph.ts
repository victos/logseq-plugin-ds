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
  blockContent,
  blockToText,
  composeAppend,
  composeProperty,
  composeReplace,
  propertyValue,
  readCurrentContent,
  withTag,
} from './block';

export interface BlockOps {
  /** The block's prose plus its descendants', for sending to the model. */
  readContext(uuid: string): Promise<string>;
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
}

/** The slice of `logseq.Editor` the adapters use. */
export interface EditorApi {
  getBlock(uuid: string, opts?: { includeChildren?: boolean }): Promise<Record<string, unknown> | null>;
  updateBlock(uuid: string, content: string): Promise<void>;
  insertBlock(uuid: string, content: string, opts?: Record<string, unknown>): Promise<unknown>;
  checkEditing(): Promise<string | boolean>;
  getEditingBlockContent(): Promise<string>;
  /** Defines the property itself. On a DB graph it must exist before any block can carry it. */
  upsertProperty?(key: string, schema?: Record<string, unknown>, opts?: { name?: string }): Promise<unknown>;
  upsertBlockProperty?(uuid: string, key: string, value: unknown): Promise<void>;
}

/** File graphs: prose and properties share one markdown string. */
export class FileGraphOps implements BlockOps {
  constructor(private readonly editor: EditorApi) {}

  async readContext(uuid: string) {
    const block = await this.editor.getBlock(uuid, { includeChildren: true });
    if (!block) {
      return '';
    }
    const live = await readCurrentContent(this.editor, uuid);
    return blockToText({ ...block, content: live ?? blockContent(block) });
  }

  readText(uuid: string) {
    return readCurrentContent(this.editor, uuid);
  }

  async replaceText(uuid: string, text: string, tag: string) {
    const latest = await this.readText(uuid);
    if (latest === null) return;
    await this.editor.updateBlock(uuid, composeReplace(latest, text, tag));
  }

  async appendText(uuid: string, addition: string, tag: string) {
    const latest = await this.readText(uuid);
    if (latest === null) return;
    await this.editor.updateBlock(uuid, composeAppend(latest, addition, tag));
  }

  async setProperty(uuid: string, key: string, value: string, tag: string) {
    const latest = await this.readText(uuid);
    if (latest === null) return;
    await this.editor.updateBlock(uuid, composeProperty(latest, key, value, tag));
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

  async readContext(uuid: string) {
    const block = await this.editor.getBlock(uuid, { includeChildren: true });
    if (!block) {
      return '';
    }
    const live = await this.currentText(uuid);
    return blockToText({ ...block, title: live ?? dbText(block) }, dbText);
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
    const text = latest ? `${latest} ${addition}` : addition;
    await this.editor.updateBlock(uuid, withTag(text, tag));
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

  async insertChild(uuid: string, text: string) {
    await this.editor.insertBlock(uuid, text);
  }
}

/** Prose of one block in a DB graph. */
export function dbText(block: { title?: unknown; content?: unknown }): string {
  if (typeof block.title === 'string') return block.title;
  if (typeof block.content === 'string') return block.content;
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
