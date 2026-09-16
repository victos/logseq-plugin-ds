# How it works

[← readme](../readme.md)

## File graphs and DB graphs

Logseq stores a block differently depending on the backend, and the plugin adapts to whichever
graph is open — checked per command, so switching graphs needs no reload.

| | File graph | DB graph |
| --- | --- | --- |
| Block text | `content`, mixed with `key:: value` lines | `title` |
| Properties | text lines inside the block | separate entities |
| What `/Summarize` writes | a `summarize:: …` line | a `summarize` property via the API |

On a file graph the property lines are split off before the text is sent, and restored
untouched afterwards — after the first line, or in front of the block when it opens with a
code fence, a table, a quote or a list, which is where Logseq itself keeps them for such blocks
(after a fence line they would sit inside the code, and an `id::` there no longer holds the
block's references). On a DB graph the text can be replaced without touching properties at
all, so nothing has to be reassembled.

**The DB path has been exercised in a real DB graph, in Logseq, by hand.** `/Ask AI`,
`/Tone:`, `/Summarize` and `/Shorten` were each run on a block with children; the property was
created and set, the subtree was rewritten, and a `((reference))` to one of the rewritten
children still resolved afterwards. `marketplace/manifest.json` declares `supportsDB: true` on
that basis. What has been added since has not run inside Logseq on either backend, only
against an in-memory graph in the tests: a point a rewrite adds under a parent that already has
one is inserted as the sibling after that point (`insertBlock(…, { sibling: true })`) rather
than as the parent's last child; a fence a block leaves open is closed in the outline the model
sees; a reply wrapped in a code fence is unwrapped; a Markdown list inside a block survives a
tab-indented reply; and a `key:: value` or `id::` line the model writes is handled as described
under *Rewriting a block that has children*.

Three details were confirmed separately through Logseq's CLI rather than inferred from type
definitions:

- A `#[[🤖]]` tag written into a block's text stays in the text: the DB records a reference to
  the `🤖` page but does not move the tag into a separate tag field, and reads the title back
  with the tag spelled out. So the tag behaviour described above — including skipping tagged
  children — holds on both backends.
- A title that ends with a code fence and then the tag on its own line is stored exactly so;
  nothing folds the tag back onto the fence line.
- A DB graph refuses to put a property on a block until that property exists
  (`Property :summarize doesn't exist yet`), and then stores it under a namespaced ident of
  its own, not under the name given. `/Summarize` therefore defines the property before
  writing it, and if the write is still refused you get a message saying so and suggesting
  `output: insert` instead.

The SDK is bundled with the plugin; what matters is the Logseq build. The DB path needs a build
that exposes `checkCurrentIsDbGraph` and `upsertBlockProperty`. On older builds, where
`checkCurrentIsDbGraph` does not exist, the plugin takes the file-graph path — which is correct,
since those builds only have file graphs. On newer builds that hand back a file-graph block with
the markdown in `title` and no `content`, the file-graph path reads `title` instead.

**The file-graph path is the one that has never run inside Logseq.** It is covered by unit
tests and it is what upstream's code did, but the machine this was developed on has only DB
graphs, so nothing exercised it end to end — including whether the bundled `@logseq/libs` 0.3.x
client boots at all inside an older, file-graph-only Logseq build. If you use a file graph,
treat the first few runs as a trial and keep an eye on your block properties.

## Rewriting a block that has children

`/Polish`, `/Shorten`, `/Expand` and the `/Tone:` commands rewrite the block **and everything
under it**. The model gets the subtree as an outline and returns a rewritten one; the plugin
applies it back over the blocks that already exist, updating each in place so its identity —
and therefore any `((reference))` to it, and its properties — survives. The rewrite may merge
or split lines: extra lines become new blocks, and blocks left over are removed.

Two things are never removed. A block something links to: on a file graph that is a block
carrying `id::`, which Logseq writes only once a reference exists; on a DB graph the plugin
does not query what links to a block, so **nothing is removed there at all**. And a note of
yours the model was never shown: a surplus block is kept when the plugin's own tagged output
under it holds a block you wrote (a follow-up under an `/Ask AI` answer, say), or when a
referenced block sits inside that output or under an empty block. The tagged output on its own
goes with the point it answered. Either way the surplus block stays put and a notification
tells you how many were kept, for you to delete by hand.

A block with several lines — two paragraphs, a fenced code block, a Markdown list — stays one
block: a line without a bullet is read as the continuation of the point above it, and so is a
list line (`- a`, `1. b`) that sits where a continuation line would — indented with the point's
tabs plus two spaces, or unindented under the block itself. That relies on the reply keeping
the tab indentation the model was given. A reply indented with spaces alone cannot tell a list
line from a sub-point, and neither can a block with no children, where there is no tab anywhere
to measure against; in those two cases a list inside the block comes back as child blocks. A
code fence a block leaves open is closed in the outline the model sees, so it cannot swallow
the points after it; a reply the model wrapped whole in a ```` ```markdown ```` fence is
unwrapped rather than written back as one code block (a code block being rewritten keeps a
fence of its own kind, since there the fence is the content — but a ```` ```markdown ```` one
is still the model's wrapper); and a `key:: value` line the model
writes becomes a property of the block, set once, never replacing one the block already has.
Children the model was never shown are left out when the rewrite is lined up against the existing blocks:
the plugin's own tagged output, and blocks with no text of their own. So `/Polish` after
`/Ask AI` on the same block leaves the answer where it is instead of writing over it, and a
point the rewrite adds goes in right after the last point the model saw, not after that answer.

The block you run a rewrite command in has to have text of its own. In an empty block the first
child would be taken for the block itself and every line after it would land one block up, so
the plugin refuses instead (`This block has no text of its own to rewrite…`); run it on one of
the children.

Because one command can now touch several blocks, undo may take more than one Ctrl+Z.

`/Ask AI` answers from the model's own knowledge, which has a cutoff — asked which DeepSeek
model is current it named one two versions old, and asked for today's weather it can only
suggest a weather app. **`/Ask Online`** looks the answer up instead and lists the URLs it
relied on, says which date, time zone or place its answer applies to, and gives the range when
the sources disagree rather than picking one. It needs the same search key as `/Verify Online`
and takes roughly 5-20 seconds against about one for `/Ask AI`, so both are kept: ask offline
for anything timeless, online for anything that moves.

## Checking against sources: `/Verify Online`

`/Fact Check` judges from the model's own knowledge, which has a cutoff. `/Verify Online`
searches instead, and every verdict it writes carries the URL it rests on:

```
- DeepSeek's strongest model is deepseek-v2, with a 32K context.    ← /Verify Online
    ↓
  - ❌ DeepSeek's strongest model is deepseek-v2 → V3, R1 and later
      are newer and stronger — https://api-docs.deepseek.com/updates
  - ✅ <a claim that held up> — <source url>
  - ❓ <a claim no source settled>
```

`/Verify Online` only checks what the text actually asserts. A block that is a question, a
heading, a note to yourself, a piece of code or an opinion has nothing to verify, and it says so in
one line rather than inventing claims to check. Measured with the live suite (below): that line is
in the block's language every time for English and German but only about half the time for
Chinese, an opinion still gets a `❓` line instead in roughly one run in four, and a one-line
personal note ("a helper I wrote yesterday") is sometimes treated as an unverifiable claim. A claim the sources agree with gets a ✅, not a ❌ with the source
restated as though it were a correction.

It is **off unless you set a Web Search API Key** in the settings — get one from
[tavily.com](https://tavily.com), whose free tier is 1,000 searches a month. Without a key the
command is not registered at all and nothing else changes; after setting one, reload the plugin.

It costs what you would expect: with `deepseek-chat` the model searches two to four times before
answering, so a run takes 7-12 seconds against roughly one for `/Fact Check`; `deepseek-reasoner`
ran eight searches over four rounds and took 45 seconds on one live run. Use `/Fact Check` for everyday
sanity-checking and this when the answer has to be attributable — versions, dates, numbers,
anything recent.

It searches at most four rounds, then has to answer with what it has. A search that fails in
passing — a timeout, a network hiccup — is reported to the model, which writes a `❓` line for
that claim; a rejected key or a used-up quota stops the command with an error instead, so you
learn what to fix. What reaches Tavily is the model's own search queries, short phrases drawn
from your block — not the block itself. `deepseek-reasoner` works too; it has to be told in so
many words when to stop searching, and the plugin does that.

The search half has been run against the live services, not only against stubs: a real Tavily
search, a rejected key (401) and a rejected parameter (400) came back in the shapes the client
expects, and the loop ran end to end on both models — `deepseek-reasoner` through to the forced
last pass, with its reasoning handed back between rounds as the API requires.

Why Tavily rather than a plain search API: a plugin runs in a browser sandbox and cannot fetch
arbitrary pages, because almost none of them send CORS headers. Tavily returns cleaned page text
as part of the search, so no separate fetching step is needed.
