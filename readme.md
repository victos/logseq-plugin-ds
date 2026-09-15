# Logseq DeepSeek Assistant

Call DeepSeek from a slash command, right inside a Logseq block. **English** | [中文](./readme.zh-CN.md)

Type `/Summarize` in a block and DeepSeek summarizes it. Type `/Shorten` and it rewrites the
block in place. No window switching, no copy-paste — the answer lands in your notes.

```
- Q3 revenue grew 12% but churn also rose.        ← type /Summarize here
    ↓
- Q3 revenue grew 12% but churn also rose. #[[🤖]]
  summarize:: Growth offset by churn.            ← added as a property
```

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

Twelve commands come built in. Type `/` in a block and start typing the name.

| Command | What it does | Where the answer goes |
| --- | --- | --- |
| `/Ask AI` | Answers the question in the block | New child block |
| `/Summarize` | Condenses the block | A `summarize::` property on the block |
| `/Polish` | Fixes awkward phrasing, redundancy and grammar without changing your voice | Replaces the block text |
| `/Shorten` | Cuts it down, keeping the key points | Replaces the block text |
| `/Expand` | Fills it out with more detail | Replaces the block text |
| `/Explain` | Explains the text or code | New child block |
| `/Fact Check` | Flags statements it believes are objectively false | One child block per error |
| `/Brainstorm` | Suggests related ideas | One child block per idea |
| `/Tone: Friendly` `/Tone: Confident` `/Tone: Casual` `/Tone: Professional` | Rewrites in that tone | Replaces the block text |

Type `/tone` to see the four tone commands together.

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
built into the twelve preset prompts only; custom prompts say whatever you tell them to.)

Everything the AI writes is tagged `#[[🤖]]` so you can find it later: replaced or appended
text, every child block it inserts, and a block that gained a property. You can change or
remove the tag in the settings.

### Giving it context

A command reads the block you are in **plus everything nested under it**. So this:

```
- What should we prioritize next quarter?     ← type /Ask AI here
  - Churn rose from 3% to 5%
  - Two enterprise deals slipped to Q4
  - Engineering is at capacity
```

sends all four lines to the model, not just the question.

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
untouched afterwards. On a DB graph the text can be replaced without touching properties at
all, so nothing has to be reassembled.

**The DB path is unit tested but has never run against a real DB graph.** It is written against
the `@logseq/libs` 0.3.4 type definitions and exercised only against a fake editor. Three things
in particular are unverified: whether `upsertBlockProperty` creates a property that does not
exist yet, what a DB graph does with the `#[[🤖]]` tag appended to the text (it may turn it into
a tag entity and drop it from the text), and how `updateBlock` behaves on a block that is being
edited. Treat it as untested in practice until you have tried it, which is why
`marketplace/manifest.json` still declares `supportsDB: false`.

The SDK is bundled with the plugin; what matters is the Logseq build. The DB path needs a build
that exposes `checkCurrentIsDbGraph` and `upsertBlockProperty`. On older builds, where
`checkCurrentIsDbGraph` does not exist, the plugin takes the file-graph path — which is correct,
since those builds only have file graphs. On newer builds that hand back a file-graph block with
the markdown in `title` and no `content`, the file-graph path reads `title` instead.

Two things were checked against a real DB graph (Logseq desktop nightly, via its CLI) rather
than inferred from type definitions:

- A `#[[🤖]]` tag written into a block's text stays in the text — the DB does not extract it
  into a separate tag field, so the tag behaviour described above holds on both backends.
- A DB graph refuses to put a property on a block until that property exists
  (`Property :summarize doesn't exist yet`), and then stores it under a namespaced ident of
  its own, not under the name given. `/Summarize` therefore defines the property before
  writing it, and if the write is still refused you get a message saying so and suggesting
  `output: insert` instead.

Still unverified, because they need the plugin running inside Logseq rather than the CLI:
whether `getBlock({includeChildren: true})` nests children the same way on a DB graph, whether
`insertBlock` appends as the last child (`/Brainstorm` depends on the order), and whether the
bundled `@logseq/libs` 0.3.x client boots correctly inside an older file-graph Logseq build.

