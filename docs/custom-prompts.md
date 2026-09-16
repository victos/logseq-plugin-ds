# Writing your own commands

[← readme](../readme.md)

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
| `search` | no | `true` makes the command search the web before answering, like `/Ask Online`. Needs the Web Search API Key; costs a few searches and 5-20 seconds per run |
| `format` | no | `[]` to get a list (one item per line, one child block each), or `{"key": "description"}` to get named fields |

A custom prompt can search too — add `"search": true` and it goes through the same loop as
`/Ask Online`, looking things up before it answers. It needs the Web Search API Key, and unlike
the built-in searching commands (which simply are not registered without one) a custom prompt
asking for search without a key is reported in the warning toast, so a command you wrote
yourself never disappears without explanation.

`search` works with every `output`, but `insert` is the one to use. A searched answer is a few
sentences followed by the URLs it relied on, and with no `format` all of that lands in one child
block. With `replace` the same answer goes through the outline rewrite: prose and bare URLs
become the block's own text, but a model that lists its sources as bullets (`- https://…`) turns
them into child blocks, and those overwrite the block's existing sub-points one for one.

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

## Starting from a built-in command

A custom prompt whose `name` matches a built-in one **replaces it**, keeping its place in the
slash menu. So the way to tweak `/Summarize` is to copy its prompt from
[the built-in prompt reference](./built-in-prompts.md), change what you want, and add it as a
custom prompt called `Summarize`.

Know what you are taking on. These prompts have been through several rounds of correction with
measurements behind them, and the wording is less forgiving than it looks — one sentence about
what language to answer in made five commands reply in Chinese to English blocks; a placeholder
one clause too long got copied into people's notes; merging two near-duplicate sentences in
`/Fact Check` brought back a fault that had been fixed. `docs/development.md` describes the live
suite used to catch that sort of thing.

**A command you have overridden stops receiving fixes.** Your copy is frozen at the day you took
it; later corrections to that command reach everyone except you, silently. Delete your version to
go back to the maintained one.
