---
name: figma-ui-spec
description: >-
  从 Figma 设计稿生成高质量 UI 规格说明书（UI Spec），包含高保真截图、ASCII
  结构图和精确样式数据，质量足够让 AI 完成高保真前端还原。当用户说"从 Figma 生成
  UI Spec"、"Figma 转前端规格"、"提取 Figma 设计稿"、"generate UI spec from
  Figma"时使用此技能。不用于 Axure 原型（用 generating-prd）。
---

<!-- skill-usage-reporting:start -->

> 使用本技能前 best-effort 上报使用情况（失败或未安装 seeyon-skill-tools 均忽略，勿追问用户）：运行 `skill-report usage figma-ui-spec`。

<!-- skill-usage-reporting:end -->

# Figma → UI Spec

从 Figma 设计稿生成人类可读、AI 可还原的 UI 规格说明书。

## Prerequisites

- Node.js ≥18（运行样式提取脚本 `scripts/figma-extract.js`，无第三方依赖，需要全局 `fetch`）
- Figma Personal Access Token（用户提供或从环境变量 `FIGMA_TOKEN` 读取）
- Figma 文件 URL（包含 file key 和可选的 node-id）
- **不依赖 MCP 工具**，全部通过 Figma REST API + 截图分析完成

## 脚本路径规则

执行脚本前先把 `${SKILL_DIR}` 解析为本 `SKILL.md` 所在目录的绝对路径：Claude Code 优先用 `${CLAUDE_SKILL_DIR}`，其他 CLI 用 skill 激活信息里的目录；如果没有显示，先定位当前 `SKILL.md`。命令里不得保留字面量 `${SKILL_DIR}`，也不得用相对脚本路径。运行前确认 `${SKILL_DIR}/scripts/figma-extract.js` 存在；不存在就停止并提醒用户 skill 安装布局不一致。

## Workflow

```
UI Spec Generation Progress:
- [ ] 获取 Figma URL 和 Token
- [ ] 全景图发现：导出页面全景 + 坐标清单，AI 识别所有业务区域
- [ ] 精准导出：根据 AI 识别结果，语义化命名导出每个状态的高清截图
- [ ] 提取精确样式数据（颜色/字体/布局/阴影/渐变/模糊/边框/圆角/尺寸）
- [ ] AI 综合生成 UI Spec（截图 + ASCII图 + 精确样式）
- [ ] 输出文件
```

## Step 1: Get Figma Source

从用户获取：

| 参数 | 必需 | 示例 |
|------|------|------|
| Figma URL | ✅ | `https://www.figma.com/design/{fileKey}/{name}?node-id={nodeId}` |
| Token | ✅ | `figd_xxx...`（Personal Access Token） |
| 输出目录 | 可选 | 默认当前目录下 `figma-export/` |
| 项目名称 | 可选 | 用于 UI Spec 标题，未提供则从 Figma 文件名推断 |

**从 URL 解析：**
- File Key: URL 路径中 `/design/{fileKey}/` 部分
- Node ID: URL 参数 `node-id` 值，格式 `XXXXX-YYYY`（需转换为 `XXXXX:YYYY` 用于 API）

## Step 2: Panoramic Discovery（全景图发现）

通过「全景图 + 坐标 JSON」双通道，让 AI 看到页面全貌后识别所有业务区域，避免仅靠节点名称猜测导致遗漏边界场景。

### 2.1 获取页面坐标清单

```
GET https://api.figma.com/v1/files/{fileKey}/nodes?ids={pageNodeId}&depth=1
Headers: X-Figma-Token: {token}
```

从响应中提取所有顶层子节点的 `name`、`id`、`type`、`absoluteBoundingBox`（坐标+尺寸），生成结构化清单备用。

### 2.2 导出页面全景图

```
GET https://api.figma.com/v1/images/{fileKey}?ids={pageNodeId}&scale=1&format=png
Headers: X-Figma-Token: {token}
```

- 传入**页面（CANVAS）节点 ID**，Figma 会渲染该页面上所有可见内容为一张全景图
- 全景图自动裁剪到刚好包裹所有 Frame 的包围盒
- **scale=1** 为默认值；若页面极大（估算超过 3200 万像素），降为 `scale=0.5`
- 下载保存为 `panorama.png`

> ⚠️ Figma 单张导出上限 3200 万像素。大多数设计页面在 scale=1 时不会超限。
> 如果 API 返回 null 或超时，自动降级 scale=0.5 重试。

### 2.3 AI 全景识别

用 `look_at` 分析全景图，要求 AI 输出：

1. **业务区域清单**：识别所有独立的 UI 状态/弹窗/页面，包括边界场景（空态、无可编辑字段、错误态、禁用态等）
2. **语义命名**：为每个区域给出语义名称（如 `主弹窗-默认态`、`无可编辑字段`、`部分失败`、`配置-空态`）
3. **分组建议**：哪些区域属于同一业务流的不同状态变体

