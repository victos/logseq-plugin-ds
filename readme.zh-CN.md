# Logseq DeepSeek Assistant

在 Logseq 的块里敲一条斜杠命令，就能调用 DeepSeek。 [English](./readme.md) | **中文**

在任意块里输入 `/Polish`，DeepSeek 就会把它改写 —— **连同它下面嵌套的所有要点**，逐个就地更新。
不用切窗口，不用复制粘贴，结果直接落进你的笔记。

![一条命令改写整块及其子块](./docs/demo.gif)

本项目是 [ahonn/logseq-plugin-ai-assistant](https://github.com/ahonn/logseq-plugin-ai-assistant)（MIT）的 DeepSeek 移植版。

## 快速上手

**1. 拿到 API Key** —— 在 [platform.deepseek.com](https://platform.deepseek.com/api_keys)
注册并创建一个 Key。DeepSeek 是预付费的，记得充一点余额。

**2. 安装插件**

先在 Logseq 里打开开发者模式（`设置 → 高级 → 开发者模式`），然后下载 release 包，或者自己构建：

```sh
pnpm install && pnpm build
```

再到插件页面选择「加载未打包的插件」（Load unpacked plugin），选中本文件夹。

**3. 把 Key 填进插件设置**。这是唯一必填项。

**4. 试一下** —— 光标放在任意块里，输入 `/Summarize`。

## 内置命令

插件自带十二条命令，另有一条需要搜索 key 才启用。在块里输入 `/` 然后打名字就能找到。
![斜杠菜单里的插件命令](./docs/menu.png)


| 命令 | 作用 | 结果写到哪 |
| --- | --- | --- |
| `/Ask AI` | 回答块里的问题 | 新建子块 |
| `/Summarize` | 总结当前块 | 写进块的 `summarize::` 属性 |
| `/Polish` | 润色：修掉病句、冗余和不通顺处，不改你的语气 | 替换块内容 |
| `/Shorten` | 精简，保留要点 | 替换块内容 |
| `/Expand` | 扩写，补充细节 | 替换块内容 |
| `/Explain` | 解释这段文字或代码 | 新建子块 |
| `/Fact Check` | 指出它认为客观上不成立的说法 | 每处错误一个子块 |
| `/Verify Online` | 联网搜索，每条判断都附来源 —— **只在配置了搜索 key 时出现** | 每条待核查说法一个子块 |
| `/Brainstorm` | 围绕主题发散想法 | 每条想法一个子块 |
| `/Tone: Friendly` `/Tone: Confident` `/Tone: Casual` `/Tone: Professional` | 改成对应语气 | 替换块内容 |

输入 `/tone` 就能把四条语气命令一起筛出来。

![Fact Check 把它认为有误的地方列成子块，原文一字不动](./docs/fact_check.png)

**`/Fact Check` 从不改写你的原文。** 它靠模型自己的知识判断对错，而这个判断可能是错的，
而且错得很自信。所以它不会去"纠正"你的块，而是把每一条它认为有误的说法单独列成一个子块，
格式是 `❌ 原文说法 → ✅ 更正 (理由)`，原文一字不动；要是没发现问题，就只加一个子块说明没有发现事实错误。
改不改由你决定。把它的输出当作第二份意见，不要当作结论，重要的事实请自己核实。

**`/Polish` 和 `/Tone: …` 不是一回事。** 润色是语气不变、把话说顺；语气命令是换一种口吻重说。
这两类都被明确要求不得增删或编造信息。`/Shorten` 和 `/Expand` 没有这条要求 ——
改变详略本来就是它们的任务。

回答会跟随你写作的语言 —— 用中文写的块，得到的就是中文回答。（这条规则只内置在预设
prompt 里；自定义命令的行为完全由你写的 prompt 决定。）

AI 写的内容都会带上 `#[[🤖]]` 标签，方便日后检索：被替换或追加的正文、插入的每一个子块，
以及新增了属性的那个块。标签可以在设置里改，也可以关掉。

### 怎么给它上下文

命令会读取**当前块，以及它下面嵌套的所有子块**。所以这样写：

```
- 下季度我们该优先做什么？                ← 在这里输入 /Ask AI
  - 流失率从 3% 涨到了 5%
  - 两个大客户的单子推到了 Q4
  - 研发已经满负荷
```

四行会一起发给模型，而不是只发那个问题。

有一个例外：带 `#[[🤖]]` 标签的子块会被跳过，连同它们下面嵌套的内容一起 —— 插件就是靠这个
标签认出自己先前的输出的。否则在同一个块上先跑 `/Ask AI` 再跑 `/Tone: Professional`，答案会被
当成素材喂回去，语气命令改写的就成了那个答案而不是原本的问题。这条规则的可靠程度取决于标签本身：

- 标签按完整词匹配（`#AI` 不会匹配到 `#AIDS`），但只要子块里出现了这个标签就会被跳过 ——
  包括你自己写的、只是引用了这个标签的子块，也包括插件早先只是改写过或加过属性的嵌套块。
  把标签从块里删掉，它就会重新被读取。
- 只认当前的 Tag 设置。用旧标签写出的内容，或者 Tag 留空期间写出的内容，都和普通块一样被读取；
  Tag 清空之后，这层保护也就完全没有了。
- 你执行命令的那个块本身永远会被读取，带不带标签都一样。

Logseq 的元数据（`id::`、`collapsed::`，以及你自己写的 `key:: value` 行）在发送前会被剥掉 ——
模型看到的是你的正文，不是这些管道 —— 写回时再放回去。如果你在块里还没敲完就执行了命令，
插件用的是编辑器里当前的内容，而不是上一次保存的版本。

## 文件图与 DB 图

Logseq 的两种存储后端对「块」的建模完全不同，插件会自动适配当前打开的图 —— **每次执行命令时
检测一次**，所以切换图不需要重载插件。

| | 文件图 | DB 图 |
| --- | --- | --- |
| 块的正文 | `content`，和 `key:: value` 行混在一起 | `title` |
| 属性 | 块内部的文本行 | 独立的实体 |
| `/Summarize` 写什么 | 一行 `summarize:: …` | 通过 API 写 `summarize` 属性 |

文件图上，属性行会在发送前被剥离、写回时原样恢复；DB 图上正文和属性本来就是分开的，替换文本
根本碰不到属性，也就无需重组。

**DB 路径已经在真实 DB 图里、在 Logseq 中手工跑通。** `/Ask AI`、`/Tone:`、`/Summarize`、
`/Shorten` 各自在一个带子块的块上跑过：属性被成功创建并写入，子树被整体改写，而指向某个被改写
子块的 `((引用))` 在之后依然有效。`marketplace/manifest.json` 据此声明 `supportsDB: true`。

另有两个细节是通过 Logseq 自带 CLI 实测确认的，不是从类型定义推断的：

- 写进块正文的 `#[[🤖]]` 标签**会留在正文里**：DB 会记录一条指向 `🤖` 页面的引用，但不会把标签
  移到独立的 tag 字段，读回来时标签原样还在。所以上面描述的标签行为 —— 包括跳过带标签的子块 ——
  在两种后端上都成立。
- **DB 图不允许给块加一个尚不存在的属性**（报错原文 `Property :summarize doesn't exist yet`），
  而且属性最终存储用的是它自己生成的带命名空间 ident，不是你传进去的名字。所以 `/Summarize`
  会先定义属性再写入；万一仍被拒绝，你会看到明确提示，并建议改用 `output: insert`。

SDK 是打包进插件的，真正决定行为的是 **Logseq 的版本**。DB 路径需要宿主提供
`checkCurrentIsDbGraph` 和 `upsertBlockProperty`。老版本没有 `checkCurrentIsDbGraph`，插件会走
文件图路径 —— 这是对的，因为那些版本本来就只有文件图。新版本如果把文件图的块也放进 `title`
而不给 `content`，文件图路径会改读 `title`。

**反倒是文件图路径从未在 Logseq 里真正跑过。** 它有单元测试覆盖，逻辑也沿袭自上游，但开发这台
机器上只有 DB 图，没有任何端到端验证 —— 包括打包进来的 `@logseq/libs` 0.3.x 客户端能否在更老的、
只支持文件图的 Logseq 里正常启动。如果你用的是文件图，前几次请当作试用，留意一下块属性有没有被
改坏。

### 改写带子块的块

`/Polish`、`/Shorten`、`/Expand` 和四条 `/Tone:` 会改写**当前块及其下的全部内容**。模型拿到的是
一棵缩进大纲，返回的也是；插件把它**按位置覆盖到已有的块上**，逐个就地更新 —— 块的身份因此保留，
指向它的 `((引用))` 和它的属性都不会丢。行数可以变：多出来的行新建成块，少掉的块被删除。

**唯一不会被删的是「被引用过的块」。** 文件图上的判据是 `id::`（Logseq 只在块被引用后才写入它）；
DB 图上插件无从查询反向引用，所以**那里一个都不删**。两种情况下多余的块都会原地保留，并弹出通知
告诉你留了几个，由你手动处理。

多行的块 —— 比如两段文字，或者一段围栏代码 —— 仍然是一个块：没有项目符号的行会被当作上一条要点的
续行。插件唯一分不清的是写在**同一个块里**的 Markdown 列表（各占一行的 `- a`、`- b`），这种会被拆成子块。
模型没看到的子块不参与对位：插件自己带标签的输出，以及本身没有正文的块。所以在同一个块上先跑
`/Ask AI` 再跑 `/Polish`，答案会留在原处，不会被覆盖。

由于一条命令现在可能改动多个块，撤销可能需要按多次 Ctrl+Z。

### 对着来源核查：`/Verify Online`

`/Fact Check` 靠模型自己的知识判断，而那有知识截止日期。`/Verify Online` 改为**先搜再判**，
而且每条结论都带上它依据的链接：

```
- DeepSeek 最强的模型是 deepseek-v2，上下文 32K。        ← /Verify Online
    ↓
  - ❌ DeepSeek 最强的模型是 deepseek-v2 → 之后已发布 V3、R1
      等更强模型 — https://api-docs.deepseek.com/zh-cn/updates
  - ✅ <经核实成立的说法> — <来源链接>
  - ❓ <没找到可靠来源的说法>
```

**不配置搜索 key 就不启用。** 到 [tavily.com](https://tavily.com) 申请（免费额度每月 1000 次），
填进设置里的 Web Search API Key。没有 key 时这条命令**根本不会注册**，其余一切不变；填好后重载插件。

代价也很直接：模型回答前会搜 2~4 次，一次运行约 7~12 秒，而 `/Fact Check` 大约 1 秒。
日常顺手一查用 `/Fact Check`，需要**可追溯来源**时用这条 —— 版本号、日期、数字、近期发生的事。

它最多搜四轮，之后必须凭手头的结果作答。某次搜索一时失败（超时、网络抖动）时，失败会告诉模型，
模型就给那条说法写一行 `❓`；而 key 被拒绝或额度用尽时，命令会直接报错停下，让你知道该修什么。
发给 Tavily 的只是模型自己写的搜索词 —— 从你的块里提炼出的短语 —— 块本身不会发过去。
用 `deepseek-reasoner` 也行：这个模型得被明说一句「别再搜了」才会作答，插件会替你说。

搜索这一半不只对着桩测过，也对着真实服务跑过：一次真实的 Tavily 搜索、一次被拒绝的 key（401）、
一次非法参数（400），返回的形状都和客户端预期一致；整条循环在两个模型上都完整跑通 ——
`deepseek-reasoner` 一直跑到强制作答的最后一轮，中间每轮都按 API 的要求把它的推理内容回传。

为什么用 Tavily 而不是普通搜索 API：插件跑在浏览器沙箱里，抓不了任意网页（几乎没有网站发 CORS 头）。
Tavily 在搜索时就把正文清洗好一并返回，省掉了单独抓取这一步。

## 设置项

| 设置 | 默认值 | 说明 |
| --- | --- | --- |
| **API Key** | *(空)* | **必填**，你的 DeepSeek Key |
| **API Base URL** | `https://api.deepseek.com/v1` | 只有走代理或换用其他 OpenAI 兼容接口时才需要改 |
| **Model** | `deepseek-chat` | 见下文。自定义命令可以单独覆盖 |
| **Temperature** | `0.3` | 回答贴合原文的程度。改写类任务宜低；想让 Brainstorm 或 Ask AI 放开一些可以调到 `1.3` 左右 |
| **Tag** | `[[🤖]]` | 给 AI 产出打的标签。填的时候**不要**带 `#`；留空则不打标签 |
| **Web Search API Key** | *(空)* | 可选。[Tavily](https://tavily.com) 的 key，用于启用 `/Verify Online` |
| **Custom Prompts** | 关闭 | 自定义命令，见下文 |

前五项改完即生效，下一次执行命令时就会用新值，不需要重载插件。Web Search API Key 则不同：
它决定 `/Verify Online` 是否注册，所以填入或清空之后要重载插件 —— 插件会弹通知提醒。

Temperature 这一栏只要你改动过，Logseq 就会把它存成文本（`"0.3"` 而不是 `0.3`），插件两种都能读。
早先的版本读不了文本形式，于是只要这一栏被碰过，所有命令就都悄悄按 DeepSeek 自己的默认值 `1.0` 在跑。

默认值的变化不会影响已有安装：Logseq 会沿用已经保存的设置值。如果你是在默认值改成 `0.3` 之前
装的插件，Temperature 仍然是 `1.0`，想用新默认值需要自己改一下。

### 该用哪个模型

- **`deepseek-chat`** —— 快且便宜。总结、改写、换语气这类日常任务用它就够了。
- **`deepseek-reasoner`** —— 回答前会一步步推理，适合分析和难题，但明显更慢也更贵。
  它的思考过程不会写进块里；跑 `/Verify Online` 时，每轮搜索之间会按 API 的要求把这些推理回传给模型，
  答案出来后就丢弃。Temperature 不会发给它。

## 自定义命令

打开插件设置，找到 `customPrompts`，按这个格式填：

```json
{
  "customPrompts": {
    "enable": true,
    "prompts": [
      {
        "name": "Markdown Table",
        "prompt": "把下面的内容整理成 Markdown 表格：\n{{text}}",
        "output": "replace"
      }
    ]
  }
}
```

这样就有了一条 `/Markdown Table` 命令。**新增或重命名命令之后要重载插件** ——
斜杠命令只在插件启动时注册，插件会弹通知提醒你。修改已有命令的 prompt 文本、`output`、`model`
或 `format` 则立即生效，下次执行就是新的。删掉的命令在重载之前仍会按原来的定义继续工作。

每条配置可以写这些字段：

| 字段 | 必填 | 含义 |
| --- | --- | --- |
| `name` | 是 | 斜杠命令的名字 |
| `prompt` | 是 | 给模型的指令。`{{text}}` 是块内容的占位符；不写占位符的话，块内容会用 `"""` 包起来附在末尾 |
| `output` | 是 | 答案写到哪，见下表 |
| `system` | 否 | 设定模型的角色，比如 `"你是一位严谨的技术编辑。"` |
| `model` | 否 | 只给这条命令换一个模型 |
| `format` | 否 | 填 `[]` 得到列表（每行一项，每项一个子块），填 `{"字段名": "字段说明"}` 得到结构化字段 |

四种 `output` 模式的效果，以块内容 `三季度营收增长 12%，但流失率也上升了。` 为例：

| `output` | 结果 |
| --- | --- |
| `replace` | `营收涨 12%，流失也在涨。 #[[🤖]]` |
| `append` | `三季度营收增长 12%，但流失率也上升了。 值得深挖。 #[[🤖]]` |
| `property` | 原文保留并打上标签，增加一行 `markdown-table:: …`（属性名取自命令名，转小写、空格换成连字符；在 DB 图上则是一个 `markdown-table` 属性）。配了 `format` 的话，各项之间用 `, ` 连接 |
| `insert` | 原文保留，答案作为子块插入；配了 `format` 就是每项一个子块 |

两点值得注意：

- `prompt` 和 `system` 里的文字会**原样**发送。JSON 示例、代码片段、`{{query ...}}` 这类
  Logseq 宏都不会出问题。
- 自定义命令如果和内置命令重名，以你的为准。

如果某条配置写坏了 —— 缺 `name`、缺 `prompt`，或者 `output` 不是那四个值之一 ——
插件会跳过它，并在加载时告诉你是哪一条。

## 出问题的时候

所有失败都会以 Logseq 通知的形式弹出来。常见的几种：

| 提示 | 怎么办 |
| --- | --- |
| `No DeepSeek API key configured. Set it in the plugin settings.` | 把 Key 填进设置 |
| `Invalid DeepSeek API key (401): …` | 重新把 Key 复制到设置里 |
| `DeepSeek account has insufficient balance (402): …` | 去 platform.deepseek.com 充值 |
| `DeepSeek rate limit reached (429): …` | 等一会儿再试 |
| `Could not reach …` | 检查网络和 API Base URL |
| `DeepSeek did not answer within 300 s.` | 重试。如果用 `deepseek-reasoner` 时反复出现，换成 `deepseek-chat` 或者把块拆小 |
| `DeepSeek stopped at its output limit — the answer may be cut off.` | 答案已经写入，但可能被截断了。让它写短一点 |
| `The block is empty — nothing to send to DeepSeek.` | 这个块（连同子块）去掉属性之后没有正文 |
| `The block was deleted while DeepSeek was answering.` | 答案已被丢弃。在新的块上再执行一次命令 |
| `DeepSeek returned nothing to insert.` | 回复里没有可用的行 —— 用 `/Fact Check` 时，它写的每一行都是在说某句话没问题，这类行会被丢掉。再跑一次，或者把块拆小 |
| `This Logseq version cannot set block properties on a DB graph. Update Logseq, or change the prompt’s "output" away from "property".` | 只在 DB 图上出现：这个版本的 Logseq 没有 `upsertBlockProperty`。升级 Logseq，或者给这条命令换一种 `output` |
| `Could not write the "…" property on this DB graph: …` | 只在 DB 图上出现：属性没能定义或写入，提示里会说明原因。先在 Logseq 里创建这个属性，或者把这条命令的 `output` 改成 `insert` |
| `DeepSeek kept searching without answering (4 rounds). Try a shorter block.` | 只在 `/Verify Online` 出现：模型搜了四轮还想接着搜。把块拆小，每次少放几条说法 |
| `No Tavily API key configured. Set it in the plugin settings.` | `/Verify Online` 是在配置了搜索 key 时注册的，而 key 后来被清空了。重新填上，或者重载插件让这条命令消失 |
| `Invalid Tavily API key (401): …` | 重新把 Tavily 的 key 复制到设置里 |
| `Tavily rate limit or monthly quota reached (429): …` | 这个月的搜索额度用完了。等下月重置，或者升级套餐 |
| `Tavily plan limit reached (432): …` | 当前 Tavily 套餐不允许这次请求，到 Tavily 控制台看看 |
| `DeepSeek Assistant ignored N custom prompt(s): …` | 有自定义命令配置写坏了，提示里会指出是哪条 |
| `Available commands changed. Reload the plugin to update the slash menu.` | 你新增、重命名或删除了自定义命令，或者填入 / 清空了 Web Search API Key |

还是不行？按 `Ctrl+Shift+I` 打开 Logseq 开发者控制台，完整的错误会打印在那里。

## 开发者信息

```sh
pnpm test    # 249 个单元测试（vitest）
pnpm lint    # 对 src/ 和 test/ 跑 eslint
pnpm build   # tsc + vite，产物在 dist/
```

代码结构：

| 文件 | 职责 |
| --- | --- |
| `src/main.ts` | Logseq 胶水层：注册命令、读写块。没有单元测试 |
| `src/graph.ts` | 文件图 / DB 图适配层，所有对块的读写都走这里 |
| `src/block.ts` | 块内容处理 —— 属性拆分、标签、编辑器与数据库内容合并 |
| `src/prompt.ts` | 拼装 prompt、校验自定义命令 |
| `src/settings.ts` | 设置项的 schema 和默认值 |
| `src/search.ts` | 联网搜索客户端（Tavily） |
| `src/verify.ts` | 搜索循环：提供工具、处理调用、最后作答 |
| `src/deepseek.ts` | API 客户端 |
| `src/parsers.ts` | 把回复解析成列表或结构化字段 |
| `src/prompts/` | 内置 prompt，一个文件一条；`index.ts` 决定顺序 |

运行时依赖只有 `@logseq/libs`，每次 API 调用都只是一次普通的 `fetch`。产物 gzip 后约 47 kB。

### 相比原项目改了什么

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

## 许可

MIT，与上游一致。
