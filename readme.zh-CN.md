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

## 文件图与 DB 图

Logseq 的两种存储后端对「块」的建模完全不同，插件会自动适配当前打开的图 —— **每次执行命令时
检测一次**，所以切换图不需要重载插件。

| | 文件图 | DB 图 |
| --- | --- | --- |
| 块的正文 | `content`，和 `key:: value` 行混在一起 | `title` |
| 属性 | 块内部的文本行 | 独立的实体 |
| `/Summarize` 写什么 | 一行 `summarize:: …` | 通过 API 写 `summarize` 属性 |

文件图上，属性行会在发送前被剥离、写回时原样恢复 —— 放回第一行之后；如果块是以围栏代码、表格、
引用或列表开头的，就放在块的最前面，这也是 Logseq 自己对这类块的写法（放在围栏那一行后面，属性就
落进代码里了，写在那里的 `id::` 也就不再是属性，块的引用随之失效）。DB 图上正文和属性本来就是
分开的，替换文本根本碰不到属性，也就无需重组。

**DB 路径已经在真实 DB 图里、在 Logseq 中手工跑通。** `/Ask AI`、`/Tone:`、`/Summarize`、
`/Shorten` 各自在一个带子块的块上跑过：属性被成功创建并写入，子树被整体改写，而指向某个被改写
子块的 `((引用))` 在之后依然有效。`marketplace/manifest.json` 据此声明 `supportsDB: true`。
此后新增的逻辑在两种后端上都还没在 Logseq 里跑过，只在测试里对着一个内存中的图验证过：改写时若要在
一个已有要点的父块下新增要点，会插在那个要点之后作为其兄弟块（`insertBlock(…, { sibling: true })`），而不是
作为父块的最后一个子块；块里没有收尾的围栏代码会在发给模型的大纲里补上收尾；包在围栏里的回复会先拆掉围栏；
写在块里的 Markdown 列表在制表符缩进的回复下能保住；模型写出的 `key:: value` 和 `id::` 行按「改写带子块的块」
一节所述处理。

另有三个细节是通过 Logseq 自带 CLI 实测确认的，不是从类型定义推断的：

- 写进块正文的 `#[[🤖]]` 标签**会留在正文里**：DB 会记录一条指向 `🤖` 页面的引用，但不会把标签
  移到独立的 tag 字段，读回来时标签原样还在。所以上面描述的标签行为 —— 包括跳过带标签的子块 ——
  在两种后端上都成立。
- 正文以围栏代码结尾、标签另起一行的块，存进去是什么样读出来就是什么样，标签不会被折回围栏那一行。
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

**有两种块永远不会被删。** 一是被引用过的块：文件图上的判据是 `id::`（Logseq 只在块被引用后才写入它）；
DB 图上插件不去查询反向引用，所以**那里一个都不删**。二是模型没看到的、你自己写的笔记：多余的块下面
如果在插件自己带标签的输出里藏着你写的块（比如在 `/Ask AI` 的答案下面追加的一条），或者在那段输出里、
在一个空块之下藏着一个被引用的块，这个多余的块同样会保留。只有插件自己的带标签输出、下面再没有别的东西时，
才会跟着它所回答的那条要点一起删掉。保留下来的块都原地不动，并弹出通知告诉你留了几个，由你手动处理。

多行的块 —— 两段文字、一段围栏代码、一个 Markdown 列表 —— 仍然是一个块：没有项目符号的行会被当作上一条
要点的续行；列表行（`- a`、`1. b`）只要出现在续行该在的位置 —— 缩进是所属要点的制表符再加两个空格，或者
不带缩进、直接写在当前块正文里 —— 也一样算续行。这依赖于回复保持模型拿到的制表符缩进：回复全用空格缩进时，
分不清列表行和子要点；块本身没有子块时也分不清，因为大纲里没有任何制表符可供参照 —— 这两种情况下，
写在块里的列表会变成子块。块里没有收尾的围栏代码，在发给模型的大纲里会补上收尾，免得它把后面的要点都吞进
代码；模型把整段回复包在 ```` ```markdown ```` 围栏里的话，插件会先拆掉围栏，而不是把整段当成一个代码块写回
（被改写的块本身就是代码块时，同类的围栏就是内容，会原样保留 —— 但 ```` ```markdown ```` 围栏仍然算模型加的包装）；模型写出的 `key:: value` 行会成为块的属性，只设一次，
而且绝不覆盖块原有的同名属性。
模型没看到的子块不参与对位：插件自己带标签的输出，以及本身没有正文的块。所以在同一个块上先跑
`/Ask AI` 再跑 `/Polish`，答案会留在原处，不会被覆盖；改写新增的要点会紧跟在模型看到的最后一个要点之后，
而不是排在那条答案后面。

