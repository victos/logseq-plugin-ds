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

插件自带十二条命令，另有两条需要搜索 key 才启用。在块里输入 `/` 然后打名字就能找到。
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
| `/Ask Online` | 联网查出答案并附来源 —— **只在配置了搜索 key 时出现** | 新建子块 |
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

回答会跟随你写作的语言 —— 用中文写的块，得到的就是中文回答；用英文或德文写的块，回答也保持原语言，
联网搜索的命令同样如此。（这条规则只内置在预设 prompt 里；自定义命令的行为完全由你写的 prompt 决定。）

AI 写的内容都会带上 `#[[🤖]]` 标签，方便日后检索：被替换或追加的正文、插入的每一个子块，
以及新增了属性的那个块。标签放在正文末尾；如果正文以围栏代码块或 `key:: value` 属性行结尾，标签会另起一行 ——
写成 `` ``` #[[🤖]] `` 的话，这行就不再是围栏的收尾了；接在属性行后面则会被当成属性值的一部分。标签可以在设置里改，也可以关掉。

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

## 设置项

| 设置 | 默认值 | 说明 |
| --- | --- | --- |
| **API Key** | *(空)* | **必填**，你的 DeepSeek Key |
| **API Base URL** | `https://api.deepseek.com/v1` | 只有走代理或换用其他 OpenAI 兼容接口时才需要改 |
| **Model** | `deepseek-chat` | 见下文。自定义命令可以单独覆盖 |
| **Temperature** | `0.3` | 回答贴合原文的程度。改写类任务宜低；想让 Brainstorm 或 Ask AI 放开一些可以调到 `1.3` 左右 |
| **Tag** | `[[🤖]]` | 给 AI 产出打的标签。填的时候**不要**带 `#`；留空则不打标签 |
| **Web Search API Key** | *(空)* | 可选。[Tavily](https://tavily.com) 的 key，用于启用 `/Ask Online`、`/Verify Online` 以及任何带 `"search": true` 的自定义命令 |
| **Custom Prompts** | 关闭 | 自定义命令，见下文 |

前五项改完即生效，下一次执行命令时就会用新值，不需要重载插件。某一项被清空 —— 哪怕只剩几个空格 ——
就算没填，会退回默认值。Web Search API Key 则不同：它决定联网命令是否注册，所以填入或清空
之后要重载插件 —— 命令集合发生变化时插件会弹一次通知提醒。

API Key 还没填的时候，插件加载时会提示一次，免得刚装上的人对着失败的命令猜原因。

Temperature 这一栏只要你改动过，Logseq 就会把它存成文本（`"0.3"` 而不是 `0.3`），插件两种都能读。
早先的版本读不了文本形式，于是只要这一栏被碰过，所有命令就都悄悄按 DeepSeek 自己的默认值 `1.0` 在跑。

默认值的变化不会影响已有安装：Logseq 会沿用已经保存的设置值。如果你是在默认值改成 `0.3` 之前
装的插件，Temperature 仍然是 `1.0`，想用新默认值需要自己改一下。

### 该用哪个模型

- **`deepseek-chat`** —— 快且便宜。总结、改写、换语气这类日常任务用它就够了。
- **`deepseek-reasoner`** —— 回答前会一步步推理，适合分析和难题，明显更慢。
  它**不是更贵的模型**：两个名字路由到同一个模型、单价相同，只是它的思考内容按输出计费，
  所以同一个问题问它比问 `deepseek-chat` 花得多。思考过程不会写进块里；跑 `/Verify Online` 时，
  每轮搜索之间会按 API 的要求把这些推理回传给模型，答案出来后就丢弃。Temperature 不会发给它。

  它在 live 套件里测过——挑的是最容易让思考型模型出问题的格子：`summarize::` 属性的单行约束、
  改写时必须存活的代码块、容易引来挑刺的正确陈述，以及中德文输入下的语言跟随。24 格 × 2 采样，
  156/156 项检查通过。它的联网路径只验过寥寥几次。

DeepSeek 的 API 现在在自己的报错里把模型叫做 `deepseek-flash` 和 `deepseek-v4-pro`；`deepseek-chat`
和 `deepseek-reasoner` 仍然可用，会映射到前者。Model 一栏两种写法都行。填了 DeepSeek 不认识的名字，
会报 `DeepSeek does not know the model "…"`，并列出它认识的那些。

## 出问题的时候

所有失败都会以 Logseq 通知的形式弹出来。常见的几种：

| 提示 | 怎么办 |
| --- | --- |
| `DeepSeek Assistant: no API key set yet. …` | 插件加载时发现没填 Key，只提示这一次。把 Key 填进设置 |
| `No DeepSeek API key configured. Set it in the plugin settings.` | 把 Key 填进设置 |
| `The API Base URL must start with https:// — it is "…".` | API Base URL 没写协议头。默认值是 `https://api.deepseek.com/v1` |
| `Nothing answers at … (404). Check the API Base URL setting …` | 这个地址下什么都没有，多半是路径打错了。把 API Base URL 改回默认值 |
| `DeepSeek request failed (…): … answered with a web page, not an API reply.` | 地址指向的是网站而不是 API —— 比如把 `api.deepseek.com` 写成了 `platform.deepseek.com`。把 API Base URL 改回默认值 |
| `DeepSeek does not know the model "…" (400): …` | Model 一栏（或某条自定义命令的 `model`）填了 DeepSeek 没有的模型，提示里会列出它有的 |
| `Invalid DeepSeek API key (401): …` | 重新把 Key 复制到设置里 |
| `DeepSeek account has insufficient balance (402): …` | 去 platform.deepseek.com 充值 |
| `DeepSeek rate limit reached (429): …` | 等一会儿再试 |
| `Could not reach …` | 检查网络和 API Base URL |
| `DeepSeek did not answer within 300 s.` | 重试。如果用 `deepseek-reasoner` 时反复出现，换成 `deepseek-chat` 或者把块拆小 |
| `DeepSeek stopped at its output limit — the answer may be cut off.` | 答案已经写入，但可能被截断了。让它写短一点 |
| `The block is empty — nothing to send to DeepSeek.` | 这个块（连同子块）去掉属性之后没有正文 |
| `The block was deleted while DeepSeek was answering.` | 答案已被丢弃。在新的块上再执行一次命令 |
| `This block has no text of its own to rewrite. Run the command on a block with text, or on one of the children.` | 只在 `/Polish`、`/Shorten`、`/Expand`、`/Tone:` 和 `output` 为 `replace` 的自定义命令出现：这个块是空的（或只有标签）但有子块。从这里改写会让每个子块错位一格，所以什么都没发出去 |
| `DeepSeek returned nothing to insert.` | 回复里没有可用的行 —— 用 `/Fact Check` 时，它写的每一行都是在说某句话没问题，这类行会被丢掉。再跑一次，或者把块拆小 |
| `This Logseq version cannot set block properties on a DB graph. Update Logseq, or change the prompt’s "output" away from "property".` | 只在 DB 图上出现：这个版本的 Logseq 没有 `upsertBlockProperty`。升级 Logseq，或者给这条命令换一种 `output` |
| `Could not write the "…" property on this DB graph: …` | 只在 DB 图上出现：属性没能定义或写入，提示里会说明原因。先在 Logseq 里创建这个属性，或者把这条命令的 `output` 改成 `insert` |
| `DeepSeek kept searching without answering (4 rounds). Try a shorter block.` | 只在联网命令（`/Ask Online`、`/Verify Online`、带 `search` 的自定义命令）出现：模型搜了四轮还想接着搜。把块拆小，每次少放几条说法或问题 |
| `No Tavily API key configured. Set it in the plugin settings.` | 某条联网命令是在配置了搜索 key 时注册的，而 key 后来被清空（或只剩空格）了。重新填上，或者重载插件让这条命令消失 |
| `Invalid Tavily API key (401): …` | 重新把 Tavily 的 key 复制到设置里 |
| `Tavily rate limit or monthly quota reached (429): …` | 这个月的搜索额度用完了。等下月重置，或者升级套餐 |
| `Tavily plan limit reached (432): …` | 当前 Tavily 套餐不允许这次请求，到 Tavily 控制台看看 |
| `DeepSeek Assistant ignored N custom prompt(s): …` | 有自定义命令配置写坏了，或者整个 `customPrompts` 设置项形状不对，提示里会说明是哪里 |
| `Available commands changed. Reload the plugin to update the slash menu.` | 你新增、重命名或删除了自定义命令，或者填入 / 清空了 Web Search API Key。每次这类变化只提示一次 |

还是不行？按 `Ctrl+Shift+I` 打开 Logseq 开发者控制台，完整的错误会打印在那里。

## 更多

- [工作原理](./docs/how-it-works.zh-CN.md) —— 命令对块做了什么、Logseq 的两种存储后端、
  改写带子块的块，以及 `/Verify Online` 如何核查一条说法。
- [自定义命令](./docs/custom-prompts.zh-CN.md) —— 字段、四种输出模式，以及怎么让它联网。
- [开发者信息](./docs/development.zh-CN.md) —— 构建与测试、live prompt 套件，
  以及相比原项目改了什么。

## 许可

MIT，与上游一致。
