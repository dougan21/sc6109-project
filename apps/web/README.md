# D — Intent Console

独立的 React + TypeScript 前端。D 应用代码、演示、测试与文档都在 `apps/web/`，根 README 只增加入口；已有合约、relayer、SDK、根依赖和接口不改动。前端编译期复用 B 的类型，运行时直接复用 `interfaces/` ABI 和 `evidence/gas.csv`，避免维护第二份协议。

本实现基于组员的 [PR #4](https://github.com/dougan21/sc6109-project/pull/4)（`f0971da`）接入 C 的定时转账 SDK。该依赖已合并到 `main`，D 的 [PR #5](https://github.com/dougan21/sc6109-project/pull/5) 单独提交前端、演示与验证文档。评审与验证结论见 [PR_REVIEW.md](PR_REVIEW.md)。

## 启动

仓库根目录使用 `.nvmrc` 的 Node 22.23.1。以下命令均在该独立仓库执行。

```sh
# 仓库根目录；首次安装
nvm install
nvm use
npm ci
npm run build

# 前端目录；首次安装
cd apps/web
npm ci
```

推荐的定时 agent + 真实 EVM 演示（两个终端）：

```sh
# 终端 1，apps/web
npm run demo:agent:evm

# 终端 2，apps/web
npm run dev
```

打开 http://127.0.0.1:5173 。演示脚本启动自己拥有的 Anvil（8545）和 EVM relayer（3000），调用原有部署脚本，再使用 C 的 `ScheduledTransferAgent`、链上 policy source 和 HTTP client 注册三个定时任务：每个任务每 5 秒转账 1 TEST，共 4 次。12 个 intent 通过现有 API 进入批处理；本次验证为 4 笔真实链交易。脚本对账 SDK/API 的 intentId、真实 receipt 事件、owner/recipient 余额和授权 spent。控制台给出 owner、agent 和 runId。授权页输入 owner；其他页可用该 runId 过滤。有限任务结束后服务继续运行，便于查看页面；Ctrl-C 停止脚本拥有的服务。占用端口时直接退出，不会停止已有服务。

演示显式配置新的授权 epoch，再创建新的 SDK journal，避免原合约安全演示已消耗的 nonce 与新 journal 从 0 分配的 nonce 冲突。Anvil 每秒出块，SDK 的 `nowSec` 使用最新链上时间，避免系统时钟领先最新区块而被预检查拒绝。以上只用于脚本新建并拥有的演示链，不会修改外部链上的授权。

这是定时任务功能演示，**不是受控性能实验**。脚本只使用公开 Anvil 开发账户，在 localhost 新链上运行；SDK journal 位于仓库已忽略的 `data/`，浏览器从不接收私钥、journal 或签名列表。钱包交互需在装有 MetaMask 等 EIP-1193 钱包的浏览器打开页面，连接同一 Anvil 开发 owner 和链 31337。原来的 `npm run demo:evm` 保留，供一次性提交三个请求的快速演示使用。

如果 B 的服务已经在运行，直接 `npm run dev`。API 通过 `/api`、只读 RPC 通过 `/rpc` 代理，无需 B 改 CORS。改端口时将 `.env.example` 复制为 `.env.local` 并修改 `RELAYER_PROXY_TARGET` / `RPC_PROXY_TARGET`。`npm run preview` 也提供同样的本地代理。纯静态托管需要自行配置这两条反向代理；本次交付范围是本地演示。

## 四个页面与真实边界

| 页面           | 已实现                                                                                                                                                                    |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authorizations | 不连接钱包也能查询 owner；当前策略与索引区块；RPC 读取 decimals/symbol/balance/allowance；owner 钱包 approve/configure/revoke；网络和账户校验；确认回执后更新；不收集私钥 |
| Intents        | runId 分页查询、当前页状态筛选、详情、完整状态历史、历史 batch 链接、错误和未知结果；可手工提交现成 agent 签名 JSON，不生成 agent 签名                                    |
| Batches        | 列表、详情、成员、同一 txHash、EOA nonce、广播次数、receipt、gas、原子回滚与未知结果说明                                                                                  |
| Performance    | 实时累计指标及分母/样本数/配置；仓库已有真实 gas review；完整实验 JSON 导入和来源校验；未提供数据时显示明确占位                                                           |

默认使用实际 API。服务断开显示错误，保留的旧数据标明可能过时；不会自动换成演示数据。“Preview UI” 是主动开启的独立样例模式，有全局标识并禁用所有钱包写入、签名提交和实验导入。样例只是查看状态、错误和布局，不能作为功能或性能证据。历史 gas review 始终单独标注真实归档来源。

HTTP 202 不是转账成功；SUBMITTED 是网络调用前持久化的广播意图；RECONCILING 是未知结果；FAILED 不撤销签名。同一个 intent 的重试可经历不同 batch，历史不会被最新 batch 覆盖。停止定时任务与链上撤销是两个不同操作。

金额始终以十进制字符串/BigInt 处理。只有查询到当前 token decimals 后才构造钱包金额；列表和详情显式显示 base units。策略 validUntil 和 intent 时间为秒，服务事件时间为毫秒。配置授权会递增 epoch 并重置 spent，界面明确提示。

## Agent 和实验的接入

- **Agent：** 已接入 PR #4 的 SDK，D 提供 `demo:agent:evm` 启动命令。仍使用原有 `POST /intents`，前端轮询自动显示请求、batch 与指标；不增加任务控制 API。页面不宣称可读取 runner 的进程健康、未签名或 `SKIPPED` 等仅存在于 SDK journal 的状态；这些在本地终端查看。签名 JSON 也可通过 Intents 页的折叠表单手工提交，且不存到浏览器存储。
- **实验：** Performance 通过文件或粘贴导入 JSON，契约为 `public/integration/benchmark.schema.json`。导入校验 baseline（batchSize=1、maxWaitMs=0）、batch、EVM 模式、唯一 runId、共同 commit/chain/workload/窗口类型、四类指标、样本数、unfinished 和 rawResults。显示每次测量，不自动挑选最优值或凭空汇总。文件由提供者声明为实测，前端校验结构不能代替原始证据审查。
- `/metrics` 仅作累计观察；吞吐量随查询时间变化，不能直接作为结束后的固定实验结果。Mock gas 必须标明合成。已有 `gas.csv` 仅支持同 owner/token/recipient 的 20 次转账 gas review，不能推断另外三类指标。

## 验证

```sh
# apps/web
npm test
npm run build

# 任一 EVM 演示已完成转账、前端 dev 在运行时
npm run test:wallet
```

单元测试检查大金额精度、单位、uint256 边界、策略限制、钱包拒绝文案和实验接入约束。`test:wallet` 用测试进程中的 EIP-1193 适配器验证真实 Anvil 上的 approve/configure/revoke、owner/chain 守卫、回执和 token 元数据；会用快照恢复这条演示链。适配器不进入产品，不能代替真实扩展钱包的最终人工确认。

浏览器验收应覆盖：四页、intent→batch→intent 跳转、空数据、API 断开、mock 提示、显式样例模式及禁用写入、failed/reconciling 文案、窄屏。真实钱包演示检查拒签、等待、确认、账户/网络切换，以及撤销后的查询更新。

验证详情与尚未人工确认的边界见 [VERIFICATION.md](VERIFICATION.md)。

## 刚需配合事项

目前没有需要 A/B/C 为前端新增的接口或协议修改。C 的 SDK 已能支撑定时任务演示，D 已完成真实链启动脚本，不再要求 C 另外制作 runner 或控制接口。

1. **E：完整四类对比需要真实 baseline/batch 实验结果。** 提供可复现原始证据及按本目录 schema 导出的摘要，具体字段、单位与分母见 [E_EXPERIMENT_HANDOFF.md](E_EXPERIMENT_HANDOFF.md)。不能用 UI 样例或 mock gas 替代。D 已实现导入，不要求新建结果 API。

这仅在交付完整实验时构成刚需；D 页面与定时任务功能演示已可本地运行和验收。没有额外要求 A/B/C 加 WebSocket、控制接口、数据库字段或做页面设计。
