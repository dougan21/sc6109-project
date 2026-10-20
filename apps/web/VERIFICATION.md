# D 实现验证记录

## 精简界面文案与按需帮助（2026-10-20）

- 按成员 D 的反馈，删除四个页面及详情页的用途介绍、重复统计说明和常驻技术脚注。压缩手工签名提交入口与 scheduled agent 卡片；字段、数据和操作保持原有行为。共享 `PageTitle` 不再提供说明段落，防止各页重复添加。
- 新增少量可悬浮、聚焦或点击的帮助提示，使用具名按钮、`aria-describedby` 和 tooltip；支持再次点击、Escape、外部点击、失焦及滚动关闭，浮层位置限制在视口内。长方法、原始来源与完整实验限制放入折叠区。金额单位、样例/实测标识、Local Anvil / baseline 过载范围、有效请求范围、重配置后果及失败/未知结果提示仍可见。
- Node 22.23.1：13 项现有前端测试、TypeScript、生产构建及 `git diff --check` 通过。没有修改签名、钱包交易、API、原始数据或聚合逻辑；未为此次文案/交互调整重跑全仓合约及 E 的归档审查。
- In-app browser 验证：四页及 failed intent 详情；筛选与跳转；手工签名表单在 Preview 下仍禁用；金额 base units 与失败签名未撤销的提示保留。稳态/突发可切换，汇总数值保持一致；来源与限制折叠可展开。帮助按钮点击/再次点击、键盘 Tab 聚焦及描述关联、Escape 和外部点击关闭通过。
- 876px / 1280px 桌面与 390px 手机检查通过，四页在 390px 均为 document.scrollWidth = innerWidth = 390；1280px 的授权双栏及重配置提示正常。390px 帮助浮层边界为 x=74–374、y=438–602，位于 390×844 视口内。临时视口已重置。此轮检查未操作扩展钱包，也未新增实际链上交易。
- 截图：`qa/ui-copy-performance.jpg`、`qa/ui-copy-authorizations.jpg`、`qa/ui-copy-intents.jpg`、`qa/ui-copy-batches.jpg`、`qa/ui-copy-mobile-help.jpg`。设计、代码与自动验收由 Codex 协助完成，供成员 D 审阅。

## 合并与 UI 阅读层级优化（2026-10-20）

- E 的 PR #6 已合并到 `main`（`2ca64d7`），D 的 PR #7 随后合并（`0619528`）；两次合并均保留原提交。UI 改动基于该主分支，仅涉及 `apps/web/`。
- 检查四个页面后，保留授权表单、intent/batch 列表、系统字体及深蓝导航。性能页补充图例、完整 baseline 标签与浅灰参考行；gas 降幅用绿色、增加用红色，并同时显示方向箭头及 less/more，颜色不单独承担含义。零实测失败保留 0/attempted 与有效请求范围说明；浅琥珀色突出解释限制。
- 历史单 owner gas review 默认折叠，入口直接说明独立工作负载与参考用途；展开仍可访问原有图表、五行表格和证据链接。实时累计观察维持独立折叠。没有改动实验原始数据、聚合算法、接口、钱包或签名行为。
- Node 22.23.1：D 的 13 项测试、TypeScript 与生产构建通过，`git diff --check` 通过。此次为表现层修改，沿用前节的 E 归档审查结论，没有将旧全仓测试声称为本轮重跑。
- In-app browser：检查稳态/突发切换与降幅（稳态 20.8% / 23.5% / 23.8%，突发 21.5% / 25% / 41.1%）；历史资料展开/收起及实时观察展开可用，后端离线仍能查看实测。1280px、390px 与恢复后的默认 876px 均无全页横向溢出；390px 的三个图表和限制提示自身无溢出，宽表继续在自身容器滚动。临时视口已重置。
- 截图：`qa/ui-refinement-burst.jpg`（1280px 全页）、`qa/ui-refinement-steady.jpg`（默认桌面全页）、`qa/ui-refinement-mobile.jpg`（390px）。UI 设计、代码与自动验收由 Codex 协助完成，不声称已替代成员 D 的人工审阅。

## E 归档实验审查与页面接入（2026-10-20）

