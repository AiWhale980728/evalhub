<p align="center">
  <img src="docs/assets/evalhub-product-overview.jpg" alt="EvalHub 多模型评测矩阵" width="920">
</p>

<h1 align="center">EvalHub</h1>

<p align="center">
  用自己的业务测试集，同时比较 2–8 个文本模型或生图模型。<br>
  把回答或图片、评分、延迟、估算成本和失败项，收进同一条可复核的模型选型流程。
</p>

<p align="center">
  <img src="https://img.shields.io/badge/EvalHub-0.2.0-4f5bd5?style=flat-square" alt="EvalHub 0.2.0">
  <img src="https://img.shields.io/badge/Node.js-22%2B-339933?style=flat-square&logo=node.js&logoColor=white" alt="Node.js 22+">
  <img src="https://img.shields.io/badge/self--hosted-BYOK-168f91?style=flat-square" alt="Self-hosted BYOK">
  <img src="https://img.shields.io/badge/license-Community-d63d4b?style=flat-square" alt="Community License">
  <a href="https://github.com/HiWhaleW/evalhub/actions/workflows/ci.yml"><img src="https://github.com/HiWhaleW/evalhub/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
</p>

<p align="center">
  <a href="#五分钟安装"><strong>五分钟安装</strong></a>
  ·
  <a href="#使用流程"><strong>使用流程</strong></a>
  ·
  <a href="#安全与数据边界"><strong>安全边界</strong></a>
  ·
  <a href="https://github.com/HiWhaleW/evalhub/issues"><strong>反馈问题</strong></a>
</p>

> [!NOTE]
> 上图是使用合成演示数据生成的界面。EvalHub 全新安装后是空白工作区，不会自动创建模型连接、数据集、评测历史或虚构评分。

> [!IMPORTANT]
> EvalHub 是 **source available** 软件，不是 OSI 定义的开源软件。[EvalHub Community License](LICENSE) 允许个人、教育、评估和单一法律实体内部使用，但禁止删除署名、白标化、转售、付费托管、SaaS 和商业再分发。

## EvalHub 是什么

EvalHub 是一个可本地部署的文本与生图模型评测工作台，面向需要做模型选型的 AI 产品经理、独立开发者和公司内部团队。它不是另一个多模型聊天界面，而是把 **连接模型 → 导入数据 → 并行运行 → 查看失败 → 人工复核 → 导出报告** 变成一条可重复的流程。

模型凭据由用户自己提供（BYOK），测试集、评测结果和加密后的 API Key 默认保存在本地。同一厂商的多个模型型号可以在同一次任务中对比，每个模型也可保存独立的推理参数快照。

## 为什么不是开几个聊天窗口

| 选型问题 | 手动复制到多个窗口 | EvalHub |
| --- | --- | --- |
| 输入是否一致 | 依赖手工操作 | 同一数据集并行执行 |
| 参数能否复现 | 容易遗漏 | 按模型保存参数快照 |
| 能否比较质量之外的指标 | 需要额外记录 | 延迟、Token、估算成本和失败项同屏展示 |
| 能否定位失败样本 | 靠人工翻找 | 失败分析与用例详情直接关联 |
| 结论能否复核 | 多为即时印象 | 保留原始输出、人工复核和 CSV 报告 |

EvalHub 的价值不是“接了更多 API”，而是把主观、零散的模型试用，变成可重复、可复核、可解释的选型依据。

## 核心能力

