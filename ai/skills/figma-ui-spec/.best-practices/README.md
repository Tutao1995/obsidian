# 编码最佳实践

项目特定的编码约定和技术栈规范，供 AI 在编码和审查阶段自动加载。

## 定位

- **通用知识**不需要写在这里 — AI 已经知道
- **只写 AI 不知道的、或实践中总犯错的内容**
- 每个技术栈一个文件，按需加载

## 现有指南

| 文件 | 技术栈 |
|------|--------|
| [BACKEND-JAVA.md](BACKEND-JAVA.md) | Java 后端通用规范 |
| [BACKEND-JAVA-SEEYON.md](BACKEND-JAVA-SEEYON.md) | Java 后端 - 致远 OA 项目特定约定 |
| [FRONTEND-VUE.md](FRONTEND-VUE.md) | Vue 前端通用规范 |
| [FRONTEND-API.md](FRONTEND-API.md) | 前端 API 调用规范 |
| [STACK-CHECK-LIST.md](STACK-CHECK-LIST.md) | 技术栈自动检测规则 |

## 如何使用

技能框架会自动检测技术栈并加载对应文档：

1. `coding` 技能 → 步骤 3 自动加载
2. `reviewing` 技能 → 步骤 4 自动加载

检测规则见 [STACK-CHECK-LIST.md](STACK-CHECK-LIST.md)。

## 添加新技术栈指南

1. 只添加 AI 不知道、或实践时总犯错的内容
2. 描述简洁明了，避免冗长
3. 新建文件，命名为 `{ENDPOINT}-{TECH}.md`
4. 在 `STACK-CHECK-LIST.md` 的技术栈检测表中添加对应条目
5. 填充核心原则、通用规范、常见陷阱、项目特定约定等

### 模板

````markdown
# [技术栈] 编码最佳实践

编写/审查 [技术栈] 代码前阅读此文档

## 核心原则

| 原则 | 说明 |
|------|------|
| 原则1 | 说明 |
| 原则2 | 说明 |

## 通用规范

## 常见陷阱

| 陷阱 | 正确做法 |
|------|---------|
| ❌ 错误做法 | ✓ 正确做法 |

## 项目特定约定

> 根据项目实际情况补充此部分

- [ ] 待补充
````