审查对象：E 的 [PR #6](https://github.com/dougan21/sc6109-project/pull/6)，head `25a24101a2477bb435fabaa506b387e0e1ff0200`；实验源码 `ce13b8b86d9feda9edc9c77c903b4c090ed5317f`。D 接入分支：`codex/d-experiment-integration`。结论：**在已审查范围内可接入，并须保留下面的限制**。未发现阻断 D 接入的计算、格式或归档对账问题；E 原始代码与数据未改动。

- `scripts/check-experiments.ts` 独立于 E 的指标函数，逐一核验两个 workload 的 24 次测量、2,400 个 intent 和 834 笔归档 receipt。检查 ID/nonce 唯一性、frozen-domain digest、状态时间顺序、工作负载与控制变量、源码 SHA-256、环境、固定测量窗口、吞吐量、最近秩 p50/p95、失败分母、gas 精确除法、batch 归属、事件 ID、warm-up 排除、owner/recipient 余额和 spent。两个摘要均通过原 D schema。清单及摘要 hash 保存在 `public/integration/experiment-review.json`。
- 归档中全部 24 次实验均为 100 accepted / 100 attempted / 100 confirmed，0 failed、0 unfinished。D 复算值与每次摘要、指标文件及归档回执投影一致。历史节点已停止；这些检查不能独立重新查询历史链或全部 consumed nonce。nonce consumed 的逐次布尔结论来自 E 的归档标记及已审阅 runner，不冒充 D 新做的历史 RPC 查询。
- 另在 Node 22.23.1、本机独立端口进行小规模 EVM 复现：`npm run bench -- --sizes 1,10 --reps 1 --intents 20 --owners 4 --arrival burst --comparison d-review-20261020-01 --out data/d-e-review --rpc-port 18745 --api-port 13245`。两次测量全部确认，独立链上对账通过，摘要导出成功；进程自动退出。输出位于忽略的 `data/`，是未提交工作树上的复现检查，不混入 E 正式实测或页面结果。
- 项目 `npm run check` 通过：28 合约、27 relayer、11 SDK 测试，TypeScript、Solidity 格式、接口冻结检查通过。Node 22 的 `npm run test:bench` 5 项通过；D `npm test` 13 项通过（新增来源 hash/分母、样本 SD、不同等待窗口隔离、零成功 N/A），共 84 项。D 生产构建、独立归档核验通过。
- Performance 默认选择稳态实验，可切换突发实验；图表、逐次列表、配置均值/样本标准差、四类指标和固定 E 提交的原始证据可用。三个量化图表均从 0 开始，工作负载切换保持坐标尺度一致，点对应具体 runId；失败卡片显示实测分子/分母。p50/p95 表格是逐次分位数的均值，不声称 pooled percentile；SD 不标成置信区间。
- 浏览器已验证：两组结果切换；与 aggregate 表一致的均值和 gas 差值；12 次明细与证据目录链接；E 摘要通过 JSON 粘贴导入；无效导入拒绝且保留当前数据；零成功 QA 数据为 N/A；真实归档与 Preview UI 的业务样例隔离；独立折叠实时观察；后端离线仍能查看归档。
- 默认 1280px 与手机 390px 均无全页横向溢出（document.scrollWidth 等于 innerWidth）。390px 下三个图表自身均无溢出，宽表仅在自身容器内滚动。临时视口已恢复。截图：`qa/performance-e-steady.jpg`、`qa/performance-e-burst.jpg`、`qa/performance-e-mobile.jpg`。
- 仍需保留的解释边界：本地 Anvil、单个待确认 relayer 交易、1 秒区块、单确认、全部有效请求；两组 workload 都使 baseline 过载。结果不能证明公链容量、故障容忍或低负载等待窗口效果，也不替代完整计划中的 H3/H4 场景。当前 D 四类比较已收到所需数据，无需再向 E 要求接口或重复导出。

以下为 2026-10-13 的历史验证记录；其中当时的数据缺口已由本节的 E 接入关闭。

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
- 2026-10-13 的 E 数据缺口已于 2026-10-20 关闭；当前两组受控实测已接入，范围与未验证场景见本文件首节。不要求 A/B/C/E 为 D 新增功能。

## AI 辅助与设计记录

本次 D 代码、样式、接入 schema、演示辅助脚本及测试由 Codex 协助生成和检查。关键设计是复用现有 ABI/类型、wallet 与 agent signer 分离、样例显式隔离、未知结果不报成功、累计指标不冒充最终实验、零成功样本不伪造单位成本。自动检查由 Codex 执行；本记录不声称成员 D 已完成人工代码审阅。成员 D 可据上述源码和验证记录准备自己的解释与演示。

2026-10-20 的独立数据核验脚本、图表、归档接入、测试与本节记录同样由 Codex 按成员 D“检查 E 并推进 D”的请求协助完成。图表与交互由 Codex提出并实现；不声称成员 D/B 已亲自审阅全部代码或历史原始记录。
