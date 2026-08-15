<p align="center">
  <img src="docs/assets/evalhub-product-overview.jpg" alt="EvalHub 多模型评测矩阵" width="920">
</p>

<h1 align="center">EvalHub</h1>

<p align="center">
  用自己的业务测试集，同时比较 2–8 个文本模型。<br>
  把回答、评分、延迟、Token、估算成本和失败项，收进同一条可复核的模型选型流程。
</p>

<p align="center">
  <img src="https://img.shields.io/badge/EvalHub-0.1.0-4f5bd5?style=flat-square" alt="EvalHub 0.1.0">
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

EvalHub 是一个可本地部署的文本模型评测工作台，面向需要做模型选型的 AI 产品经理、独立开发者和公司内部团队。它不是另一个多模型聊天界面，而是把 **连接模型 → 导入数据 → 并行运行 → 查看失败 → 人工复核 → 导出报告** 变成一条可重复的流程。

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
| 多模型对比 | 同时选择 2–8 个文本模型，支持矩阵、网格和聚焦视图 |
| 逐模型参数 | Temperature、Max Tokens、Top P、Top K、频率/存在惩罚、Seed、Stop Sequences 和 System Prompt |
| 模型连接 | OpenAI、Anthropic、Gemini、OpenAI-compatible 与离线 Mock Provider |
| 数据集 | CSV、JSON 和 JSONL 导入，支持标签和预期关键词 |
| 运行控制 | 并行执行、超时、并发数和逐模型配置 |
| 评分与复核 | 关键词启发式评分、可选 LLM-as-a-Judge、原始回答和人工复核备注 |
| 指标与报告 | 延迟、Token、可配置成本估算、失败分析和 CSV 导出 |
| 本地保存 | 本地 JSON 状态，API Key 使用 AES-256-GCM 静态加密 |
| 工作区 | 概览、数据集、测试用例、评测任务、模型管理、失败分析、指标看板、报告、人工复核和系统设置 |

## 使用流程

1. 在 **模型管理 → API 连接** 中添加厂商、API Key 和一个或多个模型 ID。
2. 在 **数据集** 中导入 CSV、JSON 或 JSONL 测试用例。
3. 创建评测任务，选择 2–8 个模型；同一连接下的不同型号也可同时选择。
4. 根据评测目标使用统一参数，或为每个模型保存独立的调优参数，然后运行任务。
5. 在评测矩阵、失败分析、指标看板和人工复核中检查结果，最后导出 CSV 报告。

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
