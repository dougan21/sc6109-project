# bs-steady10-n100-20261019

Workload: `arrival=steady@10/s;intents=100;owners=10;agents=1-per-owner;recipients=1-per-owner;amount=1e18;warmup=1-per-owner;blockTime=1s;initial=fresh-anvil-deterministic-accounts;assignment=round-robin`  
Commit: `ce13b8b`  
Chain reconciliation: all runs passed

Mean ± sample standard deviation across repetitions. Window: workload drain (first durable receipt → last terminal state). Latency is successful intents only. Gas includes every execution receipt, reverted ones too, and excludes setup and warm-up.

| Batch size | Max wait (ms) | Runs | Throughput (intents/s) | E2E p50 (ms) | E2E p95 (ms) | Gas / successful intent | Gas vs baseline | Transactions | Failure rate | Unfinished |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 0 | 3 | 1.004 ± 0.000 | 44792 ± 26 | 85215 ± 26 | 103412.1 ± 0.3 | 0.0% | 100.0 ± 0.0 | 0.000 ± 0.000 | 0 |
| 5 | 0 | 3 | 4.826 ± 0.032 | 5669 ± 13 | 10121 ± 136 | 81862.4 ± 0.5 | -20.8% | 21.0 ± 0.0 | 0.000 ± 0.000 | 0 |
| 10 | 0 | 3 | 9.232 ± 0.033 | 1261 ± 13 | 1732 ± 30 | 79142.0 ± 0.9 | -23.5% | 11.0 ± 0.0 | 0.000 ± 0.000 | 0 |
| 20 | 0 | 3 | 9.267 ± 0.003 | 1256 ± 0 | 1709 ± 32 | 78809.2 ± 0.8 | -23.8% | 11.0 ± 0.0 | 0.000 ± 0.000 | 0 |
