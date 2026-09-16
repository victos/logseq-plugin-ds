/**
 * Minimal cases the property-based harness (`fuzz.test.ts`) found and shrank.
 * Each one is a way a rewrite, an append or an insert could damage a note;
 * they are pinned here so that a future change trips a named test rather
 * than a seed.
 */
import { describe, expect, it } from 'vitest';
import {
  appendToText,
  blockToText,
  closeFences,
  composeReplace,
  fenceRoles,
  isFenceLine,
  splitProperties,
  withTag,
  withoutIdProperty,
} from '../src/block';
import { parseOutline } from '../src/outline';
import { EditorApi, FileGraphOps } from '../src/graph';

const TAG = ' #[[🤖]]';

interface Tree {
  content: string;
  children?: Tree[];
}

/** A file graph in memory: enough of `logseq.Editor` for a rewrite to run against. */
function memoryGraph(root: Tree) {
  type Node = { uuid: string; content: string; children: Node[]; parent: Node | null };
  const nodes = new Map<string, Node>();
  let n = 0;
  const add = (tree: Tree, parent: Node | null): Node => {
    const node: Node = { uuid: `b${++n}`, content: tree.content, children: [], parent };
    nodes.set(node.uuid, node);
    node.children = (tree.children ?? []).map((child) => add(child, node));
    return node;
  };
  add(root, null);
  const removed: string[] = [];
  const serialize = (node: Node): Record<string, unknown> => ({
    uuid: node.uuid,
    content: node.content,
    children: node.children.map(serialize),
  });
  const editor: EditorApi = {
    async getBlock(uuid) {
      const node = nodes.get(uuid);
      return node ? serialize(node) : null;
    },
    async updateBlock(uuid, content) {
      nodes.get(uuid)!.content = content;
    },
    async insertBlock(uuid, content, opts) {
      const target = nodes.get(uuid)!;
      const fresh: Node = { uuid: `n${++n}`, content, children: [], parent: null };
      if (opts?.sibling) {
        const siblings = target.parent!.children;
        siblings.splice(siblings.indexOf(target) + 1, 0, fresh);
        fresh.parent = target.parent;
      } else {
        target.children.push(fresh);
        fresh.parent = target;
      }
      nodes.set(fresh.uuid, fresh);
      return { uuid: fresh.uuid };
    },
    async removeBlock(uuid) {
      const node = nodes.get(uuid)!;
      node.parent!.children.splice(node.parent!.children.indexOf(node), 1);
      removed.push(uuid);
    },
    async checkEditing() {
      return false;
    },
    async getEditingBlockContent() {
      return '';
    },
  };
  const content = (uuid: string) => nodes.get(uuid)?.content;
  const outline = (): string => {
    const walk = (node: Node, depth: number): string[] => [
      `${'  '.repeat(depth)}${JSON.stringify(node.content)}`,
      ...node.children.flatMap((child) => walk(child, depth + 1)),
    ];
    return walk(nodes.get('b1')!, 0).join('\n');
  };
  return { editor, ops: new FileGraphOps(editor), content, outline, removed };
}

describe('an unclosed code fence in a block', () => {
  it('is closed in the outline sent to the model, so it cannot swallow the points after it', () => {
    const text = blockToText({ content: '```\ncode', children: [{ content: 'T' }] });
    expect(text).toBe('```\ncode\n```\n\t- T');
    expect(closeFences('```\n```\n```')).toBe('```\n```\n```\n```');
    expect(closeFences('~~~\n```')).toBe('~~~\n```\n~~~');
  });

  it('does not lose the sibling block on an identity rewrite', async () => {
    const g = memoryGraph({ content: '```\ncode', children: [{ content: 'T' }] });
    const context = await g.ops.readContext('b1', TAG);
    await g.ops.rewriteSubtree('b1', context, TAG);
    expect(g.removed).toEqual([]);
    expect(g.content('b2')).toBe('T');
  });

  it('is not a fence to splitProperties when nothing closes it below', () => {
    expect(splitProperties('```\ncode\nid:: 1')).toEqual({ body: '```\ncode', properties: ['id:: 1'] });
  });

  it('is closed before anything is appended below it', () => {
    expect(appendToText('Intro\n```\ncode', 'More.')).toBe('Intro\n```\ncode\n```\nMore.');
    expect(withTag('```\ncode', TAG)).toBe('```\ncode\n```\n#[[🤖]]');
  });
});

