// 「采集指南」页的**内容数据**。
//
// 为什么单独一个模块：这些字符串是**和代码约定对齐的运维事实**（凭据路径、key 口径、
// SQL 权限、门控条件），一旦和 agentd / 知识库脱节，页面就会教人做错事（例如单元已经
// `active` 了，页面还写着「draft、配了也不会采」）。抽出来是为了让
// `tests/collection-guide-contract.test.ts` 能直接钉住这些事实。

export const KAFKA_SECRET_LAYOUT = `# Kafka 侧**不需要写端点 / 协议**：agentd 从 /proc 认出本机的 Kafka 进程与
# 监听端口（容器 / K8s 里同样认），再按这两个固定路径取凭据。
# 用户名固定 wist-probe，不读配置里的 username。

/etc/wist-agentd/secrets/kafka/probe     # SASL 密码（broker 是 SASL_* 协议时才需要）
/etc/wist-agentd/secrets/kafka/ca.pem    # 可选：私有 CA（存在才用，否则用系统根证书）`;

export const KAFKA_TUNING = `[kafka]
# 端点 / 协议 / SASL 机制都由自探决定，这一段只用来调采集节奏（都可省略）
interval_ms          = 30000    # 拓扑与容量；metadata 一次拿全集群，很便宜
lag_interval_ms      = 60000    # 消费组积压；成本主项，单独节奏
max_groups           = 200      # 单轮最多查多少个组（超出按组名稳定截断）
lag_threshold        = 1000     # 白名单为空时，只发总 lag 超过该值的组
# lag_group_allowlist = ["orders-prod", "payments-prod"]   # 非空时忽略阈值`;

/** 凭据目录名的四种口径（与 agentd `discovery/db_source.rs::credential_key` 一一对应）。 */
export interface DbKeyRule {
  /** 稳定标识（测试与样式用，不上屏）。 */
  id: "host" | "container" | "k8s" | "fallback";
  scopeZh: string;
  scopeEn: string;
  /** 目录名口径（技术串，不翻译）。 */
  key: string;
  example: string;
}

export const DB_KEY_RULES: readonly DbKeyRule[] = [
  {
    id: "host",
    scopeZh: "宿主机进程（原生 / Homebrew 安装）",
    scopeEn: "Host process (native / Homebrew)",
    key: "port-<port>",
    example: "port-5432",
  },
  {
    id: "container",
    scopeZh: "Docker / OrbStack 容器",
    scopeEn: "Docker / OrbStack container",
    key: "container-<容器名>",
    example: "container-pg-probe-test",
  },
  {
    id: "k8s",
    scopeZh: "Kubernetes",
    scopeEn: "Kubernetes",
    key: "pod-<namespace>-<pod>",
    example: "pod-prod-pg-0",
  },
  {
    id: "fallback",
    scopeZh: "其它（判不出归属时）",
    scopeEn: "Anything else (ownership unknown)",
    key: "addr-<ip>-<port>",
    example: "addr-127-0-0-1-55999",
  },
];

export const DB_SECRET_LAYOUT = `# 宿主机上的库：按**端口**分目录（一台机器一个 5432 / 3306）
/etc/wist-agentd/secrets/postgres/port-5432/password
/etc/wist-agentd/secrets/mysql/port-3306/password
/etc/wist-agentd/secrets/doris/port-9030/password

# 容器里的库（Docker / OrbStack / k8s）：按**容器名**分目录
# 同一个节点上多个 3306 只有名字分得开；容器重建换了发布端口也不影响
/etc/wist-agentd/secrets/postgres/container-pg-probe-test/password

# 可选：实例要求校验服务端证书时再放这一份（存在才用）
/etc/wist-agentd/secrets/mysql/port-3306/ca.pem

# 投放示例：密码从密钥库取，别写进 shell 历史
sudo install -d -m 700 /etc/wist-agentd/secrets/postgres/container-pg-probe-test
sudo install -m 600 /dev/stdin \\
  /etc/wist-agentd/secrets/postgres/container-pg-probe-test/password <<<"$PG_PASSWORD"`;

/** 门控：什么条件下这个单元才会被选中（进而在采集授权页可派）。 */
export interface DbGatingRow {
  unit: string;
  platform: "linux" | "macos";
  /** 条件表达式（来自知识库 `catalog.toml` 的 `match`；空 = 无门控）。 */
  condition: string;
  summaryZh: string;
  summaryEn: string;
}

