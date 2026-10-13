# PR #4：SDK 接入评审

检查日期：2026-10-13。PR：[feat: add the scheduled transfer agent SDK](https://github.com/dougan21/sc6109-project/pull/4)，作者 `incyashraj`，head `f0971da373786a6e6a67b95444a114e27d194505`，base `7cd09b7`。检查时为 open、可合并，无 GitHub 自动检查结果；不能将此视为 CI 通过。

结论：适合继续推进 D 的本地演示。在本次单进程、独立 journal、新授权 epoch、固定本地链的范围内，未发现阻止接入的问题。SDK 评审阶段将该提交快进到本地 `codex/d-frontend` 完成验证；没有合并或改写 C 的分支，也没有代替组员发布 GitHub 评审意见。后续 D 提交按 README 的依赖顺序单独评审与合并。

## 已核对

- SDK 复用冻结 v1 domain、九字段 TransferIntent 与原有 `POST /intents`；relayer 改为导入同一份 `TRANSFER_TYPES`。没有合约、ABI、依赖或锁文件变更。
- `AgentJournal` 在提交 HTTP 前持久化签名与 nonce；重启复用原签名。每个 occurrence 最多签名一次；4xx 为终态，网络错误保留同一签名重试。
- 签名前读取并校验授权、epoch、token、recipient、额度、预算和窗口。待处理签名占用预算；失败签名保守地继续占用预算。
- `summary()` 只返回 scheduleId/index/state/intentId；journal 含签名，仍留在本地私有 data 目录，不交给前端。
- 本地执行 `npm run check` 全部通过：28 合约测试、27 relayer 测试、11 SDK 测试；TypeScript、Solidity 格式、冻结 ABI/bytecode/事件/签名 fixture 检查通过。
- D 新增真实链接入：SDK → 原 HTTP API → relayer → Anvil executor。三个任务，每个每 5 秒执行一次、共四次，12 个 intent 在 4 笔交易中确认，并对账余额、spent、epoch 和 intentId。

## 接入时需要遵守的边界

1. PR 自带 `demo:agent` 仅支持 mock；其测试分别覆盖 SDK→合约与 SDK→mock relayer，不能单凭它们宣称已经完成真实 HTTP→EVM 全链路。D 的 `demo:agent:evm` 补上这条验证路径。
2. 新 journal 从 nonce 0 开始，不能随意用于已消耗 nonce 的同一 owner/agent/epoch。D 在自己创建的链上显式配置新 epoch 后再创建新 journal；普通 runner 重启应复用原 journal，不重新配置授权或丢弃签名记录。
3. 本地 Anvil 默认空闲时不出块，系统时钟可能领先最新区块，导致刚到期的请求被合约预检查以 TooEarly 拒绝。D 使用定时出块和 SDK 现成 `nowSec` 接口对齐链上时间；没有改动 SDK 或 relayer。
4. 同一 journal 由一个进程拥有；配置链/executor 或改变 schedule 时遵守 SDK 的持久化与身份边界。浏览器没有启动/停止 runner 的控制接口，也无法据 relayer 状态判断进程健康。
5. SDK 是确定性定时任务实现。PR 没有 LLM 规划器、生产密钥管理或完整 E 实验结果；页面与演示不声称已经提供这些功能。

本次接入不需要 A/B/C 新增接口。完整性能对比仍需 E 的真实同条件 baseline/batch 原始证据和摘要，按 `public/integration/benchmark.schema.json` 导入。
