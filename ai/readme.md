
# 常用plugin
相信大家或多或少都接触过 Superpowers、GSD 和 Gstack 这三个框架。今天想分享一个将三者结合起来、更好辅助开发工作的方法——这也是我在阅读一些文章后获得的启发。最近使用下来，最直观的感受是：**Gstack 的方向决策功能非常好用，个人认为远强于单纯的 brainstorming**。话不多说，接下来就讲讲如何将三者有机结合。

## 核心结论

在整合之前，先明确三者的定位：

- **Gstack 负责决策**
- **GSD 负责稳定上下文**
- **Superpowers 负责执行**

## 三大框架核心信息

### [](https://linux.do/t/topic/1954517#p-16618225-h-1-superpowers-3)1. Superpowers（执行层）

- **核心**：聚焦代码落地执行
- **优势**：闭环开发（需求澄清 → 规划 → TDD → 验收），流程严谨，执行稳定
- **适配场景**：需求明确的开发任务
- **痛点**：小任务下流程略显冗余，前置环节偏重

### [](https://linux.do/t/topic/1954517#p-16618225-h-2-gstack-4)2. Gstack（决策层）

- **核心**：模拟虚拟团队（CEO / 设计师 / 架构师 / QA 等）进行决策评审
- **优势**：需求梳理、多视角评审，产品/架构/安全校验能力强
- **适配场景**：需求模糊、边思考边开发的探索性工作
- **痛点**：全量开启时较臃肿，单技能消耗 token 超过 10K，执行环节相对薄弱

### [](https://linux.do/t/topic/1954517#p-16618225-h-3-gsd-5)3. GSD（上下文层）

- **定位**：上下文工程工具，而非编码框架
- **核心**：固化项目规范、状态与边界，解决长期项目中上下文失效/漂移的问题
- **优势**：跨会话保持项目信息稳定
- **痛点**：无独立代码交付能力，需要搭配执行/决策框架使用

## [](https://linux.do/t/topic/1954517#p-16618225-h-6)整体结合流程

下面分享我近期实际使用的流程：

1. **先用 Gstack 定方向、做决策**
    
    - `/plan-ceo-review`：检查产品方向的合理性
    - `/plan-eng-review`：评审架构与技术方案
2. **再用 GSD 固定上下文，防止漂移**
    
    - `/gsd-new-project`：将 Gstack 确定好的方案“钉住”
    - `/gsd-plan-phase 1`：设计具体方法
3. **然后用 Superpowers 真正写代码、做执行**
    
    - `/writing-plans`：编写计划（我仅使用了 `/gsd-plan-phase`，两者二选一即可）
    - `/executing-plans`：执行计划
4. **最后用 Gstack 收尾**
    
    - `/qa`：进行测试

## [](https://linux.do/t/topic/1954517#p-16618225-one-more-thing-7)One more thing

了解 Harness Engineering 的朋友都知道，无论是 Claude 还是 Codex，在启动时都会加载 skills 里的元信息。而上述三个框架的 skill 数量都非常多——尤其是 GSD。为了保持相对干净的上下文环境，我选择手动关闭（其实就是直接删除掉）其余不需要的 skill。

## [](https://linux.do/t/topic/1954517#p-16618225-h-8)统一补充说明一下

1.如果你只是做一些小修改，这套流程就太重了。  
2.gstack安装没我这些指令的，第一次安装后/gstack会触发第一次安装的流程，如果后续还是没有/plan-ceo-review就手动把对应的skill文件夹放到~/.claude/skills目录下。  
3.这套太耗token了 ![:rofl:](https://cdn.linux.do/images/emoji/twemoji/rofl.png?v=15 ":rofl:")