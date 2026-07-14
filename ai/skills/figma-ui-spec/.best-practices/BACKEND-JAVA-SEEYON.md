# Seeyon 编码最佳实践

编写/审查 Seeyon 后端代码前阅读此文档。

必须强制遵守以下规范 + [BACKEND-JAVA.md](BACKEND-JAVA.md) 中的编码规范，违反将导致代码审查不通过。

## 通用规范

- 使用 `Lombok` 简化代码（@Slf4j/@Data/@Getter/@Setter...）

## 推荐工具类清单

**Seeyon 项目禁止自写工具方法，以下为项目内已验证的工具类及其完整包路径。**

### 字符串处理

| 工具类 | 包路径 | 说明 |
|--------|--------|------|
| `Strings` | `com.seeyon.ctp.util.Strings` | **首选**。`isBlank`/`isNotBlank` 判空 |
| `StringUtils` | `org.apache.commons.lang3.StringUtils` | `isEmpty`/`join`/`split`/`trim` 等扩展方法 |

> ⚠️ 禁止使用 `org.apache.commons.lang.StringUtils`（旧版 commons-lang，已废弃）
> ⚠️ 禁止使用 `org.apache.logging.log4j.util.Strings`（非业务用途）

### 对象判空

| 工具类 | 包路径 | 说明 |
|--------|--------|------|
| `Objects` | `java.util.Objects` | `isNull`/`nonNull`/`equals`/`requireNonNull` |

### 集合操作

| 工具类 | 包路径 | 说明 |
|--------|--------|------|
| `CollectionUtils` | `org.apache.commons.collections4.CollectionUtils` | `isEmpty`/`isNotEmpty` 集合判空 |
| `MapUtils` | `org.apache.commons.collections4.MapUtils` | `getString`/`getInteger`/`getLong`/`isEmpty` 安全取值 |

> ⚠️ 禁止使用 `org.apache.commons.collections.CollectionUtils/MapUtils`（旧版 collections，已废弃）

### Bean / 数据转换

| 工具类 | 包路径 | 说明 |
|--------|--------|------|
| `BeanUtils` | `org.springframework.beans.BeanUtils` | `copyProperties` 对象属性拷贝 |
| `BeanUtils` | `com.seeyon.ctp.util.BeanUtils` | 平台扩展的 Bean 工具（项目已有则优先） |

### 日期处理

| 工具类 | 包路径 | 说明 |
|--------|--------|------|
| `DateUtils` | `org.apache.commons.lang3.time.DateUtils` | 日期计算/解析/格式化 |

> ⚠️ 禁止使用 `org.apache.commons.lang.time.DateUtils`（旧版 commons-lang）

### 编码 / 加密

| 工具类 | 包路径 | 说明 |
|--------|--------|------|
| `Base64` | `com.seeyon.ctp.util.Base64` | 平台 Base64（首选） |
| `Base64` | `java.util.Base64` | JDK 原生 Base64 |
| `Base64` | `org.apache.commons.codec.binary.Base64` | Apache 实现 |

> ⚠️ 仅允许以上三种 Base64 实现，禁止引入其他 Base64 包

### XML 处理

| 工具类 | 包路径 | 说明 |
|--------|--------|------|
| `XXEUtil` | 平台提供 | XML 解析必须使用此工具防护 XXE 攻击 |

## MCP 接口开发规范

- Controller 方法必须使用 `@McpTools` 注解
- 接口地址必须是 `**/api/comi/mcp/{业务模块}` 或 `**/oapi/comi/mcp/{业务模块}`
- 接口描述使用 `@Operation` 注解
- 接口参数必须使用 `@Schema` 注解类和字段

## API 接口开发规范

### URL 格式

接口地址必须是以下格式之一：

| 格式 | 说明 |
|------|------|
| `api/{模块名称}/xxx` | 后端接口，用户名密码/SSO 登录后使用 |
| `mv/{模块名称}/xxx` | 后端页面跳转，用户名密码/SSO 登录后使用 |
| `oapi/{模块名称}/xxx` | 开放接口，三方互信认证后使用 |
| `api/{ctp/custom/a6/hr}/{模块名称}/xxx` | 后端接口，仅用户名密码登录后使用 |
| `mv/{ctp/custom/a6/hr}/{模块名称}/xxx` | 后端页面跳转，仅用户名密码登录后使用 |
| `oapi/{ctp/custom/a6/hr}/{模块名称}/xxx` | 开放接口，仅三方互信认证后使用 |

URL 路径中只允许小写字母、数字、中横线（如 `/api/login/login-password-algorithm`）。

### 接口规范

- 接口描述使用 `@Operation` 注解
- 接口参数必须使用 `@Schema` 注解类和字段
- 统一返回实体 `ApiResult`，格式：`{"code":200,"message":"success","data":{具体业务数据}}`
- pluginName 必须与 `WEB-INF/cfgHome/plugin` 目录下的插件目录名严格一致
- 需要权限的接口在类或方法上使用 `@CheckRoleAccess` 注解

### 禁止项

- 禁止通过 `@AjaxAccess` 新增前端接口
- 禁止新增 `*.do` 页面跳转接口
- 禁止新增基于 Jersey 的 Rest 接口
- 禁止在新业务场景中使用 OA Rest 用户机制老接口
- 附件相关开发禁止使用 `File` 接口，必须使用 `CtpFile` 接口

## 依赖引入规范

- 不推荐 `commons-lang`，使用 `commons-lang3`
- Base64 编码仅允许上述"编码/加密"章节中列出的三种实现

## 安全规范

### 敏感数据泄露

- 删除 JavaScript 注释中的测试账号、敏感接口地址、access_key 等信息
- 禁止前端代码存放硬编码密钥、Hidden 字段存放账号密码
- 密码类数据必须采用 SHA-256、SM3、MD5+Salt 存储
- 可逆敏感信息（身份证号、银行卡号等）使用 AES-128、SM4 加密存储
- 平台加解密 API 详见 CTP 技术平台 > 加密解密
- 禁止将 SQL 错误信息返回前端
- JSP 页面使用 JSP 注释（不会暴露到前端），JavaScript/HTML 注释需确保不泄露敏感信息
- 严禁 Log 日志输出敏感信息
- 严禁代码写死密钥等敏感信息
- 严禁将信息输出到控制台
- 敏感信息放到 header/body 中，以 HTTPS 发送

### 附件安全

- 附件/压缩包下载必须校验路径参数，防止跨路径访问（`new File(path)` 中 `path` 来自前端时必须校验）

### XML 外部实体防护

- 尽可能使用 JSON 替代 XML
- 所有 XML 解析必须使用 `XXEUtil` 进行防护
- 默认推荐使用 Dom4j 作为 XML 解析器

### SQL 注入防护

- 所有 SQL/HQL 的 Where 条件必须使用 `?` 或 `:param` 占位符，禁止 `"column=" + param` 硬拼接

## 数据访问规范

- DAO 类必须继承 `BaseHibernateDao`
- `JDBCAgent` 优先使用 try-with-resource 或 try-finally 关闭连接
- 不推荐 PO/BO/VO 使用 Lombok 注解（跨 JDK 版本字节码不兼容风险）
- 禁止在 PO 层 get 方法编写影响返回值的逻辑（触发 Hibernate 脏检查）
- 禁止在业务层编写数据库访问代码，必须依赖 DAO 层接口
- 推荐使用支持分页的 API 处理查询
- 分布式缓存推荐使用 `AdvancedCacheMap` 或 `CanalMap`
- 禁止为缓存 KV 键值对设计集合类型值，必须使用 Redis 支持的集合类型（避免大字符串序列化）