执行改写命令的块本身必须有正文。在空块里执行的话，第一个子块会被当成块本身，后面每一行都会错位一格，
所以插件会直接拒绝（`This block has no text of its own to rewrite…`），请到某个子块里执行。

由于一条命令现在可能改动多个块，撤销可能需要按多次 Ctrl+Z。

`/Ask AI` 靠模型自己的知识作答，而那有截止日期 —— 问它 DeepSeek 最新的模型是哪个，它说的是两个大版本
之前的那个；问今天天气，它只能建议你去装个天气 App。**`/Ask Online`** 会真的去查，列出所依据的
网址，说明答案对应的是哪个日期、哪个时区、哪个地方，来源有分歧时给出区间而不是挑一个。

它和 `/Verify Online` 用同一个搜索 key，耗时大约 5~20 秒，而 `/Ask AI` 约 1 秒 —— 所以两条都保留：
问不随时间变的事用离线那条，问会变的事用联网这条。

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

`/Verify Online` **只核查文本真正断言的内容**。如果块本身是一个问句、一个标题、一句备忘、一段代码或一种看法，那就没有
什么可核查的，它会用一行说明这一点，而不是凭空编出几条"说法"再去核查。用下文的 live 套件实测：这一行在英文和德文块上
每次都用块本身的语言，中文块上只有一半左右；对纯看法的块，大约四次里有一次仍会给每条看法各标一个 `❓`；
像"我昨天写的一个小函数"这样的一句备忘，偶尔会被当成一条无法核实的论断。来源认同的说法标 ✅，
不会标成 ❌ 再把来源原话当成"修正"写一遍。

**不配置搜索 key 就不启用。** 到 [tavily.com](https://tavily.com) 申请（免费额度每月 1000 次），
填进设置里的 Web Search API Key。没有 key 时这条命令**根本不会注册**，其余一切不变；填好后重载插件。

代价也很直接：用 `deepseek-chat` 时模型回答前会搜 2~4 次，一次运行约 7~12 秒，而 `/Fact Check`
大约 1 秒；`deepseek-reasoner` 在一次实测中搜了 8 次、跑了 4 轮，用时 45 秒。
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
- **`deepseek-reasoner`** —— 回答前会一步步推理，适合分析和难题，但明显更慢也更贵。
  它的思考过程不会写进块里；跑 `/Verify Online` 时，每轮搜索之间会按 API 的要求把这些推理回传给模型，
  答案出来后就丢弃。Temperature 不会发给它。

DeepSeek 的 API 现在在自己的报错里把模型叫做 `deepseek-flash` 和 `deepseek-v4-pro`；`deepseek-chat`
和 `deepseek-reasoner` 仍然可用，会映射到前者。Model 一栏两种写法都行。填了 DeepSeek 不认识的名字，
会报 `DeepSeek does not know the model "…"`，并列出它认识的那些。

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
| `search` | 否 | 填 `true` 让这条命令先联网搜索再作答，行为同 `/Ask Online`。需要配置 Web Search API Key；每次运行多花几次搜索和 5~20 秒 |
| `format` | 否 | 填 `[]` 得到列表（每行一项，每项一个子块），填 `{"字段名": "字段说明"}` 得到结构化字段 |

自定义命令也可以联网 —— 加上 `"search": true`，它就会走和 `/Ask Online` 相同的流程，先查再答。
这需要配置 Web Search API Key。和内置的联网命令不同（那两条没有 key 时直接不注册），**自定义命令
要求联网却没有 key 时会在警告里明说**，这样你自己写的命令不会莫名消失。

`search` 和四种 `output` 都能搭配，但推荐用 `insert`。联网得到的答案是几句话加上所依据的网址；
不写 `format` 的话，这些内容整体落进一个子块。改用 `replace` 时，同样的答案会走大纲改写流程：
正文和裸网址会成为块自己的文字，但如果模型把来源写成了列表（`- https://…`），这些行会变成子块，
并逐条覆盖这个块原有的子块。

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

如果某条配置写坏了 —— 缺 `name`、缺 `prompt`、`output` 不是那四个值之一，或者 `format` 既不是 `[]`
也不是对象 —— 插件会跳过它，并在加载时告诉你是哪一条。整个设置项形状不对也会同样提示：该写
`{"enable": …, "prompts": […]}` 对象的地方写成了列表，或者 `enable` 开着但 `prompts` 缺失、不是列表。
自定义命令这块没有任何一种写错会被悄悄吞掉。

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

## 开发者信息

```sh
pnpm test       # 348 个测试（vitest），其中一个是覆盖块写入流程的属性测试
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

### 改 prompt 之前：跑一遍 live 套件

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