| 能力 | 当前支持 |
| --- | --- |
| 多模型对比 | 同时选择 2–8 个同类型模型；文本与生图均支持矩阵、网格和匿名盲测 |
| 逐模型参数 | 文本支持采样参数与 System Prompt；生图支持文生图、参考图 + 文字指令的图生图，以及尺寸、质量、风格、负向提示词和 Seed |
| 模型连接 | 文本支持 OpenAI、Anthropic、Gemini、OpenAI-compatible；生图支持 OpenAI Images、Gemini Imagen、OpenAI-compatible 与离线 Mock |
| 数据集 | CSV、JSON 和 JSONL 导入，支持标签和预期关键词 |
| 公平对比 | 统一基线模式强制所有模型使用相同参数与 System Prompt；模型优化模式保留逐模型调参 |
| 重复运行 | 每条用例重复运行 3–5 次，汇总均分、最低分、标准差、通过率、平均/P95 延迟和成本 |
| 盲测对战 | 同一用例、同一次运行下自动生成全部模型两两组合；回答或图片匿名 A/B 投票后再揭示身份 |
| 多维 Rubric | 自定义 1–12 个评分维度、说明、权重和自动/人工方式；LLM Judge 支持逐维评分 |
| 决策面板 | 质量—成本、质量—P95 延迟散点，约束筛选、Pareto 候选和盲测胜率 |
| 运行控制 | 并行执行、超时、并发数、固定/递增 Seed 和参数快照 |
| 评分与复核 | 关键词启发式评分、可选 LLM-as-a-Judge、原始回答和逐次人工复核备注 |
| 指标与报告 | 延迟、Token、可配置成本估算、稳定性、失败分析和含逐维分数的 CSV 导出 |
| 本地保存 | 本地 JSON 状态，API Key 使用 AES-256-GCM 静态加密 |
| 工作区 | 概览、数据集、测试用例、评测任务、模型管理、失败分析、指标看板、报告、人工复核和系统设置 |

## 使用流程

1. 在 **模型管理 → API 连接** 中选择文本生成或图片生成，添加厂商、API Key 和一个或多个模型 ID。
2. 在 **数据集** 中导入 CSV、JSON 或 JSONL 测试用例。
3. 创建评测任务，选择 2–8 个模型；同一连接下的不同型号也可同时选择。
4. 选择 **统一基线** 或 **模型优化** 口径，设置每条用例重复 3–5 次，并配置多维 Rubric。
5. 在矩阵中查看重复运行均分和逐维结果，在盲测对战中匿名判断 A/B 回答。
6. 使用模型决策面板设置最低质量、最高成本和最高 P95 延迟约束，再结合 Pareto 候选、失败样本与盲测胜率做选型。
7. 完成人工复核后导出含每次运行、逐维分数和原始回答的 CSV 报告。

### 公平口径与重复运行

- **统一基线**用于回答“在完全相同调用条件下，哪个模型更适合这组任务”。服务端会覆盖逐模型参数，避免只在界面上锁定但实际请求不一致。
- **模型优化**用于回答“允许针对每个模型调优后，各自的最佳表现如何”。每个模型的独立参数都会写入任务快照。
- 重复运行会为每次调用保存独立的 `attempt`。配置 Seed 时，每轮在基础 Seed 上递增 1，使不同模型仍使用公平一致的轮次 Seed。

决策面板给出的是“当前数据集、Rubric、价格快照和约束下的优先候选”，不会把任何模型表述为脱离场景的绝对最佳。

> 自动评分、LLM-as-a-Judge 和成本数据都是选型依据，不是绝对真值或最终账单。重要结论应结合原始回答、失败样本和人工复核一起判断。

## 五分钟安装

需要 Node.js `22` 或更高版本。

```bash
git clone https://github.com/HiWhaleW/evalhub.git
cd evalhub
npm ci
npm run dev
```

打开 `http://localhost:4173`。Web 界面和本地 API 会一起启动。

使用生产构建在本地运行：

```bash
npm run build
npm start
```

然后打开 `http://localhost:8787`。

### 空白安装与离线示例

EvalHub 默认以空白工作区启动。如果想在没有厂商 API Key 的情况下先体验产品，可以在概览页主动点击 **加载示例项目**。

这个操作只会添加一个离线 Mock 连接和一个合成客服数据集，不会添加评测历史或虚构分数。两项示例资产都可删除。

## Docker

```bash
docker compose up --build
```

打开 `http://localhost:8787`。持久化状态保存在 `evalhub-data` 命名卷中。

生产环境应通过部署平台或密钥管理器设置一个足够长且稳定的 `EVALHUB_MASTER_KEY`。修改或丢失该密钥后，先前加密的 API 凭据将无法读取。

