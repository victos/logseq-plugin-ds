import { describe, expect, it } from 'vitest';
import { DbGraphOps, EditorApi, FileGraphOps, blockOps, dbText, isDbGraph } from '../src/graph';

const TAG = ' #[[🤖]]';

type Block = Record<string, unknown> | null;

/** A stand-in for `logseq.Editor` that records what was written. */
function fakeEditor(
  block: Block,
  opts: {
    editing?: string;
    buffer?: string;
    props?: boolean;
    /** The property is already defined, so defining it again errors. */
    defineFails?: boolean;
    /** The host creates the property on demand instead of refusing. */
    autoCreates?: boolean;
  } = {},
) {
  const writes: string[] = [];
  const inserts: string[] = [];
  const insertOpts: unknown[] = [];
  const properties: Array<[string, unknown]> = [];
  const defined: string[] = [];
  const removed: string[] = [];
  const editor: EditorApi = {
    async getBlock() {
      return block;
    },
    async updateBlock(_uuid, content) {
      writes.push(content);
    },
    async insertBlock(_uuid, content, opts) {
      inserts.push(content);
      insertOpts.push(opts);
      return null;
    },
    async removeBlock(uuid) {
      removed.push(uuid);
    },
    async checkEditing() {
      return opts.editing ?? false;
    },
    async getEditingBlockContent() {
      return opts.buffer ?? '';
    },
  };
  if (opts.props !== false) {
    editor.upsertProperty = async (key) => {
      if (opts.defineFails) throw new Error('already exists');
      defined.push(key);
      return null;
    };
    editor.upsertBlockProperty = async (_uuid, key, value) => {
      // A real DB graph refuses this until the property has been defined.
      if (!defined.includes(key) && !opts.autoCreates) {
        throw new Error(`Property :${key} doesn't exist yet`);
      }
      properties.push([key, value]);
    };
  }
  return { editor, writes, inserts, insertOpts, properties, defined, removed };
}

describe('isDbGraph', () => {
  it('is false when the host is too old to have the API', async () => {
    expect(await isDbGraph({})).toBe(false);
  });

  it('reflects what the host reports', async () => {
    expect(await isDbGraph({ checkCurrentIsDbGraph: async () => true })).toBe(true);
    expect(await isDbGraph({ checkCurrentIsDbGraph: async () => false })).toBe(false);
  });

  it('treats a failing call as a file graph rather than an error', async () => {
    const app = {
      checkCurrentIsDbGraph: async () => {
        throw new Error('not supported');
      },
    };
    expect(await isDbGraph(app)).toBe(false);
  });

  it('picks the adapter to match', async () => {
    const { editor } = fakeEditor(null);
    expect(await blockOps({}, editor)).toBeInstanceOf(FileGraphOps);
    expect(await blockOps({ checkCurrentIsDbGraph: async () => true }, editor)).toBeInstanceOf(DbGraphOps);
  });
});

describe('dbText', () => {
  it('prefers title, falls back to content, then to empty', () => {
    expect(dbText({ title: 'hello', content: 'other' })).toBe('hello');
    expect(dbText({ content: 'only content' })).toBe('only content');
    expect(dbText({})).toBe('');
  });
});