## Settings

| Setting | Default | What it is for |
| --- | --- | --- |
| **API Key** | *(empty)* | **Required.** Your DeepSeek key |
| **API Base URL** | `https://api.deepseek.com/v1` | Only change this if you go through a proxy or another OpenAI-compatible endpoint |
| **Model** | `deepseek-chat` | See below. A custom prompt can override it per command |
| **Temperature** | `1.0` | How creative the answers are, `0.0`–`2.0`. DeepSeek suggests `0.0` for code, `1.0` for rewriting, `1.3` for chat, `1.5` for creative writing. Ignored by `deepseek-reasoner` |
| **Tag** | `[[🤖]]` | Added to AI output. Write it without the `#`; leave empty to turn tagging off |
| **Custom Prompts** | off | Your own commands — see below |

Changes to the first five apply to the next command you run; no reload needed.

### Which model?

- **`deepseek-chat`** — fast and cheap. Right for almost everything: summarizing, rewriting,
  changing tone.
- **`deepseek-reasoner`** — thinks step by step before answering. Better for analysis and hard
  questions, but noticeably slower and more expensive. Its "thinking" is discarded; only the
  final answer reaches your block. The Temperature setting is not sent to it.

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

If an entry is malformed — no `name`, no `prompt`, or an `output` that isn't one of the four —
the plugin skips it and tells you which one when it loads.

## When something goes wrong

Every failure shows up as a Logseq notification. The common ones:

| Message | What to do |
| --- | --- |
| `No DeepSeek API key configured. Set it in the plugin settings.` | Paste your key into the settings |
| `Invalid DeepSeek API key (401): …` | Re-copy the key into settings |
| `DeepSeek account has insufficient balance (402): …` | Top up at platform.deepseek.com |
| `DeepSeek rate limit reached (429): …` | Wait a moment and retry |
| `Could not reach …` | Check your network and the API Base URL |
| `DeepSeek did not answer within 300 s.` | Retry. If it keeps happening on `deepseek-reasoner`, switch to `deepseek-chat` or use a smaller block |
| `DeepSeek stopped at its output limit — the answer may be cut off.` | The answer was written but may be truncated. Ask for something shorter |
| `The block is empty — nothing to send to DeepSeek.` | The block (and its children) had no text after removing properties |
| `The block was deleted while DeepSeek was answering.` | The answer was discarded. Run the command again on the new block |
| `This Logseq version cannot set block properties on a DB graph. Update Logseq, or change the prompt’s "output" away from "property".` | DB graphs only: this Logseq build has no `upsertBlockProperty`. Update Logseq, or give the prompt another `output` |
| `DeepSeek Assistant ignored N custom prompt(s): …` | One of your custom prompts is malformed; the message names it |
| `Custom prompts changed. Reload the plugin to register the new slash commands.` | You added, renamed or removed a custom prompt |

Still stuck? Open the Logseq developer console (`Ctrl+Shift+I`) — the full error is logged there.

## For developers

```sh
pnpm test    # 143 unit tests (vitest)
pnpm lint    # eslint over src/ and test/
pnpm build   # tsc + vite → dist/
```

Source layout:

| File | Responsibility |
| --- | --- |
| `src/main.ts` | Logseq glue: registers commands, reads and writes blocks. Not unit-tested |
| `src/graph.ts` | File-graph / DB-graph adapters; everything that touches a block goes through it |
| `src/block.ts` | Block content — property splitting, tags, editor/DB merge |
| `src/prompt.ts` | Prompt assembly and custom-prompt validation |
| `src/settings.ts` | The settings schema and its defaults |
| `src/deepseek.ts` | The API client |
| `src/parsers.ts` | Turning a reply into a list or named fields |
| `src/prompts/` | The built-in prompts, one per file; `index.ts` sets the order |

`@logseq/libs` is the only runtime dependency; the client is a single `fetch` call. Bundle is
about 43 kB gzipped.

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
