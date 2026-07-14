# Java 编码最佳实践

编写/审查 Java 代码前阅读此文档。默认 Java 8，无特殊说明按此版本编码。

任何 Java 项目编码都必须强制遵守以下规范，违反将导致代码审查不通过。

## 核心原则

| 原则     | 说明                           |
|--------|------------------------------|
| 最佳实践优先 | 除非用户明确要求，否则总是优先考虑最佳实践而不是最小改动 |
| 风格匹配   | 确保编码风格与现有项目保持高度统一            |
| 可持续性   | 严禁使用权宜之计（Workaround），对技术债零容忍 |

## 通用规范

- **合理使用JDK新特性**: 如JDK8的Stream API、Optional等，提升代码简洁度和可读性
- **禁止嵌套地狱**: 循环中优先使用反向检查 + continue/break的卫语句，降低嵌套层数
- **空判断必须用工具类**: 对象用 `Objects.isNull()`/`Objects.nonNull()`，字符串用 `Strings.isBlank()`，集合用 `CollectionUtils.isEmpty()`，Map用 `MapUtils.isEmpty()`。**禁止 `== null`、`!= null`、`== ""`**
- **禁止过度空判断**: 框架已保证非空的不判（Spring注入的Bean、Controller必传参数）；方法内已确认非空的不重复判；链路上游已校验的下游不再判
- **禁止跨层重复校验**: Controller 已校验的参数，Service/Manager 层**不再重复校验**。`@RequestBody` 的 VO 由 JSON 反序列化保证非空，禁止对其做 `Objects.isNull(vo)` 判断
- **ID 规范**: 系统所有 ID 均为 Long 正负数形式，**禁止** `id < 0`、`id <= 0` 判断
- **数据对象分层**: 各层使用专属数据对象，严禁混用（见下方分层规范）

```java
// ❌ 禁止
if (user == null) { ... }
if (user != null) { ... }
if (id < 0) { return; }

// ✅ 正确
if (Objects.isNull(user)) { ... }
if (Objects.nonNull(user)) { ... }
// ID 直接使用，不做正负判断
```

### 数据对象分层规范

**核心原则**：各层使用专属数据对象，严禁跨层混用。

| 层级 | 后缀 | 包路径格式 | 说明 |
|------|------|-----------|------|
| Controller | `VO` | `模块.vo.XxxVO` | 前端接口入参和出参，面向视图 |
| 数据库 | `PO` | `模块.po.XxxPO` | 持久化对象，与表结构一一对应 |
| Manager 内部 | **无后缀** | `模块.bo.Xxx` | 业务数据流转，通过包路径 `bo` 区分 |

```java
// ── 包结构示例 ──
com.example.workflow.vo.OpenFlowFormVO        // Controller 出参
com.example.workflow.vo.OpenFlowFormQueryVO   // Controller 入参
com.example.workflow.po.WorkflowConfigPO      // 数据库映射
com.example.workflow.bo.WorkflowConfig        // Manager 内部流转（无后缀）

// ❌ 禁止：Controller 层使用非 VO 对象
public ApiResult<WorkflowDTO> openFlowForm(@RequestBody OpenFlowFormQueryDTO dto)

// ✅ 正确：Controller 入参出参均为 VO
public ApiResult<OpenFlowFormVO> openFlowForm(@RequestBody OpenFlowFormQueryVO vo)

// ❌ 禁止：BO 加后缀
com.example.workflow.bo.WorkflowConfigBO

// ✅ 正确：BO 不加后缀，通过包路径区分
com.example.workflow.bo.WorkflowConfig
```

**层间转换规则**：

| 转换方向 | 位置 | 说明 |
|---------|------|------|
| VO → BO | Controller / Manager 入口 | 入参转为业务对象 |
| BO → VO | Controller / Manager 出口 | 业务结果转为视图对象 |
| BO → PO | DAO 层 | 业务对象转为持久化对象 |
| PO → BO | DAO 层 | 查询结果转为业务对象 |

> VO 和 PO **禁止直接互转**，必须经过 BO 中转。

### 禁止跨层重复校验

**核心原则**：校验逻辑只在**一处**做，不跨层重复。

**不需要判空的场景**：

| 场景 | 原因 |
|------|------|
| `@RequestBody` 参数 | JSON 反序列化保证非空，空请求体会直接 400 |
| Spring `@Inject`/`@Autowired` Bean | IoC 容器保证注入成功，否则启动失败 |
| Controller 已校验的字段 | 下游 Service/Manager 不再重复校验同一字段 |
| 方法内已确认非空的变量 | 后续代码不再重复判断 |