describe('FileGraphOps', () => {
  const saved = 'Meeting notes\ncollapsed:: true\nid:: abc-123\nowner:: alice';

  it('sends prose without property lines, children included', async () => {
    const { editor } = fakeEditor({
      content: saved,
      children: [{ content: 'Churn rose\nid:: kid-1' }],
    });
    expect(await new FileGraphOps(editor).readContext('u', TAG)).toBe('Meeting notes\n\t- Churn rose');
  });

  it('uses the editor buffer for the root while the block is being edited', async () => {
    const { editor } = fakeEditor(
      { content: saved, children: [{ content: 'Churn rose' }] },
      { editing: 'u', buffer: 'Being typed\nowner:: alice' },
    );
    expect(await new FileGraphOps(editor).readContext('u', TAG)).toBe('Being typed\n\t- Churn rose');
  });

  it('ignores the editor buffer when a different block is being edited', async () => {
    const { editor } = fakeEditor({ content: saved }, { editing: 'other', buffer: 'elsewhere' });
    expect(await new FileGraphOps(editor).readContext('u', TAG)).toBe('Meeting notes');
  });

  // Newer Logseq builds type `content` as optional and put the markdown in `title`.
  it('falls back to a string title when content is absent', async () => {
    const { editor, writes } = fakeEditor({ title: 'Notes\nid:: abc', children: [{ title: 'Kid' }] });
    const ops = new FileGraphOps(editor);
    expect(await ops.readContext('u', TAG)).toBe('Notes\n\t- Kid');
    await ops.replaceText('u', 'New', TAG);
    expect(writes).toEqual([`New${TAG}\nid:: abc`]);
  });

  it('does not mistake an AST title (old builds) for content', async () => {
    const { editor } = fakeEditor({ content: 'Real', title: ['Paragraph', ['Plain', 'Real']] });
    expect(await new FileGraphOps(editor).readContext('u', TAG)).toBe('Real');
  });

  it('inserts a child with no positional options (last child by default)', async () => {
    const { editor, inserts, insertOpts } = fakeEditor({ content: 'x' });
    await new FileGraphOps(editor).insertChild('u', 'a child');
    expect(inserts).toEqual(['a child']);
    expect(insertOpts).toEqual([undefined]);
  });

  it('keeps properties when replacing the text', async () => {
    const { editor, writes } = fakeEditor({ content: saved });
    await new FileGraphOps(editor).replaceText('u', 'New text', TAG);
    expect(writes[0]).toBe(`New text${TAG}\ncollapsed:: true\nid:: abc-123\nowner:: alice`);
  });

  it('writes a property as a key:: value line', async () => {
    const { editor, writes } = fakeEditor({ content: saved });
    await new FileGraphOps(editor).setProperty('u', 'summarize', 'Growth offset by churn.', TAG);
    expect(writes[0]).toContain('summarize:: Growth offset by churn.');
    expect(writes[0]).toContain('id:: abc-123');
  });

  it('appends after the existing text', async () => {
    const { editor, writes } = fakeEditor({ content: 'Some text' });
    await new FileGraphOps(editor).appendText('u', 'More.', TAG);
    expect(writes[0]).toBe(`Some text More.${TAG}`);
  });

  it('writes nothing when the block is gone', async () => {
    const { editor, writes } = fakeEditor(null);
    const ops = new FileGraphOps(editor);
    expect(await ops.readText('u')).toBeNull();
    await ops.replaceText('u', 'x', TAG);
    await ops.setProperty('u', 'k', 'v', TAG);
    await ops.appendText('u', 'x', TAG);
    expect(writes).toEqual([]);
  });
});