export const DB_GATING_ROWS: readonly DbGatingRow[] = [
  {
    unit: "linux-postgres-metrics",
    platform: "linux",
    condition: "",
    summaryZh: "无门控：随 linux-datastore 包派给数据类机器",
    summaryEn: "No gate: shipped with the linux-datastore pack for data hosts",
  },
  {
    unit: "linux-mysql-metrics",
    platform: "linux",
    condition: "",
    summaryZh: "无门控：随 linux-datastore 包派给数据类机器",
    summaryEn: "No gate: shipped with the linux-datastore pack for data hosts",
  },
  {
    unit: "linux-doris-metrics",
    platform: "linux",
    condition: "",
    summaryZh: "无门控：随 linux-datastore 包派给数据类机器",
    summaryEn: "No gate: shipped with the linux-datastore pack for data hosts",
  },
  {
    unit: "mac-postgres-metrics",
    platform: "macos",
    condition:
      "any:container:postgres|container:pg|port:5432|path_exists:/opt/homebrew/var/postgres…",
    summaryZh: "容器名像 postgres / 5432 在听 / Homebrew 数据目录存在",
    summaryEn: "Container name looks like postgres, 5432 is listening, or a Homebrew data dir exists",
  },
  {
    unit: "mac-mysql-metrics",
    platform: "macos",
    condition:
      "any:container:mysql|container:mariadb|container:tidb|port:3306|path_exists:/opt/homebrew/var/mysql…",
    summaryZh: "容器名像 mysql / 3306 在听 / Homebrew 数据目录存在",
    summaryEn: "Container name looks like mysql, 3306 is listening, or a Homebrew data dir exists",
  },
  {
    unit: "mac-doris-metrics",
    platform: "macos",
    condition: "any:container:doris|port:9030",
    summaryZh: "容器名像 doris / FE 的查询口 9030 在听",
    summaryEn: "Container name looks like doris, or the FE query port 9030 is listening",
  },
];

export const PG_SQL = `CREATE ROLE "wist-probe" LOGIN PASSWORD '<password>';
GRANT CONNECT ON DATABASE postgres TO "wist-probe";
-- 读其他会话的 pg_stat_activity（自己的会话不需要这条）
GRANT pg_read_all_stats TO "wist-probe";`;

export const MYSQL_SQL = `CREATE USER 'wist-probe'@'%' IDENTIFIED BY '<password>';
-- PROCESS: SHOW GLOBAL STATUS / VARIABLES；REPLICATION CLIENT: SHOW REPLICA STATUS
GRANT PROCESS, REPLICATION CLIENT ON *.* TO 'wist-probe'@'%';`;

export const DORIS_SQL = `CREATE USER 'wist-probe'@'%' IDENTIFIED BY '<password>';
-- 探针只执行 SHOW BACKENDS，不需要写入权限。
-- Doris 4.x（4.1 实测）：默认账号权限即可，**不需要额外 GRANT**。
-- 2.x / 3.x 若报权限不足，再按版本补实例级特权：
-- GRANT ADMIN_PRIV ON *.* TO 'wist-probe'@'%';`;

/** 采集结果的五个状态（与契约 `AgentLocalCollection.status` 同一闭集）。 */
export interface CollectionStatusDoc {
  status: string;
  zh: string;
  en: string;
}

export const COLLECTION_STATUS_DOCS: readonly CollectionStatusDoc[] = [
  {
    status: "ok",
    zh: "本轮没观测到失败（不代表这轮有新数据）",
    en: "No failure observed this tick (does not mean new data arrived)",
  },
  {
    status: "degraded",
    zh: "还有内容在采，但部分失败（看明细行）",
    en: "Still collecting, but some targets failed (see the detail line)",
  },
  {
    status: "failed",
    zh: "这个面没有可采内容，或全部失败",
    en: "Nothing collectable for this family, or every target failed",
  },
  {
    status: "unknown",
    zh: "已授权，但还没有可判定的观测（首轮未完成 / 没有目标）",
    en: "Authorized but nothing decidable yet (first round unfinished / no targets)",
  },
  {
    status: "paused",
    zh: "不是失败：工作被暂停或数据面待命",
    en: "Not a failure: the work is paused or the data plane is standing by",
  },
];