> 💡 全景图的核心优势：AI 看到设计稿全貌，不会因节点命名不规范（如 `Frame 2043683510`）而遗漏边界场景。
> 即使设计师没有给 frame 起有意义的名字，AI 也能从视觉内容识别出「这是一个无可编辑字段的空态」。

### 2.4 匹配节点 ID

将 AI 识别的业务区域与 2.1 的坐标清单匹配：
- 根据全景图中区域的相对位置 + 坐标清单中的 `absoluteBoundingBox` 对应
- 生成最终的**语义名称 → 节点 ID** 映射表
- 展示给用户确认（如遇无法匹配的区域，标注出来让用户指定）

## Step 3: Export Screenshots（精准导出）

根据 Step 2 中 AI 识别 + 用户确认的业务区域映射表，导出每个状态的高清截图。

### 3.1 批量导出

```
GET https://api.figma.com/v1/images/{fileKey}?ids={nodeId1,nodeId2,...}&scale=2&format=png
Headers: X-Figma-Token: {token}
```

- **scale=2**：导出 2x 分辨率，确保清晰度
- **批量导出**：一次 API 调用传入所有 nodeId（逗号分隔），减少请求次数
- 响应中 `images` 字段包含每个节点的临时下载 URL

### 3.2 语义化命名

使用 Step 2.3 中 AI 给出的语义名称命名文件，**不使用序号**：

| AI 识别的语义名称 | 文件名 |
|---|---|
| 主弹窗-默认态 | `main_modal_default.png` |
| 无可编辑字段 | `no_editable_field.png` |
| 部分失败 | `partial_failure.png` |
| 配置-空态 | `config_empty.png` |
| 嵌入态 | `embed.png` |

> ⚠️ Figma 图片导出 API 每次最多约 50 个节点。超过时需分批调用。
> 如果某节点返回空图片 URL（`absoluteRenderBounds` 为 null），记录并跳过，不阻塞整个流程。

## Step 4: Extract Precise Styles

### 4.1 按语义分组选取代表 Frame

不需要对每个 frame 都提取样式——同一弹窗的状态变体共享大部分样式。按**视觉差异显著性**分组，每组只提取 1 个代表 frame：

1. 从 Step 2 的节点清单中，按业务语义分组（如"主弹窗"、"回填结果"、"配置查看"、"嵌入态"）
2. 每组选 1 个**内容最丰富**的 frame 作为代表（通常是尺寸最大或元素最多的）
3. 典型分组示例：

| 分组 | 代表 frame 选取标准 | 覆盖的变体 |
|------|-------------------|-----------|
| 主弹窗（提取/确认） | 默认态，元素最全 | 所有 basic 变体、完成态 |
| 回填结果弹窗 | 部分失败态，信息量最大 | 成功/部分失败/全部失败 |
| 配置查看弹窗 | 完整配置态 | 空态/部分配置/完整配置 |
| 嵌入态/宿主页 | EMBED 页面 | 区块级嵌入场景 |

> ⚠️ 分组数量通常 3-6 个，视设计复杂度而定。目标是覆盖所有**视觉风格不同**的弹窗/页面类型，而非每个状态变体。

### 4.2 提取样式

