# 《贬官记》MindAR WebAR 阅读原型

保留 A-Frame 1.5.0 + MindAR 1.2.5 架构。GitHub Pages 从 `main` 分支根目录提供 `index.html`，无需构建。

## 真实 targetIndex 映射

目标文件已存在，实际路径为 **`assets/targets/bgji_targets.mind`**，不是 `assets/bgji_targets.mind`。
文件为 MessagePack v2，大小 2,627,284 字节，共 3 个目标。2026-10-02 检查时，从每个 `dataList[index].trackingData[0].data` 提取灰度图，直接读取卡片上的角色名，确认以下顺序：

| targetIndex | 角色 | 日志 target_id | 原始目标尺寸 |
| --- | --- | --- | --- |
| 0 | 边一笑 | BGJ_CHAR_006 | 894 × 1303 |
| 1 | 崔云龙 | BGJ_CHAR_008 | 920 × 1260 |
| 2 | 张岫玉 | BGJ_CHAR_007 | 949 × 1312 |

该文件 SHA-256：`fc97a340f65c580cd3b8b7d9bec7676018b2a3538102e8203cb1c5443959fe50`。
每个目标包含 2 层追踪数据和 11 层匹配数据；本次修复不重新编译目标文件。

`assets/app.js` 使用一份 `CHARACTERS_BY_TARGET_INDEX` 映射处理显示和日志。`targetFound` / `targetLost` 直接读取触发事件的 `mindar-image-target` 组件 `data.targetIndex`，不依赖全局 DOM ID、数组位置或回调偏移。
用户报告的循环错位与当前仓库文件并非完全一致，因此以当前 `.mind` 内图像为准；复测时应检查 Pages 是否已发布最新版本。

调试层默认开启，显示最近一次真实索引、事件、角色 ID、启动阶段和错误；丢失卡片后保留最近索引。
可通过“隐藏调试”按钮或 `?debug=0` 隐藏。实验 CSV 包含 `target_index`，识别与丢失事件使用相同角色 ID。

## 手机端加载

- 先显示页面内容，再按顺序加载 A-Frame 和 MindAR；两个库均固定版本，jsDelivr 下载失败/超时后切换 unpkg。
- 下载脚本最多等待每个地址 15 秒，完成下载后才执行，防止超时的旧请求晚到后重复注册。
- 目标文件使用项目相对路径预加载一次，检查 HTTP 状态与空文件，45 秒超时；通过 Blob URL 交给 MindAR，不再重复下载原文件。
- 两个库注册后才创建 A-Frame 场景。点击“启动相机”后才申请相机权限。
- 相机视频位于页面背景之上，透明 AR 画布位于视频之上，避免负 z-index 被背景遮挡。
- 降低移动端渲染负担，禁用抗锯齿和默认全屏加载层。资源失败、相机失败、初始化错误、60 秒启动超时或 WebGL 中断均显示提示和重试按钮。
- 捕获 MindAR 1.2.5 `_startAR` 的异步初始化错误并处理超时后的迟到相机结果；升级 MindAR 时需要复核此版本适配。
- 切换后台时暂停处理，离开页面时释放相机。通过浏览器返回缓存恢复时重新加载。

旧入口 `index_v3_AR_logging.html` 跳转至同一 `index.html`，保留查询参数，避免旧入口继续使用错位映射。
`assets/data/scene.json` 为已有语义数据，本页面不读取它。

## 验证

需要 Node.js 18+，无需安装依赖：

```sh
node --check assets/app.js
node --test tests/ar.test.cjs
```

回归测试使用模拟的相机/场景事件，覆盖三角色、真实组件索引、日志、Pages 子路径、CDN 回退、下载失败、初始化失败、超时、调试开关和相机启动防重入。
目标文件哈希检查防止重新编译后继续沿用旧映射。若替换 `.mind`，先从内部追踪图像或实体卡片实测重新确认顺序，再更新映射与测试哈希。

手机复测：

1. 等待 GitHub Pages 发布该提交，然后重新加载 HTTPS 页面；iOS 用 Safari、Android 用 Chrome 打开。
2. 点击“启动相机”，允许相机权限，等待“相机已就绪”。
3. 分别扫描边一笑、崔云龙、张岫玉，确认索引为 0、1、2，角色文字与卡面一致。
4. 移开卡片再放回，导出 CSV，确认同一卡片的 `target_found` 和 `target_lost` 的 ID 与索引一致。
5. 在拒绝相机权限、弱网或相机被占用时确认错误提示可见；调整后点击重试。

浏览器界面检查和模拟事件不能代替 iOS/Android 真机识别与相机权限验证。

## AI 辅助视觉说明

论文中建议声明 AI 用于视觉素材生成，不作为文化事实来源。
