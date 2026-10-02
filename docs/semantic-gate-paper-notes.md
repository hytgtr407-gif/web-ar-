# Semantic Gate Architecture for Verified Cultural Content Delivery

中文标题：面向文化知识可信传递的语义门控架构。

## Figure caption (English)

Figure X. Architecture of the Semantic Gate mechanism for verified Min Opera knowledge delivery. Following MindAR-based target detection and identity mapping, the prototype retrieves the corresponding scene metadata and evaluates content auditing status (`audited`), version consistency (`version_matched`), and resource availability (`resource_valid`). Text and AR content are released only when all three declared conditions are strictly true and the record matches the recognized identity; otherwise, delivery is blocked and a reason is displayed. The mechanism supports more reliable cultural content delivery by enforcing declared validation states; it does not independently establish cultural authenticity.

## 中文图注

图X 面向文化知识可信传递的语义门控架构。该机制在视觉识别与文化内容展示之间引入验证层。原型依据角色 ID 获取场景元数据，并联合检查审核状态、版本匹配和资源有效性。仅当三个声明状态均严格为真，且记录与识别身份一致时，才展示对应文本和 AR 内容；否则拦截展示并提示原因。该机制通过执行既定校验状态提高文化内容传递的可靠性，不独立证明文化知识的真实性。

## Implementation statement

We implemented a prototype-level Semantic Gate that conditionally controls cultural text and AR content presentation using three declared validation flags and identity consistency checks. The implementation includes pass/block logging and a tracking-loss fallback. Content auditing and maintenance of the validation metadata remain external processes.

本次已实现页面展示前的真实条件分支，读取 `assets/data/scene.json`，并共同控制文化文本与 AR 图层。因此可以描述为“原型级 Semantic Gate 已实现”。不可据此描述为已完成文化事实审核、自动版本检测或所有资源的实时有效性验证。

当前正式数据的三张卡均为 `audited=false`，会被拦截。放行分支验证使用独立测试 fixture，不将正式记录标记为已审核。测试 fixture 的 `audited=true` 只验证条件分支，不代表审核证据。

## Experimental scope

识别层既有实验：30 次桌面模拟视频识别的平均延迟为 **132.52 ms（图中四舍五入为 132.5 ms）**，测量区间为目标首次绘入模拟视频源到真实 `targetFound` 事件。代码版本为 `ab05d29d4431211de608351da84d6b9877a669c5`。该结果不包括资源加载、相机初始化、本次 Semantic Gate 和内容展示，不代表移动端实测或整条链路延迟。

跟踪丢失既有诊断复测：移出与完全遮挡各 15 次，平均丢失延迟为 52.7 ms 和 55.8 ms；中央 50% 宽度遮挡的 15 次在约 3 秒观察窗口内未丢失。30 次丢失后的回退检查通过。首轮另有 6 次移出未触发丢失，复测未重现，原因未确定；两轮数据分别保留。以上也属于旧版本的桌面模拟视频实验，不能当作新门控版本已完成同样规模的性能实验。

本次门控验证包括自动回归测试和真实 MindAR 事件下的浏览器功能检查。原型的门控耗时和识别到内容呈现的端到端耗时尚未单独测量。论文应将架构说明、功能验证与性能实验分开报告。

## Reproduction

架构图为 `semantic-gate-architecture.svg`（矢量）和 `semantic-gate-architecture.mmd`（可编辑流程源）。

自动回归检查：`node --check assets/app.js`、`node --test tests/ar.test.cjs`，18 项测试通过。测试覆盖全部三角色、严格布尔值、正式未审核状态、缺失或不匹配记录、非法说明、JSON 下载失败/超时/格式错误、文本与 AR 图层一致控制、旧目标迟到丢失，以及既有启动与映射行为。

论文最终结果仍需补充真实审核过程、手机实测与门控/端到端性能测量。