对每个代表 frame，使用增强版提取脚本（核心逻辑来自 [Framelink](https://github.com/GLips/Figma-Context-MCP)，MIT 许可）。

**方式一：API 直调（推荐）**——脚本直接调用 Figma API，无需手动下载 JSON：

```bash
node ${SKILL_DIR}/scripts/figma-extract.js --token={TOKEN} --file={fileKey} --node={nodeId} --out={group_name}_styles.md
```

**方式二：离线 JSON 输入**——兼容旧工作流：

```bash
# 先下载 JSON
GET https://api.figma.com/v1/files/{fileKey}/nodes?ids={nodeId}
# 再提取
node ${SKILL_DIR}/scripts/figma-extract.js <input.json> [output.md]
```

- 无第三方依赖，纯 Node.js ≥18（使用全局 `fetch`）
- 自动检测 JSON 结构中的根节点，无需硬编码 node ID
- 对 `visible: false` 的根节点仍会遍历子节点（Figma 组件常见模式）

**脚本提取内容（CSS-ready 输出）**：

| 样式类型 | 输出格式 | 示例 |
|---------|---------|------|
| 颜色 | `#RRGGBB` / `rgba(r,g,b,a)` | `#0077FF`, `rgba(0,0,0,0.2)` |
| 渐变 | CSS gradient 语法 | `linear-gradient(118deg, rgba(74,234,255,1) 2%, ...)` |
| 字体 | 完整排版属性 | `PingFang SC / 16px / 500 / 24px / 0%` |
| 布局 | **Auto Layout → Flexbox** | `row / justify: space-between / align: center / gap: 24px` |
| 阴影 | CSS box-shadow | `0px 8px 10px -5px rgba(0,0,0,0.08), ...` |
| 模糊 | CSS filter / backdrop-filter | `blur(42px)` |
| 圆角 | CSS border-radius（含独立值） | `20px 20px 0px 0px` |
| 边框 | 颜色 + 宽度 + dash | `#F0F0F0 / 1px` |
| 尺寸 | width × height + sizing 模式 | `800px × 769px / h:fixed v:hug` |
| 内边距/间距 | CSS shorthand | `16px 24px` / `gap: 12px` |

**输出**：每个分组两份文件：
1. `{group_name}_styles.md` — Markdown 样式表，按类型分组（颜色、字体、布局、阴影、渐变、模糊、边框、圆角、尺寸），附使用位置
2. `{group_name}_tree.txt` — **结构化节点树**（Framelink SimplifiedNode 格式），保留完整嵌套关系，采用 CSS 语义翻译

### 4.3 结构化节点树（Framelink 模式）

**问题**：手动精简 Figma REST API JSON 会丢失信息（渐变细节、透明度、嵌套层级）。

**解决方案**：采用 Framelink 的白名单 + 语义翻译策略，不丢失信息，而是翻译为 AI 可直接理解的 CSS 语义格式。

**Framelink 模式的核心原则**：
1. **白名单提取**（非黑名单删除）：只保留有意义的字段，不是删掉字段
2. **CSS 语义翻译**：Figma 内部格式 → CSS 值（`layoutMode` → `flex-direction`，Paint 对象 → `#RRGGBB`/`rgba()`/`linear-gradient()`）
3. **全局样式去重**（globalVars）：相同样式只存一次，节点只保留引用 ID
4. **SVG 折叠**：整棵矢量子树折叠为单个 `IMAGE-SVG` 节点
5. **隐藏节点丢弃**：`visible: false` 的节点跳过

输出格式和示例见 [TEMPLATES.md](TEMPLATES.md)「Framelink 节点树输出示例」。

> 💡 比手动精简 JSON 不失真（保留完整嵌套关系），比原始 JSON 更紧凑（典型 553KB JSON → 15-30KB 文本），且 AI 可直接理解。

> 💡 旧版 `scripts/extract-styles.js` 仍可用（271 行），但缺少布局和 CSS-ready 输出。推荐使用 `figma-extract.js`。

## Step 5: Generate UI Spec

综合截图分析（`look_at` 工具）和精确样式数据，生成 UI Spec 文档。

### 5.1 布局描述生成

对每个区域，基于截图视觉分析 + Figma JSON 节点树的 Auto Layout 数据，生成**精细布局描述**。

布局描述不是笼统的"左右布局"，而是逐子区域精确描述对齐、间距、列结构等，让 AI 能据此精确还原。

**布局描述要求**：

1. **按视觉子区域逐个描述**：头部、内容区、卡片、表格、底部等，每个子区域单独一段
2. **精确到对齐方式**：水平/垂直对齐、居中/左对齐/右对齐、baseline 对齐等
3. **精确到列结构**：几列、列宽比例、gutter 间距、跨列规则
4. **精确到嵌套关系**：父容器约束（撑满/fixed/hug）、子元素排列方向（row/column）
5. **边界情况说明**：单字段行留空规则、长文本截断行为、滚动区域范围

示例见 [TEMPLATES.md](TEMPLATES.md)「布局描述示例」。

### 5.2 完整 HTML 示例文件

在生成 UI Spec 之前，**先为每个分组生成一个完整 HTML 示例文件**，用于验证还原效果。

**为什么需要完整 HTML**：
- Markdown 中的代码片段是拆开的局部视图，无法验证整体还原效果
- 完整 HTML 文件可在浏览器打开，直接对比 Figma 原图确认视觉一致性
- UI Spec 中的各区域代码片段从完整 HTML 中提取，保证片段和整体一致

**生成流程**：
1. 读取 Step 4 的样式表（`{group}_styles.md`）获取精确样式值
2. 读取 Step 4 的节点树（`{group}_tree.txt`）获取完整嵌套结构
3. 用 `look_at` 分析截图理解视觉布局
4. AI 综合三者生成**单个完整 HTML 文件**，精确还原该分组的所有区域

**完整 HTML 文件要求**：
- 单文件 HTML + `<style>` 内联 CSS，无外部依赖
- 使用 Flexbox/Grid 还原 Figma 的 Auto Layout 布局
- 颜色、字号、间距全部使用从 `{group}_styles.md` 提取的精确值
- 文字内容使用截图中的真实文案
- 每个区域用 HTML 注释标记区域边界：`<!-- 区域: 标题栏 -->`、`<!-- 区域: 主表分组 -->`
- 文件名：`{group_name}_preview.html`

**验证**：
- 用户在浏览器打开 `{group_name}_preview.html` 对比 Figma 原图
- 确认布局、颜色、间距、字体无偏差后，再生成 UI Spec

### 5.3 UI Spec 中的代码片段

UI Spec Markdown 中每个区域的 HTML/CSS 代码片段**从 5.2 的完整 HTML 文件中提取**，而非独立生成。

**提取规则**：
1. 从 `{group_name}_preview.html` 中按区域注释标记提取对应的 HTML + CSS
2. 每个区域的代码片段包含该区域的 `<style>` 和 HTML 结构
3. 代码片段头部注明来源：`<!-- 提取自: {group_name}_preview.html 区域: {区域名} -->`
4. 在 UI Spec 文件头部列出完整 HTML 文件路径（见 [TEMPLATES.md](TEMPLATES.md)「文件清单模板」）

### 文档结构

见 [TEMPLATES.md](TEMPLATES.md)「UI Spec 文档模板」。

### 核心原则

1. **信息按区域集中**：每个区域的截图 + ASCII图 + 布局描述 + 代码片段 + 样式紧密排列，不分散到不同章节
2. **每张截图必配 ASCII 结构图**：用 ASCII 画出布局骨架和组件层次关系
3. **布局描述精确到位**：每个子区域的对齐、间距、列结构、嵌套关系必须精确描述，不能笼统概括
4. **完整 HTML 文件先行**：先生成完整 HTML 预览文件（`{group}_preview.html`），用户浏览器验证通过后再生成 UI Spec
5. **代码片段来自完整文件**：UI Spec 中的代码片段从完整 HTML 提取，不是独立生成，保证一致性
6. **节点树采用 Framelink 模式**：CSS 语义翻译 + 白名单提取，不手动精简 JSON，避免信息失真
7. **精确样式值**：所有颜色、字号、间距、圆角等使用从 Figma JSON 提取的真实值，不用模糊描述
8. **人类可读**：文档给人和 AI 同时阅读，避免纯 JSON dump 或混淆 ID

### ASCII 结构图

示例见 [TEMPLATES.md](TEMPLATES.md)「ASCII 结构图示例」。

## Step 6: Write Output

将所有文件写入输出目录：

| 文件 | 说明 |
|------|------|
| `ui_spec_{项目名}.md` | UI Spec 文档 |
| `{group}_preview.html` | 完整 HTML 预览（浏览器验证还原效果） |
| `{group}_styles.md` | 精确样式基线 |
| `{group}_tree.txt` | 结构化节点树（Framelink 模式） |
| 截图文件 | 高清 PNG 截图 |

- 默认位置：输出目录（用户指定或当前目录下 `figma-export/`）
- 编码：UTF-8

报告完成信息：
- 输出文件路径列表
- 截图数量
- 提取的样式统计（颜色数、字体节点数等）
- HTML 预览文件路径（提醒用户在浏览器打开验证）

## Error Handling

| 错误 | 处理 |
|------|------|
| 全景图超限 / 渲染超时 | 降级 `scale=0.5` 重试；仍失败则回退到逐节点 `depth=2` 清单发现模式 |
| 全景图中区域无法匹配节点 | 展示坐标清单让用户手动指定对应节点 ID |
| Token 无效 / 403 | 请用户检查 Token 权限，需有文件读取权限 |
| File Key 错误 / 404 | 请用户确认 URL 是否正确 |
| Node ID 不存在 | 列出可用的顶层 Frame 让用户选择 |
| 截图 URL 过期 | 重新调用导出 API（URL 有效期约 14 天） |
| JSON 太大（>50MB） | 分节点获取，每次只请求一个 Frame |
| 样式提取不全 | 检查是否有嵌套组件（Component Instance），需展开 `componentProperties` |
| 沙箱或写入权限失败 | 不要原地反复重试；让用户在宿主机处理权限、创建可写输出目录、切换工作区或调整沙箱策略后再重跑 |

## Notes

- **不使用 MCP 工具**——完全通过 Figma REST API v1 + 独立脚本完成
- `figma-extract.js` 的核心转换逻辑来自 [Framelink (Figma-Context-MCP)](https://github.com/GLips/Figma-Context-MCP)，MIT 许可，已简化为零依赖的纯 Node.js 脚本
- 支持两种调用方式：API 直调（`--token --file --node`）和离线 JSON 输入，灵活适配不同环境
- Figma 免费版 Token 有速率限制（约 30 req/min），大文件需注意节奏
- 与 `generating-prd` 的区别：generating-prd 处理 Axure 原型生成 PRD；本 skill 处理 Figma 设计稿生成 UI Spec（侧重视觉还原而非功能描述）
- 全局字体检测：关注 `style.fontFamily` 字段，常见值如 `PingFang SC`、`Inter`、`Roboto`