```java
// ❌ 典型反面：Controller 和 Manager 重复校验同一个 VO
// --- Controller ---
public ApiResult<OpenFlowFormVO> openFlowForm(@RequestBody OpenFlowFormQueryVO vo) {
    Long templateId = Objects.isNull(vo) ? null : vo.getTemplateId(); // vo 不可能 null
    if (Objects.isNull(vo)) { return ApiResult.fail("入参不合法"); } // 矛盾：上面已取字段
    return ApiResult.ok(manager.openFlowForm(vo));
}
// --- Manager ---
public OpenFlowFormVO openFlowForm(OpenFlowFormQueryVO vo) {
    Long templateId = Objects.isNull(vo) ? null : vo.getTemplateId(); // 又判一遍
    // ...完全重复的校验逻辑
}

// ✅ 正确：Controller 做一次校验，Manager 直接使用
// --- Controller ---
public ApiResult<OpenFlowFormVO> openFlowForm(@RequestBody OpenFlowFormQueryVO vo) {
    // @RequestBody 保证 vo 非空，直接取字段
    if (Objects.isNull(vo.getTemplateId()) && Objects.isNull(vo.getAffairId())) {
        return ApiResult.fail(GlobalApiCode.BAD_REQUEST, "templateId 和 affairId 必须提供其一");
    }
    return ApiResult.ok(manager.openFlowForm(vo));
}
// --- Manager ---
public OpenFlowFormVO openFlowForm(OpenFlowFormQueryVO vo) {
    // Controller 已校验，直接使用
    if (Objects.nonNull(vo.getTemplateId())) {
        return openFlowFormByTemplateId(vo.getTemplateId());
    }
    return openFlowFormByAffairId(vo.getAffairId());
}
```

## 代码风格规则

### 比较运算符

| 场景 | 禁止 | 正确 |
|------|------|------|
| 空值检查 | `obj == null` / `obj != null` | `Objects.isNull(obj)` / `Objects.nonNull(obj)` |
| 对象比较 | `a == b` / `a != b` | `Objects.equals(a, b)` |
| 字符串比较 | `str == "value"` | `Objects.equals(str, "value")` |
| 包装类比较 | `count == 0`（Integer/Long） | `Objects.equals(count, 0)` |
| 集合判空 | `list.size() == 0` / `list.size() != 0` | `list.isEmpty()` / `!list.isEmpty()` / `CollectionUtils.isEmpty()` |

> 基本类型（`int`/`long`/`boolean`/`char`）允许 `==`/`!=`。`import java.util.Objects;` 必须导入。

### Optional 链式简化

≥2 层空判断链 → 用 Optional 替代嵌套 if：

```java
// ❌ 嵌套空判断
if (Objects.nonNull(result) && Objects.nonNull(result.getData())) {
    if (Objects.equals("success", result.getData().getStatus())) {
        return result.getData().getContent();
    }
}
return defaultValue;

// ✅ Optional 链
return Optional.ofNullable(result)
        .map(Result::getData)
        .filter(data -> Objects.equals("success", data.getStatus()))
        .map(Data::getContent)
        .orElse(defaultValue);

// ❌ 三元表达式空判断
pageBean = Objects.isNull(pageBean) ? new PageParamBean(1, MAX_ROW) : pageBean;

// ✅ Optional
pageBean = Optional.ofNullable(pageBean).orElseGet(() -> new PageParamBean(1, MAX_ROW));
```

适用场景：≥2 层空判断链、条件过滤后取值、有默认值的安全取值。简单单层空判断不必强制 Optional。

### Stream API 优先

集合遍历、过滤、转换优先用 Stream + 方法引用：

```java
// ❌ 传统循环
List<String> result = new ArrayList<>();
for (Item item : items) {
    if (Objects.nonNull(item) && item.isActive()) {
        result.add(item.getName());
    }
}

// ✅ Stream + 方法引用
List<String> result = items.stream()
        .filter(Objects::nonNull)
        .filter(Item::isActive)
        .map(Item::getName)
        .collect(Collectors.toList());
```

### 条件表达式简化

