# Logseq DeepSeek Assistant

Call DeepSeek from a slash command, right inside a Logseq block. **English** | [中文](./readme.zh-CN.md)

Type `/Polish` in a block and DeepSeek rewrites it — the block **and the points nested under
it**, each one updated in place. No window switching, no copy-paste; the answer lands in your
notes.

![Polishing a block and its sub-points with one command](./docs/demo.gif)

A DeepSeek port of [ahonn/logseq-plugin-ai-assistant](https://github.com/ahonn/logseq-plugin-ai-assistant) (MIT).

## Quick start

**1. Get an API key** — sign up at [platform.deepseek.com](https://platform.deepseek.com/api_keys)
and create a key. DeepSeek is prepaid, so add a small balance too.

**2. Install the plugin**

Turn on developer mode in Logseq (`Settings → Advanced → Developer mode`), then either
download a release package, or build it yourself:

```sh
pnpm install && pnpm build
```

Then `Plugins → Load unpacked plugin` and pick this folder.

**3. Paste your key** into the plugin settings. That is the only required setting.

**4. Try it** — put the cursor in any block and type `/Summarize`.

## The commands

Twelve commands come built in, plus one that needs a search key. Type `/` in a block and start typing the name.

![The plugin's commands in the slash menu](./docs/menu.png)

| Command | What it does | Where the answer goes |
| --- | --- | --- |
| `/Ask AI` | Answers the question in the block | New child block |
| `/Summarize` | Condenses the block | A `summarize::` property on the block |
| `/Polish` | Fixes awkward phrasing, redundancy and grammar without changing your voice | Replaces the block text |
| `/Shorten` | Cuts it down, keeping the key points | Replaces the block text |
| `/Expand` | Fills it out with more detail | Replaces the block text |
| `/Explain` | Explains the text or code | New child block |
| `/Fact Check` | Flags statements it believes are objectively false | One child block per error |
| `/Verify Online` | Searches the web and cites a source for each verdict — **only when a search key is set** | One child block per claim |
| `/Brainstorm` | Suggests related ideas | One child block per idea |
| `/Tone: Friendly` `/Tone: Confident` `/Tone: Casual` `/Tone: Professional` | Rewrites in that tone | Replaces the block text |

Type `/tone` to see the four tone commands together.

![Fact Check listing what it believes is false, leaving the block itself alone](./docs/fact_check.png)

**`/Fact Check` never rewrites your text.** It judges correctness from the model's own
knowledge — which can be wrong, and confidently so — so instead of "correcting" the block it
lists each claim it believes is false as a child block, in the form
`❌ the claim → ✅ the correction (reason)`, and leaves your block exactly as it was. If it finds
nothing, it adds one child block saying so. You decide what to change. Treat its output as a
second opinion, not an authority, and verify anything that matters.

**`/Polish` and `/Tone: …` are different jobs.** Polish keeps your register and cleans up the
writing; the Tone commands change the register. Both are explicitly told not to add, remove or
invent information. `/Shorten` and `/Expand` are not — changing the amount of detail is the
point of those two.

Answers come back in the language you wrote in — ask in Chinese, get Chinese. (This rule is
built into the preset prompts only; custom prompts say whatever you tell them to.)

Everything the AI writes is tagged `#[[🤖]]` so you can find it later: replaced or appended
text, every child block it inserts, and a block that gained a property. The tag goes at the end
of the text — or on a line of its own after a closing code fence (`` ``` #[[🤖]] `` would stop the
fence closing) or after a `key:: value` line (the tag would become part of the value). You can change or remove the tag in the settings.

### Giving it context

A command reads the block you are in **plus everything nested under it**. So this:

```
- What should we prioritize next quarter?     ← type /Ask AI here
  - Churn rose from 3% to 5%
  - Two enterprise deals slipped to Q4
  - Engineering is at capacity
```

sends all four lines to the model, not just the question.

One exception: child blocks carrying the `#[[🤖]]` tag are skipped, along with anything nested
under them, because the tag is how the plugin recognises its own earlier output. Without this,
running `/Ask AI` and then `/Tone: Professional` on the same block would feed the answer back
in, and the tone command would rewrite the answer instead of the question. The rule is only as
good as the tag:

- The tag is matched as a whole token (`#AI` does not match `#AIDS`), but any child block that
  contains it is skipped — including one you wrote yourself that quotes the tag, and a nested
  block the plugin merely rewrote or gave a property to earlier. Delete the tag from a block to
  have it read again.
- Only the current Tag setting is recognised. Output written under an earlier tag, or while the
  Tag setting was empty, is read like any other block — and with the setting cleared the
  protection is off altogether.
- The block you run the command in is always read, tag or no tag.

Logseq metadata (`id::`, `collapsed::`, and your own `key:: value` lines) is stripped before
sending — the model sees your writing, not the plumbing — and is put back afterwards. If you
run a command while still typing in the block, the plugin uses what is in the editor, not the
last saved version.

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

### Rewriting a block that has children

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

### Checking against sources: `/Verify Online`

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
heading or a note to yourself has nothing to verify, and it says so in one line rather than
inventing claims to check. A claim the sources agree with gets a ✅, not a ❌ with the source
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

## Settings

| Setting | Default | What it is for |
| --- | --- | --- |
| **API Key** | *(empty)* | **Required.** Your DeepSeek key |
| **API Base URL** | `https://api.deepseek.com/v1` | Only change this if you go through a proxy or another OpenAI-compatible endpoint |
| **Model** | `deepseek-chat` | See below. A custom prompt can override it per command |
| **Temperature** | `0.3` | How closely the answer sticks to your text. Low is right for rewriting; raise it towards `1.3` for Brainstorm or Ask AI |
| **Tag** | `[[🤖]]` | Added to AI output. Write it without the `#`; leave empty to turn tagging off |
| **Web Search API Key** | *(empty)* | Optional. A [Tavily](https://tavily.com) key; enables `/Verify Online` |
| **Custom Prompts** | off | Your own commands — see below |

Changes to the first five apply to the next command you run; no reload needed. A field you
have cleared — even to a few spaces — counts as unset and falls back to its default. The Web
Search API Key is different: it decides whether `/Verify Online` is registered at all, so
setting or clearing it needs a reload — the plugin reminds you once, when the set of commands
changes.

Until an API key is set, the plugin says so once when it loads, so a fresh install is not left
guessing why a command fails.

Logseq saves the Temperature field as text once you have edited it (`"0.3"`, not `0.3`); the
plugin reads it either way. Earlier builds did not, and silently ran every command at
DeepSeek's own default of `1.0` as soon as the field had been touched.

A changed default does not reach an existing install: Logseq keeps the values already stored, so
if you set the plugin up before the default moved to `0.3`, your Temperature is still `1.0`
until you change it.

### Which model?

- **`deepseek-chat`** — fast and cheap. Right for almost everything: summarizing, rewriting,
  changing tone.
- **`deepseek-reasoner`** — thinks step by step before answering. Better for analysis and hard
  questions, but noticeably slower and more expensive. Its thinking never reaches your block;
  during a `/Verify Online` run it is handed back to the model between searches, as the API
  requires, and dropped once the answer is in. The Temperature setting is not sent to it.

DeepSeek's API currently names its models `deepseek-flash` and `deepseek-v4-pro` in its own
messages; `deepseek-chat` and `deepseek-reasoner` are still accepted and map onto them. Either
spelling works in the Model setting. A name DeepSeek does not know fails with
`DeepSeek does not know the model "…"`, which quotes the names it does.

## Writing your own commands

Open the plugin settings, find `customPrompts`, and set it up like this:

```json
{
  "customPrompts": {
    "enable": true,
    "prompts": [
      {
        "name": "Markdown Table",
        "prompt": "Turn the following into a Markdown table:\n{{text}}",
        "output": "replace"
      }
    ]
  }
}
```

That gives you a `/Markdown Table` command. **Reload the plugin after adding or renaming a
prompt** — the plugin registers slash commands only when it starts, and it will remind you.
Editing an existing prompt's text, `output`, `model` or `format` takes effect on the next run
without a reload. A prompt you delete keeps working under its old definition until you reload.

Each entry takes:

| Field | Required | Meaning |
| --- | --- | --- |
| `name` | yes | The slash command name |
| `prompt` | yes | What to tell the model. `{{text}}` is where your block goes. Leave it out and the block is appended at the end, wrapped in `"""` |
| `output` | yes | Where the answer goes — see the table below |
| `system` | no | Sets the model's role, e.g. `"You are a careful technical editor."` |
| `model` | no | Use a different model just for this command |
| `format` | no | `[]` to get a list (one item per line, one child block each), or `{"key": "description"}` to get named fields |

The four `output` modes, using the block `Q3 revenue grew 12% but churn also rose.`:

| `output` | Result |
| --- | --- |
| `replace` | `Revenue up 12%; churn up too. #[[🤖]]` |
| `append` | `Q3 revenue grew 12% but churn also rose. Worth investigating. #[[🤖]]` |
| `property` | Block keeps its text and is tagged; gains `markdown-table:: …` (the key is the command name, lower-cased and hyphenated; on a DB graph it is a `markdown-table` property). With `format`, the items are joined with `, ` |
| `insert` | Block keeps its text; the answer becomes a child block. With `format`, one child block per item |

Two things worth knowing:

- Your `prompt` and `system` text is sent exactly as written. JSON examples, code snippets and
  Logseq macros like `{{query ...}}` are all safe.
- If you name a custom prompt the same as a built-in one, yours wins.

If an entry is malformed — no `name`, no `prompt`, an `output` that isn't one of the four, or a
`format` that is neither `[]` nor an object — the plugin skips it and tells you which one when
it loads. The same notice appears if the setting as a whole has the wrong shape: a list where
the `{"enable": …, "prompts": […]}` object should be, or `enable` on with `prompts` missing or
not a list. Nothing about custom prompts fails silently.

## When something goes wrong

Every failure shows up as a Logseq notification. The common ones:

| Message | What to do |
| --- | --- |
| `DeepSeek Assistant: no API key set yet. …` | Shown once when the plugin loads without a key. Paste your key into the settings |
| `No DeepSeek API key configured. Set it in the plugin settings.` | Paste your key into the settings |
| `The API Base URL must start with https:// — it is "…".` | The API Base URL setting has no scheme. The default is `https://api.deepseek.com/v1` |
| `Nothing answers at … (404). Check the API Base URL setting …` | The URL points at nothing — a typo in the path, most likely. Reset the API Base URL to its default |
| `DeepSeek request failed (…): … answered with a web page, not an API reply.` | The URL reaches a website, not the API — `platform.deepseek.com` instead of `api.deepseek.com`, say. Reset the API Base URL |
| `DeepSeek does not know the model "…" (400): …` | The Model setting (or a custom prompt's `model`) names a model DeepSeek does not have; the message lists the ones it does |
| `Invalid DeepSeek API key (401): …` | Re-copy the key into settings |
| `DeepSeek account has insufficient balance (402): …` | Top up at platform.deepseek.com |
| `DeepSeek rate limit reached (429): …` | Wait a moment and retry |
| `Could not reach …` | Check your network and the API Base URL |
| `DeepSeek did not answer within 300 s.` | Retry. If it keeps happening on `deepseek-reasoner`, switch to `deepseek-chat` or use a smaller block |
| `DeepSeek stopped at its output limit — the answer may be cut off.` | The answer was written but may be truncated. Ask for something shorter |
| `The block is empty — nothing to send to DeepSeek.` | The block (and its children) had no text after removing properties |
| `The block was deleted while DeepSeek was answering.` | The answer was discarded. Run the command again on the new block |
| `This block has no text of its own to rewrite. Run the command on a block with text, or on one of the children.` | `/Polish`, `/Shorten`, `/Expand`, `/Tone:` and custom `replace` prompts only: the block is empty (or holds only the tag) and has children. Rewriting from here would shift every child up by one, so nothing was sent |
| `DeepSeek returned nothing to insert.` | The reply had no usable line — with `/Fact Check`, every line it wrote was about a statement it found nothing wrong with, and those are dropped. Run it again, or on a smaller block |
| `This Logseq version cannot set block properties on a DB graph. Update Logseq, or change the prompt’s "output" away from "property".` | DB graphs only: this Logseq build has no `upsertBlockProperty`. Update Logseq, or give the prompt another `output` |
| `Could not write the "…" property on this DB graph: …` | DB graphs only: the property could not be defined or written; the message says why. Create the property in Logseq first, or give the prompt `output: insert` |
| `DeepSeek kept searching without answering (4 rounds). Try a shorter block.` | `/Verify Online` only: the model wanted a fifth round of searching. Put fewer claims in the block |
| `No Tavily API key configured. Set it in the plugin settings.` | `/Verify Online` was registered while a search key was set, and the key has since been cleared. Set it again, or reload the plugin to drop the command |
| `Invalid Tavily API key (401): …` | Re-copy the Tavily key into settings |
| `Tavily rate limit or monthly quota reached (429): …` | The month's searches are used up. Wait for the reset or upgrade the plan |
| `Tavily plan limit reached (432): …` | Your Tavily plan does not allow the request; check the Tavily dashboard |
| `DeepSeek Assistant ignored N custom prompt(s): …` | One of your custom prompts is malformed, or the `customPrompts` setting as a whole has the wrong shape; the message says which |
| `Available commands changed. Reload the plugin to update the slash menu.` | You added, renamed or removed a custom prompt, or set or cleared the Web Search API Key. Said once per such change |

Still stuck? Open the Logseq developer console (`Ctrl+Shift+I`) — the full error is logged there.

## For developers

```sh
pnpm test    # 332 tests (vitest), one of them a property-based harness over the block-writing pipeline
pnpm lint    # eslint over src/ and test/
pnpm build   # tsc + vite → dist/
```

Source layout:

| File | Responsibility |
| --- | --- |
| `src/main.ts` | The only file that touches the `logseq` global: a few lines wiring Logseq into `plugin.ts`. Not unit-tested |
| `src/plugin.ts` | Reads the settings, registers and dispatches the slash commands, runs one, turns failures into notifications. Tested against a fake host — a fresh install, a hand-edited settings file, a key cleared mid-session |
| `src/graph.ts` | File-graph / DB-graph adapters; everything that touches a block goes through it |
| `src/block.ts` | Block content — property splitting, tags, editor/DB merge |
| `src/outline.ts` | Subtree rewrites: parsing the model's outline back into a tree and planning which blocks to update, insert, remove or keep |
| `src/prompt.ts` | Prompt assembly and custom-prompt validation |
| `src/settings.ts` | The settings schema and its defaults |
| `src/search.ts` | The web search client (Tavily) |
| `src/verify.ts` | The search loop: offer the tool, serve the calls, then answer |
| `src/deepseek.ts` | The API client |
| `src/parsers.ts` | Turning a reply into a list or named fields |
| `src/prompts/` | The built-in prompts, one per file; `index.ts` sets the order |

`@logseq/libs` is the only runtime dependency; every API call is a plain `fetch`. Bundle is
about 48 kB gzipped.

### What changed from the original

Besides swapping OpenAI for DeepSeek, this port fixes several bugs inherited from upstream:

- **Block properties were being corrupted.** The tag was appended to the raw block content, so
  a block carrying `collapsed:: true` or `id:: …` ended up with `collapsed:: true #[[🤖]]`. The
  `replace` mode threw away the block's properties altogether — yours included. Properties are
  now split off, kept, and written back on their own lines.
- **Nested blocks crashed the reader.** The old walker iterated `child.children` unconditionally,
  so a child without a `children` array threw.
- **`property` output produced bad keys.** A prompt named `Ask AI` wrote `ask ai:: …`. Keys are
  now sanitized to `ask-ai::`.
- **Errors were silent.** A failed request left the command doing nothing at all; now you get
  a notification.
- **Slash commands multiplied.** Every settings change re-registered all of them (once per
  prompt, in fact).
- **Custom prompts with literal braces failed** before the request was even sent, because
  LangChain treated the prompt as a template.
- **`format` was never explained to the model.** The parser was created, but its format
  instructions were never added to the prompt, so a list or JSON reply was down to luck.

Also added: request timeouts, custom-prompt validation, a temperature setting, and a test
suite. LangChain, the OpenAI SDK, axios, React and Tailwind were all removed.

## Licence

MIT, same as upstream.
