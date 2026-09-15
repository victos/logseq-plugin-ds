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
  return { editor, writes, inserts, insertOpts, properties, defined };
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
    expect(await new FileGraphOps(editor).readContext('u')).toBe('Meeting notes\n\t- Churn rose');
  });

  it('uses the editor buffer for the root while the block is being edited', async () => {
    const { editor } = fakeEditor(
      { content: saved, children: [{ content: 'Churn rose' }] },
      { editing: 'u', buffer: 'Being typed\nowner:: alice' },
    );
    expect(await new FileGraphOps(editor).readContext('u')).toBe('Being typed\n\t- Churn rose');
  });

  it('ignores the editor buffer when a different block is being edited', async () => {
    const { editor } = fakeEditor({ content: saved }, { editing: 'other', buffer: 'elsewhere' });
    expect(await new FileGraphOps(editor).readContext('u')).toBe('Meeting notes');
  });

  // Newer Logseq builds type `content` as optional and put the markdown in `title`.
  it('falls back to a string title when content is absent', async () => {
    const { editor, writes } = fakeEditor({ title: 'Notes\nid:: abc', children: [{ title: 'Kid' }] });
    const ops = new FileGraphOps(editor);
    expect(await ops.readContext('u')).toBe('Notes\n\t- Kid');
    await ops.replaceText('u', 'New', TAG);
    expect(writes).toEqual([`New${TAG}\nid:: abc`]);
  });

  it('does not mistake an AST title (old builds) for content', async () => {
    const { editor } = fakeEditor({ content: 'Real', title: ['Paragraph', ['Plain', 'Real']] });
    expect(await new FileGraphOps(editor).readContext('u')).toBe('Real');
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
    expect(await new DbGraphOps(editor).readContext('u')).toBe('being typed\n\t- kid');
  });

  it('treats a non-string title as empty rather than leaking it', async () => {
    const { editor, writes } = fakeEditor({ title: ['Paragraph'], content: 'compat' });
    const ops = new DbGraphOps(editor);
    expect(await ops.readText('u')).toBe('compat');
    expect(await ops.readContext('u')).toBe('compat');
    await ops.appendText('u', 'more', TAG);
    expect(writes).toEqual([`compat more${TAG}`]);
  });

  it('walks children by title', async () => {
    const { editor } = fakeEditor({
      title: 'Priorities?',
      children: [{ title: 'Churn rose', children: [{ title: 'from 3% to 5%' }] }],
    });
    expect(await new DbGraphOps(editor).readContext('u')).toBe(
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