describe('DbGraphOps', () => {
  it('reads prose from title', async () => {
    const { editor } = fakeEditor({ title: 'Meeting notes', properties: { owner: 'alice' } });
    expect(await new DbGraphOps(editor).readText('u')).toBe('Meeting notes');
  });

  it('prefers the editor buffer while the block is being edited', async () => {
    const { editor } = fakeEditor({ title: 'saved' }, { editing: 'u', buffer: 'being typed' });
    expect(await new DbGraphOps(editor).readText('u')).toBe('being typed');
  });

  it('uses the editor buffer for the root while the block is being edited', async () => {
    const { editor } = fakeEditor(
      { title: 'saved', children: [{ title: 'kid' }] },
      { editing: 'u', buffer: 'being typed' },
    );
    expect(await new DbGraphOps(editor).readContext('u', TAG)).toBe('being typed\n\t- kid');
  });

  it('treats a non-string title as empty rather than leaking it', async () => {
    const { editor, writes } = fakeEditor({ title: ['Paragraph'], content: 'compat' });
    const ops = new DbGraphOps(editor);
    expect(await ops.readText('u')).toBe('compat');
    expect(await ops.readContext('u', TAG)).toBe('compat');
    await ops.appendText('u', 'more', TAG);
    expect(writes).toEqual([`compat more${TAG}`]);
  });

  it('walks children by title', async () => {
    const { editor } = fakeEditor({
      title: 'Priorities?',
      children: [{ title: 'Churn rose', children: [{ title: 'from 3% to 5%' }] }],
    });
    expect(await new DbGraphOps(editor).readContext('u', TAG)).toBe(
      'Priorities?\n\t- Churn rose\n\t\t- from 3% to 5%',
    );
  });

  // The point of the DB path: properties are entities, so they must never be
  // serialised into the block's text the way a file graph does it.
  it('never writes key:: value into the text', async () => {
    const { editor, writes, properties } = fakeEditor({
      title: 'Meeting notes',
      properties: { owner: 'alice' },
    });
    await new DbGraphOps(editor).setProperty('u', 'summarize', 'Growth offset\nby churn.', TAG);
    expect(properties).toEqual([['summarize', 'Growth offset by churn.']]);
    expect(writes.join('\n')).not.toContain('::');
    expect(writes[0]).toBe(`Meeting notes${TAG}`);
  });

  it('replaces the text without touching properties', async () => {
    const { editor, writes, properties } = fakeEditor({ title: 'old', properties: { owner: 'alice' } });
    await new DbGraphOps(editor).replaceText('u', 'new text', TAG);
    expect(writes).toEqual([`new text${TAG}`]);
    expect(properties).toEqual([]);
  });

  it('appends to the existing prose', async () => {
    const { editor, writes } = fakeEditor({ title: 'Some text' });
    await new DbGraphOps(editor).appendText('u', 'More.', TAG);
    expect(writes).toEqual([`Some text More.${TAG}`]);
  });

  it('does not re-tag a block that already carries the tag', async () => {
    const { editor, writes } = fakeEditor({ title: `Meeting notes${TAG}` });
    await new DbGraphOps(editor).setProperty('u', 'summarize', 'x', TAG);
    expect(writes).toEqual([]);
  });

  // Observed against a real DB graph: upsertBlockProperty fails with
  // "Property :summarize doesn't exist yet" unless the property is defined first.
  it('defines the property before putting it on a block', async () => {
    const { editor, properties, defined } = fakeEditor({ title: 'Meeting notes' });
    await new DbGraphOps(editor).setProperty('u', 'summarize', 'A summary.', TAG);
    expect(defined).toEqual(['summarize']);
    expect(properties).toEqual([['summarize', 'A summary.']]);
  });

  it('still writes when the property was already defined', async () => {
    const { editor, properties } = fakeEditor({ title: 'x' }, { defineFails: true, autoCreates: true });
    await new DbGraphOps(editor).setProperty('u', 'summarize', 'A summary.', TAG);
    expect(properties).toEqual([['summarize', 'A summary.']]);
  });

  it('turns a refused property write into actionable advice', async () => {
    const { editor } = fakeEditor({ title: 'x' }, { defineFails: true });
    await expect(new DbGraphOps(editor).setProperty('u', 'summarize', 'v', TAG)).rejects.toThrow(
      /Could not write the "summarize" property.*doesn't exist yet.*"insert"/s,
    );
  });

  it('does not tag the block when the property write fails', async () => {
    const { editor, writes } = fakeEditor({ title: 'x' }, { defineFails: true });
    await expect(new DbGraphOps(editor).setProperty('u', 'summarize', 'v', TAG)).rejects.toThrow();
    expect(writes).toEqual([]);
  });

  it('explains itself when the host cannot set properties', async () => {
    const { editor } = fakeEditor({ title: 'Meeting notes' }, { props: false });
    await expect(new DbGraphOps(editor).setProperty('u', 'k', 'v', TAG)).rejects.toThrow(
      /cannot set block properties/i,
    );
  });

  it('writes nothing when the block is gone', async () => {
    const { editor, writes, properties } = fakeEditor(null);
    const ops = new DbGraphOps(editor);
    expect(await ops.readText('u')).toBeNull();
    await ops.replaceText('u', 'x', TAG);
    await ops.setProperty('u', 'k', 'v', TAG);
    expect(writes).toEqual([]);
    expect(properties).toEqual([]);
  });

  it('inserts children as blocks with no positional options', async () => {
    const { editor, inserts, insertOpts } = fakeEditor({ title: 'x' });
    await new DbGraphOps(editor).insertChild('u', 'a child');
    expect(inserts).toEqual(['a child']);
    expect(insertOpts).toEqual([undefined]);
  });
});