| 规则 | 说明 |
|------|------|
| 禁止复合长条件 | 同一 `if` 中 ≥3 个 `&&`/`||` 条件 → 提取为集合判断或语义方法 |
| 禁止重复取值 | 同一对象连续 `.get()` ≥2 次 → 提取局部变量 |
| 禁止冗余判断 | `StringUtils.isNotBlank(value) && value.length() > 0` → `isNotBlank` 已包含长度检查 |
| 优先早返回 | guard clause 替代深层嵌套 |

```java
// ❌ 丑陋：10+ 个 equals 链式判断
if (!e.getKey().equals(VAR_A.getKey())
    && !e.getKey().equals(VAR_B.getKey())
    && !e.getKey().equals(VAR_C.getKey())
    && !e.getKey().equals(VAR_D.getKey())) {
    resultList.add(dto);
}

// ✅ 集合收敛
Set<String> excludedKeys = new HashSet<>(Arrays.asList(
    VAR_A.getKey(), VAR_B.getKey(), VAR_C.getKey(), VAR_D.getKey()
));
if (!excludedKeys.contains(e.getKey())) {
    resultList.add(dto);
}

// ❌ 丑陋：重复取值 + 复合长条件
if (list.size() == 1 && list.get(0) != null && list.get(0).startsWith(PREFIX)) {
    return list.get(0).substring(PREFIX.length());
}

// ✅ guard clause + 提取变量
if (list.size() != 1) {
    return null;
}
String first = list.get(0);
if (Objects.isNull(first) || !first.startsWith(PREFIX)) {
    return null;
}
return first.substring(PREFIX.length());

// ✅ 或用 Optional 链
return Optional.of(list)
        .filter(l -> l.size() == 1)
        .map(l -> l.get(0))
        .filter(s -> s.startsWith(PREFIX))
        .map(s -> s.substring(PREFIX.length()))
        .orElse(null);
```

## 代码注释规范

**目标：通过注释即可理解功能意图，无需逐行阅读实现。**

### 类注释（必须）

每个类必须有 JavaDoc 注释，包含功能描述、作者和日期：

```java
/**
 * 协同流程处理管理器，负责流程节点的路由分发和状态流转。
 *
 * @Author zhangsan
 * @Date 2025-01-15
 */
public class WorkflowProcessManager {
```

### 方法注释（必须）

所有 public/protected 方法必须有 JavaDoc 注释，说明方法用途、参数含义和返回值：

```java
/**
 * 根据表单模板ID查询关联的流程配置列表。
 *
 * @param templateId 表单模板ID
 * @param includeDisabled 是否包含已禁用的配置
 * @return 流程配置列表，无匹配时返回空集合
 */
public List<WorkflowConfig> findByTemplate(Long templateId, boolean includeDisabled) {
```

### 业务逻辑注释（必须）

关键业务逻辑、条件分支、算法步骤必须用行内注释解释 **为什么**（WHY），而非描述代码做了什么（WHAT）：

```java
// 优先从缓存读取，缓存未命中时回源数据库并回填缓存
FormTemplate template = cache.get(templateId);
if (template == null) {
    template = formTemplateDao.findById(templateId);
    cache.put(templateId, template);
}

// 已归档的模板不允许再次发起流程
if (template.isArchived()) {
    throw new BusinessException("模板已归档，不可发起流程");
}
```

### 禁止项

- 禁止无意义注释：`// 获取用户` → `User user = getUser();`（代码已自解释）
- 禁止过时注释：修改代码时**必须同步更新注释**
- 禁止注释掉的代码：已废弃代码直接删除，不要注释保留

## 禁止自写工具方法

**严禁自行编写通用工具方法**（空判断、集合判断、字符串处理、Map取值等）。项目已有成熟的工具类，必须优先使用。

### 常见违规示例

```java
// ❌ 禁止：自己写空判断
if (str == null || str.trim().isEmpty()) { ... }

// ✅ 正确：使用 Strings 工具类
if (Strings.isBlank(str)) { ... }

// ❌ 禁止：自己写集合判空
if (list == null || list.size() == 0) { ... }

// ✅ 正确：使用 CollectionUtils
if (CollectionUtils.isEmpty(list)) { ... }

// ❌ 禁止：自己写 Map 安全取值
Object val = map != null ? map.get("key") : null;
String str = val != null ? val.toString() : "";

// ✅ 正确：使用 MapUtils
String str = MapUtils.getString(map, "key", "");
```

### 编写新方法前必须搜索现有代码

**新增任何工具/辅助方法之前，先搜索当前代码库**，确认无已有实现或标准 API 可替代。

