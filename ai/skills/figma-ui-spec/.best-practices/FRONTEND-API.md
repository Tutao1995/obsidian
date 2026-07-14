# 从Swagger文档生成前端API文件

根据Swagger文档URL生成符合项目规范的API文件（含JSDoc注释）。

## 输入参数
- $ARGUMENTS: Swagger文档URL 或 接口JSON信息

## 任务流程

1. **获取接口信息**
   ```bash
   # 获取分组列表
   curl -s "{baseUrl}/swagger-resources"
   # 获取API文档（中文需URL编码）
   curl -s -G "{baseUrl}/v3/api-docs" --data-urlencode "group={groupName}"
   ```

2. **查找项目API请求方式**
   - 查找 `src/api/` 目录下已有的API模块，参考其import和调用方式
   - 有封装（如httpClient）则使用项目封装
   - 无封装则使用 `Fiber.http.post/get`

3. **生成API代码**（含JSDoc注释）

   **有httpClient封装：**
   ```javascript
   import httpClient from '../service';
   const seeyonPath = window._ctxPath || '/seeyon';

   /** @param {Object} data @returns {Promise} */
   const funcName = (data) => httpClient.post(`${seeyonPath}/path`, data);
   export default { funcName };
   ```

   **无封装用Fiber.http：**
   ```javascript
   import * as Fiber from 'fiber';
   const seeyonPath = window._ctxPath || '/seeyon';

   const funcName = (data) => Fiber.http.post({ url: `${seeyonPath}/path`, data });
   export default { funcName };
   ```

4. **类型映射**：`integer`→`number`, `array`→`Type[]`, 必填`@param {Type} data.field`, 可选`@param {Type} [data.field]`

5. **命名规范**：GET→`get/query`, POST→`create/add/{action}`, PUT→`update`, DELETE→`delete`

6. **输出**：`src/api/modules/{moduleName}.js`
