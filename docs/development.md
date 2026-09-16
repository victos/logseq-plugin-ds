# Development

[← readme](../readme.md)

## Building and testing

```sh
pnpm test       # 348 tests (vitest), one of them a property-based harness over the block-writing pipeline
pnpm lint       # eslint over src/, test/ and live/
pnpm build      # tsc + vite → dist/
pnpm test:live  # the prompts against the live API — costs money, needs keys; see below
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
| `live/` | The behavioural suite for the prompts (below). Not part of `pnpm test` |

`@logseq/libs` is the only runtime dependency; every API call is a plain `fetch`. Bundle is
about 50 kB gzipped.

## Changing a prompt: run the live suite

The unit tests can say that a prompt *contains* a sentence; they cannot say what the model does
with it. Every prompt fix before this suite existed was checked by a handful of hand-run calls,
and the record shows what that misses: one command's language fix shipped having silently turned
four other commands Chinese, a rule against invented claims did not stop them, and a line meant
for one command leaked a `❓` into another's prose. `live/` is the regression net for that layer.

```sh
pnpm test:live                                   # the quick grid
LIVE_SCOPE=full pnpm test:live                   # every command × kind × language
LIVE_COMMANDS=Polish,Shorten LIVE_SAMPLES=5 pnpm test:live
LIVE_BASELINE=write pnpm test:live               # record the current behaviour as the baseline
```

It runs the real prompts — assembled by the same `buildMessages` the plugin uses, parsed by the
same parsers — against the live DeepSeek API, and Tavily for the searching commands, over a grid
of **command × input kind × input language**. The kinds are a question, a statement whose claims
are all true, a statement with one true and one false claim, an opinion, a multi-line block with
sub-points, a block with a code fence, and a near-empty "ok, noted."; the languages are English,
Chinese and German. Each cell is run several times, and what is asserted are **properties** of
the reply, never its exact text: the reply is in the input's language; a rewrite of a question does
not answer it, starts with the text rather than "Here is…", and keeps an outline an outline;
`/Summarize` is one line; `/Fact Check` flags the false claim, never the true one, in the
`❌ … → ✅ …` shape, and says "nothing found" in one line otherwise; `/Verify Online` says there is
nothing to verify for a question or an opinion, confirms true claims with a ✅ and a URL, and every
URL it cites was really in the search results; `/Ask Online` answers, cites, and carries no
`❓✅❌`. The grid and the checks are in `live/matrix.ts` and `live/checks.ts`; a custom prompt
enabled in your settings is run too, with the generic checks only.

The counts go to `live/last-run.json` (git-ignored) and are compared with `live/baseline.json`:
the report lists every cell as `property k/n`, then **what moved against the baseline**, down and
up, with the reply that failed. A cell fails when a property passes fewer than 60% of its samples
(`LIVE_MIN_PASS`), so a single stochastic slip is reported as a count, not as a red build — read
the counts, not only the verdict. After a deliberate prompt change that the run shows to be better,
re-record with `LIVE_BASELINE=write` and commit `live/baseline.json` with the prompt.

Keys come from `DEEPSEEK_API_KEY` / `TAVILY_API_KEY` in the environment, or failing that from the
plugin's own settings file (`~/.logseq/settings/logseq-plugin-deepseek-assistant.json`;
`LIVE_SETTINGS` points elsewhere). Never write a key into the repository. Without a Tavily key the
searching commands are simply not in the grid, as in the plugin.

What it costs, measured with `deepseek-chat`:

| Run | Cells | Calls | Time | Notes |
| --- | --- | --- | --- | --- |
| `quick` (default) | 8 commands × 3 kinds × 3 languages, 2 samples; searching commands on 2 kinds | 66 cells: about 155 chat calls and 45 searches | about 2 min | A few cents on DeepSeek; 5% of Tavily's free monthly 1,000 |
| `full` | 14 commands × 7 kinds × 3 languages, 3 samples (`LIVE_FORCED=1` adds 6 cells) | 300 cells: about 980 chat calls and 350 searches | about 6 min | Well under a dollar on DeepSeek; a third of Tavily's free month |

Tavily's dev keys also carry a plan usage limit: the run that recorded the current baseline hit it
(`Tavily plan limit reached (432)`) after 182 searches, so the claim cells of `/Verify Online` in
that run errored, are marked as such in the report, and were not written into the baseline. Budget
the searching commands accordingly, or leave them out with `LIVE_SEARCH=0`.

Narrow it with `LIVE_COMMANDS`, `LIVE_KINDS`, `LIVE_LANGS` (comma-separated, substring match) and
`LIVE_SAMPLES`; `LIVE_SEARCH=0` leaves the searching commands out, `LIVE_FORCED=1` adds cells that
force the answer after one search round (the `ANSWER_NOW` path), `LIVE_MODEL=deepseek-reasoner`
runs another model (slow: the searching commands take 30–60 s each), `LIVE_CONCURRENCY` and
`LIVE_SEARCH_CONCURRENCY` (default 6 and 3) bound what is in flight — Tavily's dev keys refuse more
than about eight concurrent searches.

## What changed from the original

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