## API 连接

连接在 **模型管理 → API 连接** 中配置。

| 类型 | 典型 Base URL | 协议 |
| --- | --- | --- |
| OpenAI | `https://api.openai.com/v1` | OpenAI Chat Completions |
| Anthropic | `https://api.anthropic.com` | Anthropic Messages |
| Gemini | `https://generativelanguage.googleapis.com` | Gemini generateContent |
| OpenAI-compatible | 厂商或本地服务地址 | OpenAI-compatible endpoints |
| Mock | `mock://local` | 离线、可重复的演示输出 |

生图连接支持文生图和图生图。文生图时，OpenAI 与 compatible 连接调用 `POST /images/generations`，Gemini 连接调用 Imagen `:predict`。图生图时，用户上传一张 PNG、JPEG 或 WebP 参考图片（最大 5 MB），并必须填写文字编辑指令；OpenAI 与 compatible 连接调用 multipart `POST /images/edits`，Gemini 模型使用图片与文字联合输入。具体模型是否开放图片编辑能力仍由厂商决定，不支持的型号会在结果中保留接口错误，便于横向识别能力边界。

生图任务会把输入方式、参考图、文字指令和生成参数保存为本地不可变快照，并持久化图片结果（优先保存 API 返回的 base64 data URL）、延迟和单张价格；若厂商只返回临时 HTTPS URL，报告会保留该 URL，其有效期由厂商决定。

应用不会把已保存 API Key 的明文返回给浏览器。连接列表只显示是否已配置密钥以及末四位。

## 数据集格式

JSONL 示例：

```json
{"id":"TC-001","input":"Explain the refund policy","expectedKeywords":["refund","policy"],"tags":["support"]}
```

CSV 示例：

```csv
id,input,expected_keywords,tags
TC-001,Explain the refund policy,refund|policy,support
```

CSV 导入器适合简单的逗号分隔数据。如果字段中包含逗号或换行，建议使用 JSONL。

## 安全与数据边界

- 状态保存在 `EVALHUB_DATA_DIR` 下，不会提交到源码仓库。
- API Key 使用 AES-256-GCM 静态加密。
- 没有配置主密钥时，EvalHub 会在数据目录生成一个带限制文件权限的随机本地密钥。
- 服务默认只绑定 `127.0.0.1`；Docker 为了映射端口会在容器内绑定所有接口。
- 写接口会拒绝跨域浏览器请求。
- **本地部署不等于提示词和模型输出永不离开本机。** 评测请求会发送给你配置的模型厂商，使用机密数据前应复核对应厂商的隐私和保留政策。

如需让受信任网络以外的用户访问，请在 EvalHub 前面部署带身份验证的 TLS 反向代理，并由部署环境提供防火墙、备份、RBAC、SSO、审计日志和多用户隔离。完整边界见 [SECURITY.md](SECURITY.md)。

## 验证

```bash
npm run check
```

该命令会运行单元测试、API 生命周期测试、生产构建和静态 Worker 打包测试。

## 许可证

EvalHub 是 **source available** 软件，不是 OSI 开源项目。[EvalHub Community License](LICENSE) 允许个人、教育、评估和公司内部使用与修改，前提是界面中可见的 `EvalHub by YJW` 署名与 Community License 通知保持完整。

未经单独书面商业许可，不得白标化、删除或弱化署名、转售、付费托管、提供 SaaS、商业再分发，或将软件嵌入面向第三方的商业产品。完整条款以 [LICENSE](LICENSE) 为准；许可边界摘要见 [COMMERCIAL-LICENSE.md](COMMERCIAL-LICENSE.md)。

许可证和本节摘要不构成法律建议。如需依赖这些条款进行执法或合规决策，请寻求专业法律审查。

## 贡献

欢迎提交缺陷报告和聚焦的改进。请先阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。如果涉及安全漏洞，请使用 GitHub 的私密漏洞报告功能，不要在公开 Issue 中披露。
