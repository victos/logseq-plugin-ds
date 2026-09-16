# [1.1.0](https://github.com/victos/logseq-plugin-ds/compare/v1.0.0...v1.1.0) (2026-09-16)


### Bug Fixes

* 14 rewrite defects found by fuzzing the note-writing pipeline ([576387b](https://github.com/victos/logseq-plugin-ds/commit/576387b32d0bc87e454ae3783567a91fd1c9a346))
* five more ways a rewrite could damage a block ([6da3963](https://github.com/victos/logseq-plugin-ds/commit/6da39635ffff7c8e9dc8e433007b911119f5419d))
* make the forced answer actually work on deepseek-reasoner ([4cc3630](https://github.com/victos/logseq-plugin-ds/commit/4cc3630d788d06ba57e9aa38810b678bb72da075))
* three bugs that reached v1.0.0, two of them note-corrupting ([40e44ad](https://github.com/victos/logseq-plugin-ds/commit/40e44ad920e76faf184bc9d334d12e399e1e5db8))


### Features

* add /Verify Online, gated on a search API key ([b97feb9](https://github.com/victos/logseq-plugin-ds/commit/b97feb9fd637decf95d8f9b76a052ef47a6cb872))

# 1.0.0 (2026-09-15)


### Bug Fixes

* default temperature to 0.3 ([277660c](https://github.com/victos/logseq-plugin-ds/commit/277660ca15abcdcedceff827b8ef7631a6b5a0b8))
* define a property before setting it on a DB graph ([49abaf2](https://github.com/victos/logseq-plugin-ds/commit/49abaf28ee3edaf40e33b15c5821723198f62bac))
* don't feed the plugin's own output back into the next command ([f0af211](https://github.com/victos/logseq-plugin-ds/commit/f0af211f5518e8bbe279206f14d2ba7456f273bb))
* Fact Check listed correct statements as findings ([8e4952a](https://github.com/victos/logseq-plugin-ds/commit/8e4952a487656dc0973cabd9aa7f6450f38eda14))
* tag matching, and purge the extracted Logseq bundles ([e85c016](https://github.com/victos/logseq-plugin-ds/commit/e85c016458759d6984557d498e6e19ceb9e89d03))
* tell transform commands the text is material, not a request ([410f368](https://github.com/victos/logseq-plugin-ds/commit/410f368df8800979120e75d878e8e8223eff4f4f))


### Features

* declare supportsDB after verifying it in a real DB graph ([05b02bb](https://github.com/victos/logseq-plugin-ds/commit/05b02bb427c60dc002b0233b524fe2c6dcb8cdb7))
* Logseq DeepSeek Assistant ([12d50cd](https://github.com/victos/logseq-plugin-ds/commit/12d50cd9a6add50795b1dcf42025016fdd1bb8b4))
* replace the logo with a robot ([b793d32](https://github.com/victos/logseq-plugin-ds/commit/b793d32d9fe7d90824e2b34f00299eb30a4909b5))
* rewrite the whole subtree, and hold the reply's language ([d6e597e](https://github.com/victos/logseq-plugin-ds/commit/d6e597e0813fa763366c4d7068c26b69bc2c0718))
* support Logseq DB graphs ([2aaddc2](https://github.com/victos/logseq-plugin-ds/commit/2aaddc26396171c3765572792eed506391d4eb0f))
