import { describe, expect, it } from 'vitest';
import { dbText } from '../src/graph';
import {
  BlockReader,
  blockToText,
  composeAppend,
  composeProperty,
  composeReplace,
  fileText,
  isHiddenProperty,
  joinBlock,
  mergeContent,
  propertyKey,
  propertyValue,
  readCurrentContent,
  splitProperties,
  stripTag,
  tagSuffix,
  withTag,
} from '../src/block';

const TAG = ' #[[🤖]]';

describe('splitProperties', () => {
  it('returns plain text untouched', () => {
    expect(splitProperties('Just a line')).toEqual({ body: 'Just a line', properties: [] });
  });

  it('separates property lines from the text', () => {
    expect(splitProperties('Title\nid:: 64a1\ncollapsed:: true\nmore text')).toEqual({
      body: 'Title\nmore text',
      properties: ['id:: 64a1', 'collapsed:: true'],
    });
  });

  it('accepts a bare key with no value and trims indentation', () => {
    expect(splitProperties('Title\n  todo::').properties).toEqual(['todo::']);
  });

  it('does not treat C++-style scopes or inline :: as properties', () => {
    const text = 'std::vector<int> v;\nsee a::b here';
    expect(splitProperties(text)).toEqual({ body: text, properties: [] });
  });

  it('ignores property-looking lines inside fenced code', () => {
    const text = 'Example\n```yaml\nkey:: value\n```\nreal:: yes';
    expect(splitProperties(text)).toEqual({
      body: 'Example\n```yaml\nkey:: value\n```',
      properties: ['real:: yes'],
    });
  });

  it('handles a properties-only block', () => {
    expect(splitProperties('title:: Page\ntags:: a, b')).toEqual({
      body: '',
      properties: ['title:: Page', 'tags:: a, b'],
    });
  });
});

describe('blockToText', () => {
  it('returns the root text when there are no children', () => {
    expect(blockToText({ content: 'Root' })).toBe('Root');
    expect(blockToText({ content: 'Root', children: [] })).toBe('Root');
  });

  it('tolerates a block without a children array and null content', () => {
    expect(blockToText({ content: null, children: undefined })).toBe('');
    expect(blockToText({ content: 'Root', children: [{ content: 'Leaf' }] })).toBe('Root\n\t- Leaf');
  });

  it('indents nested children with tabs, one level per depth', () => {
    const block = {
      content: 'Root',
      children: [
        { content: 'A', children: [{ content: 'A1', children: [{ content: 'A1a' }] }] },
        { content: 'B' },
      ],
    };
    expect(blockToText(block)).toBe('Root\n\t- A\n\t\t- A1\n\t\t\t- A1a\n\t- B');
  });

  it('skips uuid tuples returned when children are not expanded', () => {
    expect(blockToText({ content: 'Root', children: [['uuid', 'abc'], { content: 'Real' }] })).toBe(
      'Root\n\t- Real',
    );
  });

  it('drops property lines from the root and from children', () => {
    const block = {
      content: 'Root\nid:: 1\nsummarize:: old',
      children: [{ content: 'Child\ncollapsed:: true' }],
    };
    expect(blockToText(block)).toBe('Root\n\t- Child');
  });

  it('indents continuation lines of multi-line children', () => {
    expect(blockToText({ content: 'Root', children: [{ content: 'L1\nL2' }] })).toBe(
      'Root\n\t- L1\n\t  L2',
    );
  });

  it('still descends into a child whose own text is empty', () => {
    expect(
      blockToText({ content: 'Root', children: [{ content: '', children: [{ content: 'Deep' }] }] }),
    ).toBe('Root\n\t\t- Deep');
  });
});

describe('propertyKey', () => {
  it.each([
    ['Summarize', 'summarize'],
    ['Ask AI', 'ask-ai'],
    ['Markdown Table', 'markdown-table'],
    ['  Weird!!  Name: v2 ', 'weird-name-v2'],
    ['snake_case.ok', 'snake_case.ok'],
    ['总结', '总结'],
    ['', 'ai'],
    ['!!!', 'ai'],
    ['123', 'ai-123'],
  ])('%j -> %j', (name, expected) => {
    expect(propertyKey(name)).toBe(expected);
  });
});

