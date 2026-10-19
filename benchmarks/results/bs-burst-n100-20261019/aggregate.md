# bs-burst-n100-20261019

Workload: `arrival=burst;intents=100;owners=10;agents=1-per-owner;recipients=1-per-owner;amount=1e18;warmup=1-per-owner;blockTime=1s;initial=fresh-anvil-deterministic-accounts;assignment=round-robin`  
Commit: `ce13b8b`  
Chain reconciliation: all runs passed

Mean ± sample standard deviation across repetitions. Window: workload drain (first durable receipt → last terminal state). Latency is successful intents only. Gas includes every execution receipt, reverted ones too, and excludes setup and warm-up.

| Batch size | Max wait (ms) | Runs | Throughput (intents/s) | E2E p50 (ms) | E2E p95 (ms) | Gas / successful intent | Gas vs baseline | Transactions | Failure rate | Unfinished |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 0 | 3 | 1.004 ± 0.000 | 49605 ± 57 | 94496 ± 176 | 103408.6 ± 6.7 | 0.0% | 100.0 ± 0.0 | 0.000 ± 0.000 | 0 |
| 5 | 0 | 3 | 5.072 ± 0.062 | 9647 ± 208 | 18530 ± 236 | 81147.1 ± 507.1 | -21.5% | 20.0 ± 0.0 | 0.000 ± 0.000 | 0 |
| 10 | 0 | 3 | 10.187 ± 0.088 | 4702 ± 87 | 9626 ± 72 | 77541.3 ± 663.5 | -25.0% | 10.0 ± 0.0 | 0.000 ± 0.000 | 0 |
| 20 | 0 | 3 | 21.032 ± 0.064 | 2638 ± 10 | 4589 ± 15 | 60906.3 ± 0.7 | -41.1% | 5.0 ± 0.0 | 0.000 ± 0.000 | 0 |
