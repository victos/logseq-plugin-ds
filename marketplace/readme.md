# Marketplace submission

To list the plugin on the Logseq marketplace, open a PR against
[`logseq/marketplace`](https://github.com/logseq/marketplace) adding
`packages/logseq-plugin-deepseek-assistant/` with `manifest.json` from this
directory and a copy of `logo.svg` from the repo root.

Before submitting, the marketplace requires:

- a tagged GitHub release whose assets include the built zip — `release.config.js`
  already attaches `logseq-plugin-deepseek-assistant-<version>.zip`, over and above
  GitHub's automatic "Source code (zip)";
- a readme that explains the plugin and shows **at least one screenshot or GIF**.
  The readme has none yet, and it cannot be produced without a running Logseq.

`effect: true` matches what comparable plugins set; it governs whether the plugin
sandbox shares the host origin, which is what lets it call the DeepSeek API.

`supportsDB` is deliberately **false**. The DB code path exists and is unit
tested, but it has never run against a real DB graph — set this to `true` only
after verifying the commands there by hand.