describe('rewriteSubtree', () => {
  const TREE = 'New root\n\t- New one\n\t- New two';

  /** A fake whose getBlock returns a subtree and records writes per uuid. */
  function treeEditor(root: Record<string, unknown>) {
    const writes: Array<[string, string]> = [];
    const removed: string[] = [];
    const inserted: Array<[string, string]> = [];
    let n = 0;
    const editor: EditorApi = {
      async getBlock(uuid) {
        if (uuid === 'root') return root;
        const find = (b: Record<string, unknown>): Record<string, unknown> | null => {
          if (b.uuid === uuid) return b;
          for (const c of (b.children as Record<string, unknown>[]) ?? []) {
            const hit = find(c);
            if (hit) return hit;
          }
          return null;
        };
        return find(root);
      },
      async updateBlock(uuid, content) {
        writes.push([uuid, content]);
      },
      async insertBlock(parent, content) {
        inserted.push([parent as string, content]);
        return { uuid: `new-${++n}` };
      },
      async removeBlock(uuid) {
        removed.push(uuid);
      },
      async checkEditing() {
        return false;
      },
      async getEditingBlockContent() {
        return '';
      },
    };
    return { editor, writes, removed, inserted };
  }

  it('file graph: updates in place, so every uuid survives', async () => {
    const { editor, writes, removed } = treeEditor({
      uuid: 'root',
      content: 'Old root',
      children: [
        { uuid: 'a', content: 'old one' },
        { uuid: 'b', content: 'old two' },
      ],
    });
    const kept = await new FileGraphOps(editor).rewriteSubtree('root', TREE, TAG);
    expect(writes.map(([u]) => u)).toEqual(['root', 'a', 'b']);
    expect(removed).toEqual([]);
    expect(kept).toBe(0);
  });

  it('file graph: tags only the block the command ran on', async () => {
    const { editor, writes } = treeEditor({
      uuid: 'root',
      content: 'Old root',
      children: [{ uuid: 'a', content: 'old one' }],
    });
    await new FileGraphOps(editor).rewriteSubtree('root', 'New root\n\t- New one', TAG);
    expect(writes[0][1]).toBe(`New root${TAG}`);
    // Tagging children would hide them from the next command's context.
    expect(writes[1][1]).toBe('New one');
  });

  it('file graph: keeps a child’s properties when rewriting its text', async () => {
    const { editor, writes } = treeEditor({
      uuid: 'root',
      content: 'Old root',
      children: [{ uuid: 'a', content: 'old one\nowner:: alice' }],
    });
    await new FileGraphOps(editor).rewriteSubtree('root', 'New root\n\t- New one', TAG);
    expect(writes[1][1]).toBe('New one\nowner:: alice');
  });

  it('file graph: removes an unreferenced surplus block', async () => {
    const { editor, removed } = treeEditor({
      uuid: 'root',
      content: 'Old root',
      children: [
        { uuid: 'a', content: 'old one' },
        { uuid: 'b', content: 'old two' },
      ],
    });
    const kept = await new FileGraphOps(editor).rewriteSubtree('root', 'R\n\t- merged', TAG);
    expect(removed).toEqual(['b']);
    expect(kept).toBe(0);
  });

  // id:: means Logseq has handed out a reference to this block.
  it('file graph: never removes a block carrying id::', async () => {
    const { editor, removed } = treeEditor({
      uuid: 'root',
      content: 'Old root',
      children: [
        { uuid: 'a', content: 'old one' },
        { uuid: 'b', content: 'old two\nid:: 6690a1b2-c3d4' },
      ],
    });
    const kept = await new FileGraphOps(editor).rewriteSubtree('root', 'R\n\t- merged', TAG);
    expect(removed).toEqual([]);
    expect(kept).toBe(1);
  });

  it('file graph: inserts when the rewrite has more lines', async () => {
    const { editor, inserted } = treeEditor({ uuid: 'root', content: 'Old', children: [] });
    await new FileGraphOps(editor).rewriteSubtree('root', 'R\n\t- one\n\t\t- deep\n\t- two', TAG);
    expect(inserted).toEqual([
      ['root', 'one'],
      ['new-1', 'deep'],
      ['root', 'two'],
    ]);
  });

  // A DB graph gives no way to ask what links to a block, so nothing is deleted.
  it('db graph: keeps every surplus block instead of deleting it', async () => {
    const { editor, removed } = treeEditor({
      uuid: 'root',
      title: 'Old root',
      children: [
        { uuid: 'a', title: 'old one' },
        { uuid: 'b', title: 'old two' },
      ],
    });
    const kept = await new DbGraphOps(editor).rewriteSubtree('root', 'R\n\t- merged', TAG);
    expect(removed).toEqual([]);
    expect(kept).toBe(1);
  });

  it('refuses to write back an empty reply', async () => {
    const { editor, writes } = treeEditor({ uuid: 'root', content: 'Old', children: [] });
    await expect(new FileGraphOps(editor).rewriteSubtree('root', '   \n\n', TAG)).rejects.toThrow(
      /nothing to write back/i,
    );
    expect(writes).toEqual([]);
  });
});
