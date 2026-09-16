import { describe, expect, it } from 'vitest';
import { ExistingBlock, OutlineNode, parseOutline, planRewrite, renderOutline } from '../src/outline';

const node = (text: string, ...children: OutlineNode[]): OutlineNode => ({ text, children });

const block = (uuid: string, text: string, opts: { linked?: boolean; children?: ExistingBlock[] } = {}): ExistingBlock => ({
  uuid,
  text,
  linked: opts.linked ?? false,
  children: opts.children ?? [],
});

describe('parseOutline', () => {
  it('reads the tree the model was asked to mirror', () => {
    expect(parseOutline('Root\n\t- One\n\t\t- Deep\n\t- Two')).toEqual(
      node('Root', node('One', node('Deep')), node('Two')),
    );
  });

  it('accepts spaces, bullets and numbering', () => {
    expect(parseOutline('Root\n  * One\n    1. Deep\n  - Two')).toEqual(
      node('Root', node('One', node('Deep')), node('Two')),
    );
  });

  it('survives over-indentation instead of losing the line', () => {
    expect(parseOutline('Root\n\t\t\t\t- One')).toEqual(node('Root', node('One')));
  });

  it('ignores blank lines', () => {
    expect(parseOutline('Root\n\n\t- One\n\n')).toEqual(node('Root', node('One')));
  });

  it('returns null for an empty reply', () => {
    expect(parseOutline('   \n\n')).toBeNull();
  });

  it('round-trips through renderOutline', () => {
    const tree = node('Root', node('One', node('Deep')), node('Two'));
    expect(parseOutline(renderOutline(tree))).toEqual(tree);
  });

  it('uses the first non-blank line as the root even when it is bulleted', () => {
    expect(parseOutline('\n- Root\n\t- One')).toEqual(node('Root', node('One')));
  });

  // A block is not one line. Before this, /Polish on a two-paragraph block came
  // back as the first paragraph plus one new child block per remaining line.
  it('keeps a multi-line root together, blank lines included', () => {
    expect(parseOutline('Para one\nstill para one\n\nPara two\n\t- One')).toEqual(
      node('Para one\nstill para one\n\nPara two', node('One')),
    );
  });

  it('keeps the continuation lines of a child with the child', () => {
    expect(parseOutline('Root\n\t- L1\n\t  L2\n\t- Two')).toEqual(
      node('Root', node('L1\nL2'), node('Two')),
    );
  });

  it('attaches a continuation to the point it is aligned with', () => {
    expect(parseOutline('Root\n\t- A\n\t\t- B\n\t  more of A\nmore of root')).toEqual(
      node('Root\nmore of root', node('A\nmore of A', node('B'))),
    );
  });

  it('keeps a fenced code block as one point, bullets and indentation inside included', () => {
    const code = 'Root\n```js\n- not a bullet\n  if (x) {\n    y();\n  }\n```\n\t- One';
    expect(parseOutline(code)).toEqual(
      node('Root\n```js\n- not a bullet\n  if (x) {\n    y();\n  }\n```', node('One')),
    );
    expect(parseOutline('Root\n\t- Code:\n\t  ```\n\t  - x\n\t  ```\n\t- Two')).toEqual(
      node('Root', node('Code:\n```\n- x\n```'), node('Two')),
    );
  });

  it('does not mistake inline backticks on a line for an open fence', () => {
    expect(parseOutline('Root\n```inline```\n\t- One')).toEqual(node('Root\n```inline```', node('One')));
  });

  it('round-trips multi-line points through renderOutline', () => {
    const tree = node('Root\nmore', node('One\n\ntwo lines', node('Deep')), node('Two'));
    expect(renderOutline(tree)).toBe('Root\nmore\n\t- One\n\t  \n\t  two lines\n\t\t- Deep\n\t- Two');
    expect(parseOutline(renderOutline(tree))).toEqual(tree);
  });
});

