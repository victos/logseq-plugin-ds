# 开发者信息

[← readme](../readme.zh-CN.md)

## 构建与测试

```sh
pnpm test       # 349 个测试（vitest），其中一个是覆盖块写入流程的属性测试
pnpm lint       # 对 src/、test/ 和 live/ 跑 eslint
pnpm build      # tsc + vite，产物在 dist/
pnpm test:live  # 拿真实 API 跑 prompt —— 要花钱、要 key，见下文
```

代码结构：

| 文件 | 职责 |
| --- | --- |
| `src/main.ts` | 唯一碰 `logseq` 全局对象的文件：几行代码把 Logseq 接到 `plugin.ts` 上。没有单元测试 |
| `src/plugin.ts` | 读设置、注册并分发斜杠命令、执行一条命令、把失败变成通知。用假的宿主测试 —— 刚装上什么都没配、手改过的设置文件、用到一半被清空的 key |
| `src/graph.ts` | 文件图 / DB 图适配层，所有对块的读写都走这里 |
| `src/block.ts` | 块内容处理 —— 属性拆分、标签、编辑器与数据库内容合并 |
| `src/outline.ts` | 子树改写：把模型返回的大纲解析回树，并规划哪些块更新、插入、删除或保留 |
| `src/prompt.ts` | 拼装 prompt、校验自定义命令 |
| `src/settings.ts` | 设置项的 schema 和默认值 |
| `src/search.ts` | 联网搜索客户端（Tavily） |
| `src/verify.ts` | 搜索循环：提供工具、处理调用、最后作答 |
| `src/deepseek.ts` | API 客户端 |
| `src/parsers.ts` | 把回复解析成列表或结构化字段 |
| `src/prompts/` | 内置 prompt，一个文件一条；`index.ts` 决定顺序 |
| `live/` | prompt 的行为测试（见下文）。不属于 `pnpm test` |

运行时依赖只有 `@logseq/libs`，每次 API 调用都只是一次普通的 `fetch`。产物 gzip 后约 50 kB。

## 改 prompt 之前：跑一遍 live 套件

单元测试只能断言某条 prompt *包含*某句话，说不了模型拿到这句话之后会怎么做。在这套东西出现之前，
每次改 prompt 都是靠手动跑几次来验证的，而记录已经说明了这样会漏掉什么：一次给某条命令修语言的改动，
悄悄把另外四条命令改成了中文回答并且发了版；一条禁止编造论断的规则没拦住编造；一句只给某条命令用的话，
把 `❓` 漏进了另一条命令的正文。`live/` 就是给 prompt 这一层补上的回归网。

```sh
pnpm test:live                                   # 快速网格
LIVE_SCOPE=full pnpm test:live                   # 每条命令 × 每种输入 × 每种语言
LIVE_COMMANDS=Polish,Shorten LIVE_SAMPLES=5 pnpm test:live
LIVE_BASELINE=write pnpm test:live               # 把当前行为记录为基线
```

它跑的是真实的 prompt —— 用插件自己的 `buildMessages` 拼装、用同一套解析器解析 —— 打到真实的
DeepSeek API 上（联网命令还会用到 Tavily），网格是 **命令 × 输入类型 × 输入语言**。输入类型有七种：
一个问题、一段全是真话的陈述、一段一真一假的陈述、一段观点、一个带子要点的多行块、一个带代码围栏的块，
以及一句几乎没内容的"好的，记下了。"；语言是英文、中文、德文。每个格子跑多次，断言的是回复的
**性质**而不是原文：回复语言与输入一致；改写一个问句时不会去回答它、不会以"以下是……"开头、大纲改完还是大纲；
`/Summarize` 只有一行；`/Fact Check` 标出假论断、不碰真论断、格式是 `❌ … → ✅ …`，没问题时只回一行；
`/Verify Online` 遇到问题和观点说"没什么可核查"，真论断给 ✅ 和网址，引用的每个网址都真的出现在搜索结果里；
`/Ask Online` 给出答案、附上来源、正文里不带 `❓✅❌`。网格和检查项分别在 `live/matrix.ts` 和 `live/checks.ts`；
你设置里启用的自定义命令也会一起跑，只做通用检查。

