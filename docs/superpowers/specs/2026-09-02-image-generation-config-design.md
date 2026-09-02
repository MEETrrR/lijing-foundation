# 生图供应商配置与本地生成入口设计

**版本：** v1.0  
**日期：** 2026-09-02  
**状态：** 已获用户确认，待实施计划  
**适用范围：** 砺境本地生图工作流与项目资源落地

## 1. 目标

为项目提供一个安全、可替换的本地生图入口，允许配置两套用户已有的图像服务：

- GPT Image 2 自定义 API 端点、密钥和模型名。
- Grok Imagine 自定义 API 端点、密钥和模型名。

用户只需要编辑一个本地配置文件即可填写凭据和端点。生成结果输出到项目的 `assets/generated/source/`，后续可按现有资源清单登记并进入人工审核。

## 2. 非目标

- 不把 API 密钥写入源码、示例配置、日志、客户端或提交记录。
- 不让移动端、Web 客户端或业务模块直接调用模型供应商。
- 不在本次工作中实现完整生产级 AI Gateway、配额账本、后台管理和审核系统。
- 不假设 Grok 端点的专有请求格式；首期只实现明确的 OpenAI Images 兼容请求模式，并保留供应商适配边界。

## 3. 方案

### 3.1 配置文件

新增可提交的模板：

```text
infra/environments/image-generation.env.example
```

本地实际配置使用：

```text
infra/environments/image-generation.env
```

实际配置文件加入 `.gitignore`。模板只包含字段名、说明和安全占位符，不包含真实端点或密钥。

配置分为三组：

1. 全局设置：默认供应商、输出目录、默认尺寸、质量和请求超时。
2. GPT Image 设置：端点、密钥、模型、鉴权头和鉴权前缀。
3. Grok Imagine 设置：端点、密钥、模型、鉴权头和鉴权前缀。

密钥值只在进程内读取，配置检查和错误信息只显示供应商名、端点 origin、模型名和缺失字段，不显示密钥内容。

### 3.2 Skill 与工具边界

本地生成工作流使用仓库现有的 `gpt-image` skill（`.codex/skills/gpt-image/`）负责提示词、参考图和视觉资产流程。自定义端点由项目侧的轻量 Node.js 入口负责调用，不引入未经审查的第三方运行时代码；skill 只负责本地生成操作，不成为项目业务运行时依赖。

项目侧提供一个轻量 Node.js 命令入口，负责：

- 读取并校验本地生图配置。
- 按 `gpt` 或 `grok` 选择供应商。
- 发送标准化的 OpenAI Images 兼容请求。
- 处理 `b64_json` 或受控图片 URL 响应。
- 将图片保存到配置的输出目录。
- 输出不含密钥的生成摘要和文件路径。

供应商适配器只接收规范化参数，例如 `prompt`、`size`、`quality`、`count` 和 `outputPath`。业务模块不接触端点、密钥或原始供应商响应。

### 3.3 资源落地

默认输出目录为：

```text
assets/generated/source/
```

生成命令不自动把任意结果标记为正式资产。生成结果保持候选状态；通过单独的登记命令显式提供稳定 `asset_id` 后，才允许写入或更新 `asset-manifest.json` 的对应记录，并记录来源、尺寸、哈希、用途和审核状态。未完成审核的资产仍保持 `candidate` / `pending` 状态。

## 4. 数据流

```text
本地配置文件
    -> 配置加载与脱敏校验
    -> 选择 GPT 或 Grok provider
    -> 标准化生图请求
    -> 供应商端点
    -> b64/受控 URL 响应解析
    -> assets/generated/source/
    -> 可选的 manifest 登记
```

实际密钥不进入客户端构建产物、资源 manifest、命令输出、异常文本或 Git 历史。

## 5. 错误处理与安全

- 缺少密钥、端点或模型时，配置检查以明确字段名失败。
- 端点必须是带协议的 URL；请求超时使用配置值并给出可重试提示。
- 供应商返回非成功状态时，保留状态码和经过截断/脱敏的错误摘要，不回显鉴权头或完整响应体。
- 只对明确的瞬时网络错误进行一次有限重试，不做无限重试。
- 通过 URL 返回图片时，只允许配置端点允许的协议和受控主机；无法安全下载时要求供应商返回 `b64_json`。
- 生成结果保存前校验图片 MIME、文件大小和像素上限，避免把异常响应当作资源写入项目。
- `.env`、密钥扫描和 `git diff --check` 纳入验证流程。

## 6. 命令与验收

计划提供以下命令：

```text
pnpm image:config:check
pnpm image:generate --provider=gpt --prompt="..." --output="..."
pnpm image:generate --provider=grok --prompt="..." --output="..."
pnpm image:register --file="assets/generated/source/example.png" --asset-id="example-v1"
```

验收标准：

1. 模板中有两家供应商的端点、密钥和模型输入位置。
2. 实际配置文件不被 Git 跟踪，且配置检查输出不泄露密钥。
3. 缺失配置、非法 URL、非兼容响应和供应商错误都有可理解的失败结果。
4. 使用测试服务器可以验证两家 provider 的请求选择、鉴权头、响应解码和文件输出，而不产生真实供应商调用。
5. 现有 `pnpm contract:lint`、`pnpm platform:test` 和新增的生图配置测试通过。
6. `assets/generated/source/` 的生成结果可被后续 manifest 流程引用，且保留候选审核状态。

## 7. 后续扩展

当 Grok 端点的实际请求/响应格式明确后，新增独立 provider adapter 或配置模式，不改变调用命令和项目资源路径。生产环境接入时，再将本地文件配置迁移到 AI Gateway 的 secret provider、预算、审计、熔断和 kill switch 体系。