describe('planRewrite', () => {
  it('updates in place so uuids and their references survive', () => {
    const steps = planRewrite('root', node('New root', node('New one'), node('New two')), [
      block('a', 'old one'),
      block('b', 'old two'),
    ]);
    expect(steps).toEqual([
      { op: 'update', uuid: 'root', text: 'New root' },
      { op: 'update', uuid: 'a', text: 'New one' },
      { op: 'update', uuid: 'b', text: 'New two' },
    ]);
  });

  // The whole point of allowing the count to change: /Expand may split a line.
  it('inserts when the rewrite has more lines', () => {
    const steps = planRewrite('root', node('R', node('one'), node('two'), node('three')), [block('a', 'x')]);
    expect(steps).toEqual([
      { op: 'update', uuid: 'root', text: 'R' },
      { op: 'update', uuid: 'a', text: 'one' },
      { op: 'insert', parent: 'root', text: 'two', children: [], after: 'a' },
      { op: 'insert', parent: 'root', text: 'three', children: [], after: 'a' },
    ]);
  });

  // ...and /Shorten may merge two lines into one.
  it('removes the surplus when the rewrite has fewer lines', () => {
    const steps = planRewrite('root', node('R', node('merged')), [block('a', 'x'), block('b', 'y')]);
    expect(steps).toEqual([
      { op: 'update', uuid: 'root', text: 'R' },
      { op: 'update', uuid: 'a', text: 'merged' },
      { op: 'remove', uuid: 'b' },
    ]);
  });

  // Deleting a linked block breaks every ((ref)) to it, permanently.
  it('never removes a block something links to', () => {
    const steps = planRewrite('root', node('R', node('merged')), [
      block('a', 'x'),
      block('b', 'y', { linked: true }),
    ]);
    expect(steps).toContainEqual({ op: 'keep', uuid: 'b', reason: 'linked' });
    expect(steps.some((s) => s.op === 'remove')).toBe(false);
  });

  it('keeps a block whose descendant is linked', () => {
    const steps = planRewrite('root', node('R'), [
      block('a', 'x', { children: [block('a1', 'deep', { linked: true })] }),
    ]);
    expect(steps).toContainEqual({ op: 'keep', uuid: 'a', reason: 'linked' });
    expect(steps.some((s) => s.op === 'remove')).toBe(false);
  });

  it('recurses into grandchildren', () => {
    const steps = planRewrite('root', node('R', node('one', node('deep'))), [
      block('a', 'x', { children: [block('a1', 'y')] }),
    ]);
    expect(steps).toEqual([
      { op: 'update', uuid: 'root', text: 'R' },
      { op: 'update', uuid: 'a', text: 'one' },
      { op: 'update', uuid: 'a1', text: 'deep' },
    ]);
  });

  it('carries the subtree of an inserted line', () => {
    const steps = planRewrite('root', node('R', node('new', node('child'))), []);
    expect(steps).toContainEqual({
      op: 'insert',
      parent: 'root',
      text: 'new',
      children: [node('child')],
    });
  });

  // /Expand adding a sub-point under an existing child must put it there, not
  // under the root. (A mutation making every insert go under the root survived
  // the suite before this test.)
  it('inserts a surplus grandchild under its own parent', () => {
    const steps = planRewrite('root', node('R', node('one', node('deep1'), node('deep2'))), [
      block('a', 'x', { children: [block('a1', 'y')] }),
    ]);
    expect(steps).toEqual([
      { op: 'update', uuid: 'root', text: 'R' },
      { op: 'update', uuid: 'a', text: 'one' },
      { op: 'update', uuid: 'a1', text: 'deep1' },
      { op: 'insert', parent: 'a', text: 'deep2', children: [], after: 'a1' },
    ]);
  });

  it('rewrites only the root when there are no children either side', () => {
    expect(planRewrite('root', node('Just this'), [])).toEqual([
      { op: 'update', uuid: 'root', text: 'Just this' },
    ]);
  });
});

describe('parseOutline on shapes a note can take', () => {
  it('attaches a later grandchild to its own parent, not to an earlier one', () => {
    expect(parseOutline('Root\n\t- A\n\t\t- B\n\t- C\n\t\t- D')).toEqual(
      node('Root', node('A', node('B')), node('C', node('D'))),
    );
  });

  it('drops an empty bullet instead of opening an empty point', () => {
    expect(parseOutline('Root\n\t- \n\t- One\n\t-   ')).toEqual(node('Root', node('One')));
  });

  it('trims trailing whitespace from points and continuation lines', () => {
    expect(parseOutline('Root  \n\t- One \n\t  more  ')).toEqual(node('Root', node('One\nmore')));
  });

  // A child block that is nothing but a code block: the bullet line itself
  // opens the fence, and the closing fence must not be read as an opener.
  it('keeps a point that opens with a code fence together, and the next point apart', () => {
    expect(parseOutline('Root\n\t- ```js\n\t  x()\n\t  ```\n\t- Two')).toEqual(
      node('Root', node('```js\nx()\n```'), node('Two')),
    );
    expect(parseOutline('```js\nx()\n```\n\t- One')).toEqual(node('```js\nx()\n```', node('One')));
  });

  it('keeps the indentation of code inside a bulleted point', () => {
    expect(parseOutline('Root\n\t- Code:\n\t  ```\n\t\tindented\n\t  ```\n\t- Two')).toEqual(
      node('Root', node('Code:\n```\n\tindented\n```'), node('Two')),
    );
  });

  it('gives a continuation aligned with no point to the point at its indent depth', () => {
    expect(parseOutline('Root\n\t- A\n\t\t- B\n\t\tmore of B')).toEqual(
      node('Root', node('A', node('B\nmore of B'))),
    );
  });
});

describe('planRewrite places what it inserts', () => {
  it('anchors a surplus line after the last block that took one', () => {
    const steps = planRewrite('root', node('R', node('one'), node('two')), [block('a', 'x')]);
    expect(steps).toContainEqual({ op: 'insert', parent: 'root', text: 'two', children: [], after: 'a' });
  });

  it('leaves the anchor out when the parent had no block the model saw', () => {
    const steps = planRewrite('root', node('R', node('one')), []);
    expect(steps[1]).toEqual({ op: 'insert', parent: 'root', text: 'one', children: [] });
    expect(steps[1]).not.toHaveProperty('after');
  });
});
