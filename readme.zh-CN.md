# Logseq DeepSeek Assistant

在 Logseq 的块里敲一条斜杠命令，就能调用 DeepSeek。 [English](./readme.md) | **中文**

在任意块里输入 `/Summarize`，DeepSeek 就会把这个块总结好；输入 `/Shorten`，它会就地改写。
不用切窗口，不用复制粘贴，答案直接落进你的笔记。

```
- 三季度营收增长 12%，但流失率也上升了。            ← 在这里输入 /Summarize
    ↓
- 三季度营收增长 12%，但流失率也上升了。 #[[🤖]]
  summarize:: 增长被流失抵消。                      ← 作为属性写入
```

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

插件自带十二条命令。在块里输入 `/` 然后打名字就能找到。

| 命令 | 作用 | 结果写到哪 |
| --- | --- | --- |
| `/Ask AI` | 回答块里的问题 | 新建子块 |
| `/Summarize` | 总结当前块 | 写进块的 `summarize::` 属性 |
| `/Polish` | 润色：修掉病句、冗余和不通顺处，不改你的语气 | 替换块内容 |
| `/Shorten` | 精简，保留要点 | 替换块内容 |
| `/Expand` | 扩写，补充细节 | 替换块内容 |
| `/Explain` | 解释这段文字或代码 | 新建子块 |
| `/Fact Check` | 指出它认为客观上不成立的说法 | 每处错误一个子块 |
| `/Brainstorm` | 围绕主题发散想法 | 每条想法一个子块 |
| `/Tone: Friendly` `/Tone: Confident` `/Tone: Casual` `/Tone: Professional` | 改成对应语气 | 替换块内容 |

输入 `/tone` 就能把四条语气命令一起筛出来。

**`/Fact Check` 从不改写你的原文。** 它靠模型自己的知识判断对错，而这个判断可能是错的，
而且错得很自信。所以它不会去"纠正"你的块，而是把每一条它认为有误的说法单独列成一个子块，
格式是 `❌ 原文说法 → ✅ 更正 (理由)`，原文一字不动；要是没发现问题，就只加一个子块说明没有发现事实错误。
改不改由你决定。把它的输出当作第二份意见，不要当作结论，重要的事实请自己核实。

**`/Polish` 和 `/Tone: …` 不是一回事。** 润色是语气不变、把话说顺；语气命令是换一种口吻重说。
这两类都被明确要求不得增删或编造信息。`/Shorten` 和 `/Expand` 没有这条要求 ——
改变详略本来就是它们的任务。

回答会跟随你写作的语言 —— 用中文写的块，得到的就是中文回答。（这条规则只内置在十二条预设
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

命令会读取**当前块及其下嵌套的所有内容**，但会跳过插件自己写的东西 —— 也就是带 `#[[🤖]]`
标签的子块。否则在同一个块上先跑 `/Ask AI` 再跑 `/Tone: Professional`，答案会被当成素材喂回去，
语气命令改写的就成了那个答案而不是原本的问题。**如果你把 Tag 设置清空，插件就认不出自己的输出，
这层保护也就没了。**

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

**DB 那条路径有单元测试，但从未在真实的 DB 图上跑过。** 它是照着 `@logseq/libs` 0.3.4 的类型定义写的，
测试时对接的也只是一个假的编辑器对象。有三点尤其没有验证过：`upsertBlockProperty` 遇到尚不存在的属性会不会
自动创建；DB 图会怎么处理追加在正文末尾的 `#[[🤖]]` 标签（有可能被转成标签实体、从正文里去掉）；
以及对正在编辑中的块调用 `updateBlock` 是什么效果。在你亲自验证之前，请当它是未经实测的 ——
这也是 `marketplace/manifest.json` 里 `supportsDB` 仍为 `false` 的原因。

SDK 是随插件一起打包的，真正起决定作用的是 Logseq 本身的版本。DB 路径要求 Logseq 提供
`checkCurrentIsDbGraph` 和 `upsertBlockProperty` 这两个 API。老版本没有 `checkCurrentIsDbGraph`，
插件就走文件图路径 —— 这是对的，因为那些版本本来就只有文件图。新版本如果返回的文件图块把 markdown
放在 `title` 里、没有 `content`，文件图路径会改读 `title`。

有两点是**对着真实 DB 图实测**的（Logseq desktop nightly，走它自带的 CLI），而不是从类型定义推断的：

- 写进块正文的 `#[[🤖]]` 标签**会留在正文里** —— DB 不会把它抽成独立的 tag 字段，所以上面描述的
  标签行为在两种后端上都成立。
- **DB 图不允许给块加一个尚不存在的属性**（报错原文 `Property :summarize doesn't exist yet`），
  而且属性最终存储用的是它自己生成的带命名空间 ident，不是你传进去的名字。所以 `/Summarize`
  会先定义属性再写入；万一仍被拒绝，你会看到明确提示，并建议改用 `output: insert`。

仍未验证的部分 —— 这些需要插件真正跑在 Logseq 里，CLI 验不了：DB 图上
`getBlock({includeChildren: true})` 的子块嵌套结构是否一致、`insertBlock` 是否追加为最后一个
子块（`/Brainstorm` 的顺序依赖它）、以及打包进来的 `@logseq/libs` 0.3.x 客户端能否在更老的
文件图版 Logseq 里正常启动。

## 设置项

| 设置 | 默认值 | 说明 |
| --- | --- | --- |
| **API Key** | *(空)* | **必填**，你的 DeepSeek Key |
| **API Base URL** | `https://api.deepseek.com/v1` | 只有走代理或换用其他 OpenAI 兼容接口时才需要改 |
| **Model** | `deepseek-chat` | 见下文。自定义命令可以单独覆盖 |
| **Temperature** | `0.3` | 回答贴合原文的程度。改写类任务宜低；想让 Brainstorm 或 Ask AI 放开一些可以调到 `1.3` 左右 |
| **Tag** | `[[🤖]]` | 给 AI 产出打的标签。填的时候**不要**带 `#`；留空则不打标签 |
| **Custom Prompts** | 关闭 | 自定义命令，见下文 |

前五项改完即生效，下一次执行命令时就会用新值，不需要重载插件。

### 该用哪个模型

- **`deepseek-chat`** —— 快且便宜。总结、改写、换语气这类日常任务用它就够了。
- **`deepseek-reasoner`** —— 回答前会一步步推理，适合分析和难题，但明显更慢也更贵。
  它的"思考过程"会被丢弃，只有最终答案写进块里。Temperature 不会发给它。

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
| `This Logseq version cannot set block properties on a DB graph. Update Logseq, or change the prompt’s "output" away from "property".` | 只在 DB 图上出现：这个版本的 Logseq 没有 `upsertBlockProperty`。升级 Logseq，或者给这条命令换一种 `output` |
| `DeepSeek Assistant ignored N custom prompt(s): …` | 有自定义命令配置写坏了，提示里会指出是哪条 |
| `Custom prompts changed. Reload the plugin to register the new slash commands.` | 你新增、重命名或删除了自定义命令 |

还是不行？按 `Ctrl+Shift+I` 打开 Logseq 开发者控制台，完整的错误会打印在那里。

## 开发者信息

```sh
pnpm test    # 150 个单元测试（vitest）
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
| `src/deepseek.ts` | API 客户端 |
| `src/parsers.ts` | 把回复解析成列表或结构化字段 |
| `src/prompts/` | 内置 prompt，一个文件一条；`index.ts` 决定顺序 |

运行时依赖只有 `@logseq/libs`，客户端就是一次 `fetch`。产物 gzip 后约 43 kB。

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