describe('propertyValue', () => {
  it('folds newlines and whitespace runs into single spaces', () => {
    expect(propertyValue('  one\ntwo\n\n  three  ')).toBe('one two three');
  });
});

describe('tagSuffix', () => {
  it('builds the suffix and tolerates a user-supplied # or blanks', () => {
    expect(tagSuffix('[[🤖]]')).toBe(' #[[🤖]]');
    expect(tagSuffix('#ai')).toBe(' #ai');
    expect(tagSuffix('  ')).toBe('');
    expect(tagSuffix(undefined)).toBe('');
  });
});

describe('withTag / stripTag', () => {
  it('appends the tag once', () => {
    expect(withTag('text', TAG)).toBe('text #[[🤖]]');
    expect(withTag('text #[[🤖]]', TAG)).toBe('text #[[🤖]]');
    expect(withTag('text', '')).toBe('text');
    expect(withTag('', TAG)).toBe('#[[🤖]]');
  });

  it('removes the tag from model input without leaving trailing spaces', () => {
    expect(stripTag('line one #[[🤖]]\n\t- child #[[🤖]]', TAG)).toBe('line one\n\t- child');
    expect(stripTag('untouched', '')).toBe('untouched');
  });
});

describe('joinBlock', () => {
  it('puts properties right after the first line', () => {
    expect(joinBlock('L1\nL2', ['a:: 1'])).toBe('L1\na:: 1\nL2');
    expect(joinBlock('L1', [])).toBe('L1');
    expect(joinBlock('', ['a:: 1'])).toBe('a:: 1');
  });
});

describe('composeProperty', () => {
  it('matches the original layout for a single-line block', () => {
    expect(composeProperty('Some text', 'summarize', 'A summary', TAG)).toBe(
      'Some text #[[🤖]]\nsummarize:: A summary',
    );
  });

  it('keeps existing properties on their own lines instead of tagging them', () => {
    expect(composeProperty('Some text\ncollapsed:: true\nid:: 64a1', 'summarize', 'S', TAG)).toBe(
      'Some text #[[🤖]]\ncollapsed:: true\nid:: 64a1\nsummarize:: S',
    );
  });

  it('overwrites a previous value of the same key and does not double the tag', () => {
    const once = composeProperty('Text', 'summarize', 'first', TAG);
    expect(composeProperty(once, 'summarize', 'second', TAG)).toBe(
      'Text #[[🤖]]\nsummarize:: second',
    );
  });

  it('flattens multi-line values so the property stays on one line', () => {
    expect(composeProperty('Text', 'summarize', 'para one\n\npara two', '')).toBe(
      'Text\nsummarize:: para one para two',
    );
  });
});

describe('composeAppend / composeReplace', () => {
  it('appends after the text, not after a property line', () => {
    expect(composeAppend('Text\nid:: 64a1', 'more', TAG)).toBe('Text more #[[🤖]]\nid:: 64a1');
    expect(composeAppend('', 'only', TAG)).toBe('only #[[🤖]]');
  });

  it('replaces the text but preserves properties', () => {
    expect(composeReplace('Old\nsource:: [[Paper]]\nid:: 64a1', 'New', TAG)).toBe(
      'New #[[🤖]]\nsource:: [[Paper]]\nid:: 64a1',
    );
    expect(composeReplace('Old', 'New', '')).toBe('New');
  });
});

describe('isHiddenProperty', () => {
  it('knows the keys Logseq hides from the editor', () => {
    for (const key of ['id', 'collapsed', 'heading', 'ID', 'logseq.order-list-type', 'card-last-score']) {
      expect(isHiddenProperty(key)).toBe(true);
    }
    for (const key of ['owner', 'summarize', 'tags', 'source', 'idea']) {
      expect(isHiddenProperty(key)).toBe(false);
    }
  });
});