计数写进 `live/last-run.json`（已 git-ignore），并与 `live/baseline.json` 对比：报告先按 `性质 k/n` 列出每个格子，
再列出**相对基线动了什么** —— 变差的、变好的，附上没通过的那条回复。某项性质通过的样本不足 60%
（`LIVE_MIN_PASS`）时该格子判失败，所以偶然一次的抽样波动只会体现为计数，不会直接把构建标红 ——
要看计数，别只看结论。有意改了 prompt 且跑出来确实更好之后，用 `LIVE_BASELINE=write` 重新记录，
把 `live/baseline.json` 和 prompt 一起提交。

key 从环境变量 `DEEPSEEK_API_KEY` / `TAVILY_API_KEY` 读取，没有的话读插件自己的设置文件
（`~/.logseq/settings/logseq-plugin-deepseek-assistant.json`，`LIVE_SETTINGS` 可以指到别处）。
绝不要把 key 写进仓库。没有 Tavily key 时联网命令就不在网格里，跟插件里的行为一样。

费用（用 `deepseek-chat` 实测）：

| 运行方式 | 格子 | 调用量 | 耗时 | 说明 |
| --- | --- | --- | --- | --- |
| `quick`（默认） | 8 条命令 × 3 种输入 × 3 种语言，每格 2 次；联网命令只跑 2 种输入 | 66 个格子：约 155 次对话调用、45 次搜索 | 约 2 分钟 | DeepSeek 花几分钱；占 Tavily 每月免费 1,000 次的 5% |
| `full` | 14 条命令 × 7 种输入 × 3 种语言，每格 3 次（`LIVE_FORCED=1` 再加 6 格） | 300 个格子：约 980 次对话调用、350 次搜索 | 约 6 分钟 | DeepSeek 不到一美元；Tavily 免费额度的三分之一 |

Tavily 的 dev key 还有一个套餐用量上限：记录当前基线的那次运行搜了 182 次之后就撞上了它
（`Tavily plan limit reached (432)`），于是那次运行里 `/Verify Online` 带论断的格子全部报错 —— 报告里会标出来，
也不会写进基线。跑联网命令时要算好这笔预算，或者用 `LIVE_SEARCH=0` 把它们排除。

用 `LIVE_COMMANDS`、`LIVE_KINDS`、`LIVE_LANGS`（逗号分隔，子串匹配）和 `LIVE_SAMPLES` 缩小范围；
`LIVE_SEARCH=0` 跳过联网命令，`LIVE_FORCED=1` 加上"搜一轮就强制作答"的格子（走 `ANSWER_NOW` 那条路），
`LIVE_MODEL=deepseek-reasoner` 换模型（很慢：联网命令每次 30~60 秒），`LIVE_CONCURRENCY` 和
`LIVE_SEARCH_CONCURRENCY`（默认 6 和 3）限制并发 —— Tavily 的 dev key 同时超过八个搜索左右就会拒绝。

## 相比原项目改了什么

除了把 OpenAI 换成 DeepSeek，这个移植版还修掉了几个从上游继承下来的 bug：

- **块属性会被破坏。** 标签是直接拼到块的原始内容后面的，所以一个带 `collapsed:: true`
  或 `id:: …` 的块会变成 `collapsed:: true #[[🤖]]`。而 `replace` 模式会把块的属性整个丢掉，
  包括你自己写的。现在属性会被单独拆出来保管，写回时各占一行。
- **嵌套块会让读取逻辑崩溃。** 旧代码无条件遍历 `child.children`，遇到没有 `children`
  数组的子块就会抛错。
- **`property` 输出会生成有问题的属性名。** 名为 `Ask AI` 的命令会写出 `ask ai:: …`，
  现在会规范化成 `ask-ai::`。
- **错误是静默的。** 请求失败时命令什么都不做，现在会弹通知。
- **斜杠命令会不断增殖。** 每改一次设置就把所有命令重新注册一遍（而且是每条 prompt 各注册一次）。
- **自定义 prompt 里带大括号会直接失败**，因为 LangChain 把 prompt 当模板解析，
  请求都还没发出去就报错了。
- **`format` 从来没有告诉过模型。** 解析器是建了，但它的格式说明从没拼进 prompt，
  模型是否按列表或 JSON 回复全凭运气。

另外新增了：请求超时、自定义命令校验、temperature 设置，以及一套测试。
LangChain、OpenAI SDK、axios、React 和 Tailwind 都已移除。
