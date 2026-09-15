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

Logseq 的元数据（`id::`、`collapsed::`，以及你自己写的 `key:: value` 行）在发送前会被剥掉 ——
模型看到的是你的正文，不是这些管道 —— 写回时再放回去。如果你在块里还没敲完就执行了命令，
插件用的是编辑器里当前的内容，而不是上一次保存的版本。

## 设置项

| 设置 | 默认值 | 说明 |
| --- | --- | --- |
| **API Key** | *(空)* | **必填**，你的 DeepSeek Key |
| **API Base URL** | `https://api.deepseek.com/v1` | 只有走代理或换用其他 OpenAI 兼容接口时才需要改 |
| **Model** | `deepseek-chat` | 见下文。自定义命令可以单独覆盖 |
| **Temperature** | `1.0` | 回答的发散程度，`0.0`–`2.0`。DeepSeek 建议：写代码 `0.0`，改写 `1.0`，聊天 `1.3`，创意写作 `1.5`。对 `deepseek-reasoner` 不生效 |
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
| `property` | 原文保留并打上标签，增加一行 `markdown-table:: …`（属性名取自命令名，转小写、空格换成连字符） |
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
| `DeepSeek Assistant ignored N custom prompt(s): …` | 有自定义命令配置写坏了，提示里会指出是哪条 |
| `Custom prompts changed. Reload the plugin to register the new slash commands.` | 你新增、重命名或删除了自定义命令 |

还是不行？按 `Ctrl+Shift+I` 打开 Logseq 开发者控制台，完整的错误会打印在那里。

## 开发者信息

```sh
pnpm test    # 112 个单元测试（vitest）
pnpm lint    # 对 src/ 和 test/ 跑 eslint
pnpm build   # tsc + vite，产物在 dist/
```

代码结构：

| 文件 | 职责 |
| --- | --- |
| `src/main.ts` | Logseq 胶水层：注册命令、读写块。没有单元测试 |
| `src/block.ts` | 块内容处理 —— 属性拆分、标签、编辑器与数据库内容合并 |
| `src/prompt.ts` | 拼装 prompt、校验自定义命令 |
| `src/deepseek.ts` | API 客户端 |
| `src/parsers.ts` | 把回复解析成列表或结构化字段 |
| `src/prompts/` | 内置 prompt，一个文件一条；`index.ts` 决定顺序 |

运行时依赖只有 `@logseq/libs`，客户端就是一次 `fetch`。产物约 38 kB（gzip 后）。

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