describe('mergeContent', () => {
  const saved = 'Old text\nid:: 64a1\ncollapsed:: true\nowner:: alice';

  it('restores hidden built-ins the editor does not show', () => {
    expect(mergeContent('New text\nowner:: alice', saved)).toBe(
      'New text\nowner:: alice\nid:: 64a1\ncollapsed:: true',
    );
  });

  it('is a no-op when the editor text already carries the hidden properties', () => {
    const full = 'New text\nid:: 64a1\ncollapsed:: true\nowner:: alice';
    expect(mergeContent(full, saved)).toBe(full);
    expect(mergeContent(saved, saved)).toBe(saved);
  });

  it('lets an edited visible property win over the saved value', () => {
    expect(mergeContent('New text\nowner:: bob', saved)).toBe(
      'New text\nowner:: bob\nid:: 64a1\ncollapsed:: true',
    );
  });

  it('keeps a visible property deleted in the editor deleted, but never drops id::', () => {
    expect(mergeContent('New text', saved)).toBe('New text\nid:: 64a1\ncollapsed:: true');
  });

  it('handles an empty editor buffer and a saved block without properties', () => {
    expect(mergeContent('', saved)).toBe('id:: 64a1\ncollapsed:: true');
    expect(mergeContent('Typed', 'Old')).toBe('Typed');
  });

  it('feeds the compose helpers a block whose hidden properties survive a replace', () => {
    const merged = mergeContent('Typed text', saved);
    expect(composeReplace(merged, 'Rewritten', TAG)).toBe(
      'Rewritten #[[🤖]]\nid:: 64a1\ncollapsed:: true',
    );
  });
});

describe('readCurrentContent', () => {
  const uuid = 'b1';
  const saved = 'Saved\nid:: 64a1';
  const reader = (overrides: Partial<BlockReader>): BlockReader => ({
    getBlock: async () => ({ content: saved }),
    checkEditing: async () => false,
    getEditingBlockContent: async () => 'Live',
    ...overrides,
  });

  it('returns the saved content when the block is not being edited', async () => {
    await expect(readCurrentContent(reader({}), uuid)).resolves.toBe(saved);
  });

  it('merges the editor text over the saved content when this block is being edited', async () => {
    await expect(readCurrentContent(reader({ checkEditing: async () => uuid }), uuid)).resolves.toBe(
      'Live\nid:: 64a1',
    );
  });

  it('ignores the editor when a different block is being edited', async () => {
    await expect(readCurrentContent(reader({ checkEditing: async () => 'other' }), uuid)).resolves.toBe(
      saved,
    );
  });

  it('returns null when the block was deleted, even if the editor still reports it', async () => {
    const gone = reader({ getBlock: async () => null, checkEditing: async () => uuid });
    await expect(readCurrentContent(gone, uuid)).resolves.toBeNull();
  });

  it('treats a block with null content as empty', async () => {
    await expect(readCurrentContent(reader({ getBlock: async () => ({ content: null }) }), uuid)).resolves.toBe('');
  });
});

describe('AI output is not fed back in', () => {
  const TAG = ' #[[🤖]]';

  // Reported in use: /Ask AI inserted its answer as a child, then /Tone rewrote
  // the question *and that answer* and replaced the block with the result — which
  // reads exactly like the command having answered the question.
  it('skips a child the plugin wrote earlier', () => {
    const block = {
      content: "Greetings. What is today's date?",
      children: [{ content: `Today's date is September 15, 2026.${TAG}` }],
    };
    expect(blockToText(block, fileText, TAG)).toBe("Greetings. What is today's date?");
  });

  it('skips the whole AI branch, not just its top block', () => {
    const block = {
      content: 'Ideas',
      children: [
        { content: `An idea${TAG}`, children: [{ content: 'elaboration of the idea' }] },
        { content: 'my own note' },
      ],
    };
    expect(blockToText(block, fileText, TAG)).toBe('Ideas\n\t- my own note');
  });

  it('keeps the root even after it has been rewritten in place', () => {
    const block = { content: `Rewritten text${TAG}`, children: [{ content: 'my note' }] };
    expect(blockToText(block, fileText, TAG)).toBe(`Rewritten text${TAG}\n\t- my note`);
  });

  it('keeps every child when tagging is switched off', () => {
    const block = { content: 'Root', children: [{ content: `An answer${TAG}` }] };
    expect(blockToText(block, fileText, '')).toBe(`Root\n\t- An answer${TAG}`);
  });

  it('works the same on a DB graph', () => {
    const block = {
      title: "Greetings. What is today's date?",
      children: [{ title: `Today's date is September 15, 2026.${TAG}` }],
    };
    expect(blockToText(block, dbText, TAG)).toBe("Greetings. What is today's date?");
  });
});