describe('a Markdown list inside one block', () => {
  it('stays inside the block when the outline is tab-indented', () => {
    expect(parseOutline('a\n\t- s\n\t  1. s')).toEqual({
      text: 'a',
      children: [{ text: 's\n1. s', children: [] }],
    });
    expect(parseOutline('Root\n- item\n- more\n\t- child')).toEqual({
      text: 'Root\n- item\n- more',
      children: [{ text: 'child', children: [] }],
    });
  });

  it('round-trips through a rewrite unchanged', async () => {
    const g = memoryGraph({ content: 'Shopping', children: [{ content: 'Dairy\n- eggs\n- milk' }] });
    const context = await g.ops.readContext('b1', TAG);
    await g.ops.rewriteSubtree('b1', context, TAG);
    expect(g.content('b2')).toBe('Dairy\n- eggs\n- milk');
    expect(g.outline()).toBe('"Shopping #[[🤖]]"\n  "Dairy\\n- eggs\\n- milk"');
  });

  // With no tab anywhere there is nothing to tell a list line from a sub-point.
  it('is split into sub-points in a space-indented outline (known limitation)', () => {
    expect(parseOutline('Root\n  - a\n    - b')).toEqual({
      text: 'Root',
      children: [{ text: 'a', children: [{ text: 'b', children: [] }] }],
    });
  });
});

describe('code fence markers', () => {
  it('are not closed by a line with an info string', () => {
    expect(fenceRoles(['```', '```js', 'key:: v', '```'])).toEqual(['open', 'code', 'code', 'close']);
    expect(splitProperties('```\n```js\nkey:: v\n```').properties).toEqual([]);
  });

  it('are not opened by a line that starts with an inline span', () => {
    expect(isFenceLine('```x``` typed')).toBe(false);
    expect(splitProperties('```x``` more\nid:: 1')).toEqual({ body: '```x``` more', properties: ['id:: 1'] });
  });

  it('spoiled by the model do not run into the next point', () => {
    expect(parseOutline('Root\n\t- ```py\n\t  code\n\t  ``` oops\n\t- Two\n\t  ```\n\t  x\n\t  ```')).toEqual({
      text: 'Root',
      children: [
        { text: '```py\ncode\n``` oops', children: [] },
        { text: 'Two\n```\nx\n```', children: [] },
      ],
    });
  });

  it('open on the bullet line of a point that is a code block', () => {
    expect(parseOutline('a\n\t- ```\n\t  ```\n\t\t- ```\n\t\t  ```')).toEqual({
      text: 'a',
      children: [{ text: '```\n```', children: [{ text: '```\n```', children: [] }] }],
    });
  });
});

describe('a reply wrapped in a code fence', () => {
  it('is unwrapped instead of becoming one code block that deletes every child', async () => {
    const g = memoryGraph({ content: 'Root', children: [{ content: 'A' }, { content: 'B' }] });
    await g.ops.rewriteSubtree('b1', '```markdown\nRoot!\n\t- A!\n\t- B!\n```', TAG);
    expect(g.removed).toEqual([]);
    expect(g.outline()).toBe('"Root! #[[🤖]]"\n  "A!"\n  "B!"');
  });

  it('is unwrapped when the outline inside has fences of its own', () => {
    expect(parseOutline('```markdown\nRoot\n\t- ```js\n\t  x()\n\t  ```\n```', { unwrapFence: true })).toEqual({
      text: 'Root',
      children: [{ text: '```js\nx()\n```', children: [] }],
    });
  });

  it('loses only the opener when the model never closed it', () => {
    expect(parseOutline('```\nRoot\n\t- A\n\t  ```\n\t  x\n\t  ```', { unwrapFence: true })).toEqual({
      text: 'Root',
      children: [{ text: 'A\n```\nx\n```', children: [] }],
    });
    expect(parseOutline('```\ns\n```\n```\n\t- ```\n\t  ```', { unwrapFence: true })).toEqual({
      text: 's\n```\n```',
      children: [{ text: '```\n```', children: [] }],
    });
  });

  it('keeps a code block\'s own opener when a spoiled fence elsewhere leaves a marker unpaired', () => {
    expect(parseOutline('```\n```\n\t- #\n\t  ```\n\t  ``` ~~~', { unwrapFence: false })).toEqual({
      text: '```\n```',
      children: [{ text: '#\n```\n``` ~~~', children: [] }],
    });
  });

  it('is content when the block being rewritten is itself a code block', async () => {
    const g = memoryGraph({ content: '```js\nx()\n```' });
    await g.ops.rewriteSubtree('b1', '```js\ny()\n```', TAG);
    expect(g.content('b1')).toBe('```js\ny()\n```\n#[[🤖]]');
    // Unless the reply's fence says "markdown" and the block's own does not: that is a wrapper.
    const h = memoryGraph({ content: '```\nx()\n```', children: [{ content: 'A' }] });
    await h.ops.rewriteSubtree('b1', '```markdown\n```\ny()\n```\n\t- A!\n```', TAG);
    expect(h.removed).toEqual([]);
    expect(h.outline()).toBe('"```\\ny()\\n```\\n#[[🤖]]"\n  "A!"');
    expect(parseOutline('```\n```\n\t- A', { unwrapFence: false })).toEqual({
      text: '```\n```',
      children: [{ text: 'A', children: [] }],
    });
  });
});