检查顺序：
1. Java 标准库 / Stream API 是否能一行解决
2. 项目已引入的工具类（见下方速查表）
3. 当前代码库中其他模块是否已有同类实现

```java
// ❌ 禁止：自写 String→Long 转换方法
private List<Long> parseAffairIds(String affairIds) {
    Set<Long> result = new LinkedHashSet<>();
    for (String id : affairIds.split(",")) {
        if (Strings.isBlank(id)) continue;
        result.add(Long.valueOf(id.trim()));
    }
    return new ArrayList<>(result);
}

// ✅ 正确：Stream 一行解决，不需要额外方法
List<Long> affairIdList = Arrays.stream(affairIds.split(","))
        .map(String::trim)
        .filter(Strings::isNotBlank)
        .map(Long::valueOf)
        .distinct()
        .collect(Collectors.toList());
```

### 推荐工具类速查

| 场景 | 工具类 | 常用方法 |
|------|--------|---------|
| 字符串空判断 | `Strings` | `isBlank`, `isNotBlank` |
| 字符串处理 | `StringUtils` | `isEmpty`, `isNotEmpty`, `join`, `split`, `trim` |
| 对象空判断 | `Objects` | `isNull`, `nonNull`, `equals`, `requireNonNull` |
| 集合判空 | `CollectionUtils` | `isEmpty`, `isNotEmpty` |
| Map操作 | `MapUtils` | `getString`, `getInteger`, `getLong`, `isEmpty` |
| Bean拷贝 | `BeanUtils` | `copyProperties` |

> 完整的包路径和 Seeyon 项目特定工具类，参见 [BACKEND-JAVA-SEEYON.md](BACKEND-JAVA-SEEYON.md)

## 测试策略

**Java 后端单元测试为必须项。**验证完成后自动执行：

1. 为新增/修改的核心业务逻辑编写单元测试
2. 测试覆盖：正常流程、边界条件、异常情况
3. 运行测试确保全部通过

```
单元测试清单：
- [ ] 核心业务逻辑已覆盖
- [ ] 边界条件已测试
- [ ] 异常情况已处理
- [ ] 变异测试（重要，验证单测有效性）
- [ ] 所有测试通过
```

## 风险评估（Risks）

涉及以下场景时，spec 或 coding 阶段**必须**生成风险评估表：

| 触发条件 | 说明 |
|---------|------|
| 数据库变更 | 表结构修改、字段增删改、索引变更 |
| 外部集成 | 调用第三方 API、MQ 消息、RPC 服务 |
| 权限改动 | 角色权限、数据权限、接口权限 |
| 高并发 | 涉及锁、缓存、队列、批量处理 |

**风险表格式**：

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|---------|
| {风险描述} | 高/中/低 | 高/中/低 | {具体缓解方案} |

简单 CRUD / 配置变更 → 跳过。

## 发布策略（Rollout）

涉及以下场景时，**必须**生成发布策略：

| 触发条件 | 说明 |
|---------|------|
| 数据迁移 | 历史数据转换、字段迁移、数据清洗 |
| 接口变更 | 接口签名变更、返回值结构调整、废弃接口 |
| 灰度发布 | 需要逐步放量的功能 |

**发布策略格式**：

- **发布方式**：{一次性/灰度/分批}
- **回滚条件**：{触发回滚的指标或条件}
- **数据迁移**（如适用）：{迁移步骤，注意兼容性}

纯内部功能 / 开发环境变更 → 跳过。

## 文件变更方案（复杂需求可选）

涉及 3+ 模块或用户要求时，**可选**生成文件级变更方案：

- 按文件组织，标注 `[新增]`/`[修改]`/`[删除]`
- 方法签名完整（返回类型 + 方法名 + 参数），**禁止写实现代码**

| 操作 | 签名 | 说明 |
|------|------|------|
| 新增 | `public ReturnType methodName(ParamType param)` | 方法说明 |
| 修改 | `public ReturnType existingMethod(ParamType param)` | 修改内容 |
| 删除 | `deprecatedMethod()` | 删除原因 |

## 集合操作规范

- 支持容量初始化的集合类预估初始值参数，减少不必要的扩容造成大内存申请
- 推荐使用迭代器进行集合遍历操作

## 项目特定约定

- 如果需要编写 Seeyon 后端代码，必须先阅读：[BACKEND-JAVA-SEEYON.md](BACKEND-JAVA-SEEYON.md)
