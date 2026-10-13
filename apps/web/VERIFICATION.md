# D 实现验证记录

日期：2026-10-13（Asia/Singapore）。D 分支 `codex/d-frontend`；验证基线为组员 PR #4 的 `f0971da373786a6e6a67b95444a114e27d194505`（`main@7cd09b7` 上的 C SDK 提交）。该 SDK 已随 PR #4 合并到 `main`；D 的 PR #5 面向 `main`，单独提交 D 的改动。

## 深蓝配色与 PR #4 联调（2026-10-13）

- 依用户要求改为深蓝导航 `#142d4b`、深蓝主操作 `#163454`、白色内容区和浅灰背景 `#f3f5f8`。保留系统无衬线字体；状态用小面积语义色，避免色彩干扰内容。
- 浏览器验收四页、新 epoch 的授权、SDK intent 详情和 intent→batch 跳转。移动端 390px 下导航、指标、Run ID 控件可用，document.scrollWidth = innerWidth = 390；默认窗口也没有全页横向溢出。临时视口已恢复。
- PR 本地 `npm run check` 通过：合约 28、relayer 27、SDK 11，共 66 项测试；类型、Solidity 格式及冻结接口检查通过。D 的 9 项测试、TypeScript 和生产构建通过。
- `npm run demo:agent:evm` 使用 PR 的 SDK，无 SDK/relayer/合约修改。真实链脚本两次完成 12 个 intent / 4 笔交易；最终版本额外逐笔读取真实 receipt 并核对全部 `IntentExecuted` digest。owner 从 17 TEST 到 5 TEST，recipient 从 3 TEST 到 15 TEST，epoch 4 的 spent = 12 TEST。
- 最终运行 `runId=d-agent-1791896739442`，三个任务、每个 4 次、间隔 5 秒。API 和页面均显示 12 confirmed、0 unfinished、4 成功 receipt；Performance 明确显示累计观察与完整对比缺失，未把此功能演示作为 E 的受控实验。
- 联调修正仅在 D 脚本：新 journal 前显式建立新授权 epoch，避免旧 nonce 冲突；Anvil 定时出块，SDK 使用其现成时钟接口读取最新链上时间。普通 runner 重启应复用 journal，不能照此演示脚本重置外部授权。
- 删除过时的“agent 尚未接入”提示。SDK journal 与本地进程状态不进入浏览器；前端只显示已有 relayer API 能证明的提交与执行记录。
- 截图：`qa/ui-navy-batches.jpg`、`qa/ui-navy-authorizations.jpg`、`qa/ui-navy-performance.jpg`、`qa/ui-navy-mobile.jpg`。PR 评审见 `PR_REVIEW.md`。

## UI 完善（2026-10-13）

- 用系统无衬线字体与黑白灰界面替换衬线大标题、深绿导航和浅绿卡片。颜色用于操作入口与状态；地址保留等宽字体，数字使用对齐数字。
- 四页标题改为实际功能名称，去除口号、装饰性编号与侧栏宣言。统一按钮、表单、状态、表格与指标摘要的尺寸和间距。
- Run ID 筛选放在页面标题之后；详情页不再显示无效的筛选工具栏。中等宽度优先显示关键列，次要字段仍可在详情查看；金额字号提高。
- 生产构建与 TypeScript 检查通过。浏览器核对四页、真实授权查询、列表到详情跳转，以及 390px、默认窗口和 1280px 断点。
- 390px 下 document.scrollWidth = 390；默认窗口 intent 表格宽度与容器同为 614px；1280px 授权表单与策略两列显示，没有全页横向溢出。临时视口已恢复。
- 本轮只调整表现、文案和信息层级；未改动钱包权限、签名、API、状态与实验计算逻辑。

## 已验证

- Node 22.23.1；前端独立锁文件；React 19、ethers 6.17、Vite 6.4.4。
- `npm test`：9 项通过，覆盖金额精度、uint256/单位边界、授权预算/有效期、钱包拒绝文案、实验来源/对照约束、无成功样本的 N/A。
- `npm run build`：TypeScript 与生产构建通过。
- 原仓库合约编译及 `npm run check:interfaces` 通过，冻结 ABI、bytecode、事件和签名 fixture 未改变。
- `npm run demo:evm`：现有合约演示部署成功；通过真实 HTTP API 提交三个独立 agent 签名，三个 intents 在同一笔交易中确认，receipt 对应三个 exact intentId；更新后的脚本重启也成功。
- `npm run test:wallet`：对真实 Anvil 使用测试进程的 EIP-1193 适配器，验证 decimals/symbol/allowance、approve/configure/revoke、确认回执、错误 owner 与 chain 的拒绝；结束时恢复快照。
- Codex in-app browser：真实 owner policy、余额、allowance；intent 列表/详情/状态历史；intent→batch 跳转、三个成员与一个 txHash；空 runId 结果；显式预览及 FAILED/RECONCILING；服务断开后的 OFFLINE 与旧数据警示。
- 390px 宽视口：授权页、导航、表单和性能表格容器检查；document.scrollWidth = innerWidth = 390，无全页横向溢出。测试后恢复默认视口。
- Performance：完整实验缺失占位、真实归档 gas 图表；JSON 粘贴接入的无效数据拒绝、完整数据展示、零成功样本 N/A。验证用数据带 `QA FIXTURE ONLY — NOT EXPERIMENT EVIDENCE` 标记，未作为实验结果保存或交付。
- 前端依赖安装的审计结果为 0 vulnerabilities；D 未改动 A/B/C 源码、根依赖或归档证据。PR #4 的变更来自组员原提交。

## 验证边界

- 没有操作用户真实浏览器扩展钱包进行人工签名。自动测试验证的是同一钱包适配层与真实本地合约，最终小组录制前仍需使用演示钱包走一次真实扩展 UI。
- 浏览器自动化的文件选择器设置测试文件失败，尚未自动验证 native file picker 的导入流程；文件解析与 JSON 粘贴使用同一个校验入口，粘贴入口已完整验证。两种入口均已实现。
- 已完成使用 C SDK 的有限定时任务真实链功能演示，未完成四类受控性能对比。仅 E 的实测原始证据与摘要仍为完整实验的刚需；不要求 A/B/C 为 D 新增功能。

## AI 辅助与设计记录

本次 D 代码、样式、接入 schema、演示辅助脚本及测试由 Codex 协助生成和检查。关键设计是复用现有 ABI/类型、wallet 与 agent signer 分离、样例显式隔离、未知结果不报成功、累计指标不冒充最终实验、零成功样本不伪造单位成本。自动检查由 Codex 执行；本记录不声称成员 D 已完成人工代码审阅。成员 D 可据上述源码和验证记录准备自己的解释与演示。