describe('the root line of a reply', () => {
  it('keeps a numbered marker, which is the block\'s own text, and drops a "- " the model added', () => {
    expect(parseOutline('1. First step\n\t- a')!.text).toBe('1. First step');
    expect(parseOutline('- Root\n\t- a')!.text).toBe('Root');
  });
});

describe('CRLF line endings in a reply', () => {
  it('are read like LF instead of collapsing the outline into the root', () => {
    expect(parseOutline('Root\r\n\t- A\r\n\t- B')).toEqual({
      text: 'Root',
      children: [{ text: 'A', children: [] }, { text: 'B', children: [] }],
    });
  });
});

describe('appending to a block', () => {
  it('starts a new line when the addition opens a fence, table, quote, list or heading', () => {
    expect(appendToText('a', '```\ncode\n```')).toBe('a\n```\ncode\n```');
    expect(appendToText('a', '| x | y |')).toBe('a\n| x | y |');
    expect(appendToText('a', '# Heading')).toBe('a\n# Heading');
    expect(appendToText('a', 'more prose')).toBe('a more prose');
  });

  it('puts the tag below a property line rather than into its value', () => {
    expect(withTag('text\nowner:: x', TAG)).toBe('text\nowner:: x\n#[[🤖]]');
  });
});

describe('property lines written by the model', () => {
  it('become properties once, never a second copy on the next pass', () => {
    const once = composeReplace('Old\nowner:: alice', 'New\nowner:: model\ntags:: x', '');
    expect(once).toBe('New\nowner:: alice\ntags:: x');
    expect(composeReplace(once, 'New\nowner:: model\ntags:: x', '')).toBe(once);
  });

  it('never carry an id:: line onto a file-graph block', async () => {
    expect(withoutIdProperty('New\nid:: 64a1\nmore')).toBe('New\nmore');
    expect(withoutIdProperty('```\nid:: 64a1\n```')).toBe('```\nid:: 64a1\n```');
    const g = memoryGraph({ content: 'Old' });
    await g.ops.replaceText('b1', 'New\nid:: 64a1', TAG);
    expect(g.content('b1')).toBe('New #[[🤖]]');
  });

  it('are laid out the same in an inserted block as in a rewritten one', async () => {
    const g = memoryGraph({ content: 'R' });
    await g.ops.rewriteSubtree('b1', 'R\n\t- 1. s\n\t  owner:: m', TAG);
    expect(g.content('n2')).toBe('owner:: m\n1. s');
  });
});

describe('a surplus block with notes the model was not shown', () => {
  const answer = (children: Tree[] = []): Tree => ({ content: `Answer${TAG}`, children });

  it('is kept when a note of the user\'s sits under the plugin\'s answer beneath it', async () => {
    const g = memoryGraph({ content: 'R', children: [{ content: 'A', children: [answer([{ content: 'my note' }])] }] });
    expect(await g.ops.rewriteSubtree('b1', 'R', TAG)).toBe(1);
    expect(g.removed).toEqual([]);
  });

  it('goes with its answer when nothing but the plugin\'s own output is beneath it', async () => {
    const g = memoryGraph({ content: 'R', children: [{ content: 'A', children: [answer()] }] });
    expect(await g.ops.rewriteSubtree('b1', 'R', TAG)).toBe(0);
    expect(g.removed).toEqual(['b2']);
  });
});
