import { useSearchParams } from "react-router-dom";
import styles from "./SubsystemKafkaAccessPage.module.css";
import { CopyButton } from "./CopyButton";
import { SubsystemKafkaAclHelp } from "./SubsystemKafkaAclHelp";
import { t } from "../i18n";

const KAFKA_SECRET_LAYOUT = `# Kafka 侧**不需要写端点 / 协议**：agentd 从 /proc 认出本机的 Kafka 进程与
# 监听端口（容器 / K8s 里同样认），再按这两个固定路径取凭据。
# 用户名固定 wist-probe，不读配置里的 username。

/etc/wist-agentd/secrets/kafka/probe     # SASL 密码（broker 是 SASL_* 协议时才需要）
/etc/wist-agentd/secrets/kafka/ca.pem    # 可选：私有 CA（存在才用，否则用系统根证书）`;

const KAFKA_TUNING = `[kafka]
# 端点 / 协议 / SASL 机制都由自探决定，这一段只用来调采集节奏（都可省略）
interval_ms          = 30000    # 拓扑与容量；metadata 一次拿全集群，很便宜
lag_interval_ms      = 60000    # 消费组积压；成本主项，单独节奏
max_groups           = 200      # 单轮最多查多少个组（超出按组名稳定截断）
lag_threshold        = 1000     # 白名单为空时，只发总 lag 超过该值的组
# lag_group_allowlist = ["orders-prod", "payments-prod"]   # 非空时忽略阈值`;

const DB_SECRET_LAYOUT = `# 宿主机上的库：按**端口**分目录（一台机器一个 5432 / 3306）
/etc/wist-agentd/secrets/postgres/port-5432/password
/etc/wist-agentd/secrets/mysql/port-3306/password
/etc/wist-agentd/secrets/doris/port-9030/password

# 容器里的库：按**容器名**分目录（同一个节点上多个 3306 只有名字分得开）
/etc/wist-agentd/secrets/mysql/container-mysql-1/password

# 可选：实例要求校验服务端证书时再放这一份
/etc/wist-agentd/secrets/mysql/port-3306/ca.pem

# K8s：pod-<namespace>-<pod>；既不是宿主也不是容器则回落 addr-<ip>-<port>`;

const PG_SQL = `CREATE ROLE "wist-probe" LOGIN PASSWORD '<password>';
GRANT CONNECT ON DATABASE postgres TO "wist-probe";
-- 读其他会话的 pg_stat_activity（自己的会话不需要这条）
GRANT pg_read_all_stats TO "wist-probe";`;

const MYSQL_SQL = `CREATE USER 'wist-probe'@'%' IDENTIFIED BY '<password>';
-- PROCESS: SHOW GLOBAL STATUS / VARIABLES；REPLICATION CLIENT: SHOW REPLICA STATUS
GRANT PROCESS, REPLICATION CLIENT ON *.* TO 'wist-probe'@'%';`;

const DORIS_SQL = `CREATE USER 'wist-probe'@'%' IDENTIFIED BY '<password>';
-- 探针只执行 SHOW BACKENDS，不需要写入权限。
-- Doris 4.x（4.1 实测）：默认账号权限即可，**不需要额外 GRANT**。
-- 2.x / 3.x 若报权限不足，再按版本补实例级特权：
-- GRANT ADMIN_PRIV ON *.* TO 'wist-probe'@'%';`;

/**
 * 「采集指南」页：按采集面列出两侧各自要做的动作。
 *
 * 为什么单独一页：这是**跨两个权限域**的事（agentd 配置 / 目标系统授权），
 * 塞在任何一方的页面底部都会被那一页的读者当成附录跳过。
 *
 * 分组按**采集面**（Kafka / 数据库 …），而不是按产品：同一个面下的产品共享一套
 * agentd 侧动作，只有"目标系统侧授权"这一步按产品不同。
 */
export function SubsystemKafkaAccessPage() {
  // tab 落在 URL 上（`?face=database`）：可直接分享 / 收藏到某个面，刷新不跳回去。
  const [searchParams, setSearchParams] = useSearchParams();
  const face: "kafka" | "database" =
    searchParams.get("face") === "database" ? "database" : "kafka";
  function selectFace(next: "kafka" | "database") {
    const params = new URLSearchParams(searchParams);
    // 默认视图不写进 URL：`/collection-guide` 就是 Kafka，链接保持短。
    if (next === "database") params.set("face", "database");
    else params.delete("face");
    setSearchParams(params, { replace: true });
  }

  return (
    <div className={styles.container}>
      <header className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>
          {t("采集指南", "Collection guide")}
        </h1>
        <p className={styles.pageSummary}>
          {t(
            "每一类采集面都要两拨人配合：agentd 侧把只读凭据放到它读得到的位置，目标系统侧把那个身份授权成只读。指标由 agentd 的协议探针直接采集，不依赖 Prometheus、也不要求部署 exporter。",
            "Every collection family needs two teams: the agentd side drops a read-only credential where the agent can read it, and the target system grants that identity read-only access. Metrics are collected by the agentd protocol probe directly — no Prometheus, no exporter.",
          )}
        </p>
      </header>

      <main className={styles.main}>
        <div
          className={styles.tabs}
          role="tablist"
          aria-label={t("采集面", "Collection faces")}
        >
          <button
            type="button"
            role="tab"
            aria-selected={face === "kafka"}
            className={`${styles.tab} ${face === "kafka" ? styles.tabActive : ""}`}
            onClick={() => selectFace("kafka")}
          >
            {t("Kafka", "Kafka")}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={face === "database"}
            className={`${styles.tab} ${face === "database" ? styles.tabActive : ""}`}
            onClick={() => selectFace("database")}
          >
            {t("数据库", "Databases")}
            <span className={styles.tabHint}>
              {t("尚未开放", "not yet enabled")}
            </span>
          </button>
        </div>

        {face === "kafka" ? (
          <>
          <section className={styles.card} aria-labelledby="kafka-credential">
            <div className={styles.cardHead}>
              <h3 className={styles.cardTitle} id="kafka-credential">
                {t(
                  "1. agentd 侧：投放凭据",
                  "1. agentd side: drop the credential",
                )}
              </h3>
              <CopyButton
                text={KAFKA_SECRET_LAYOUT}
                label={t("复制", "Copy")}
              />
            </div>
            <p className={styles.cardNote}>
              {t(
                "端点、协议与 SASL 机制都由 agentd 自探（从 /proc 认出本机 Kafka 进程与监听端口），不需要在配置里写 bootstrap_servers / security_protocol —— 写了也不会生效。用户名固定 wist-probe，密码只放文件、不进配置、不进日志、也不进诊断包。",
                "Endpoint, protocol and SASL mechanism are all discovered by agentd itself (it identifies the local Kafka process and listening port from /proc) — there is nothing to put in bootstrap_servers / security_protocol, and setting them has no effect. The username is fixed to wist-probe; the password lives only in a file — never in the config, logs, or diagnostics.",
              )}
            </p>
            <pre className={styles.code}>
              <code>{KAFKA_SECRET_LAYOUT}</code>
            </pre>
          </section>

          <SubsystemKafkaAclHelp />

          <section className={styles.card} aria-labelledby="kafka-faq">
            <h3 className={styles.cardTitle} id="kafka-faq">
              {t("3. 常见失败怎么判断", "3. Reading the failures")}
            </h3>
            <dl className={styles.faq}>
              <div className={styles.faqRow}>
                <dt>{t("一条指标都没有", "No metrics at all")}</dt>
                <dd>
                  {t(
                    "连接或认证没通过。先确认 agentd 日志里的 event=KafkaProbeEnabled 与首次探测错误；security_protocol 写错（比如 broker 是 SASL_SSL 却配了 PLAINTEXT）就是这个表现。",
                    "Connection or authentication failed. Check event=KafkaProbeEnabled in the agentd log and the first probe error; a wrong security_protocol (e.g. SASL_SSL broker with PLAINTEXT configured) looks exactly like this.",
                  )}
                </dd>
              </div>
              <div className={styles.faqRow}>
                <dt>
                  {t(
                    "有拓扑与容量，但没有 lag",
                    "Topology and capacity, but no lag",
                  )}
                </dt>
                <dd>
                  {t(
                    "缺 group 的两条授权（Read / Describe on group）。这是最容易被误判成「探针没工作」的情况。",
                    "The two group permissions are missing (Read / Describe on group). This is the case most often mistaken for “the probe is not running”.",
                  )}
                </dd>
              </div>
              <div className={styles.faqRow}>
                <dt>
                  {t(
                    "有指标但没有某个 broker",
                    "Metrics, but one broker missing",
                  )}
                </dt>
                <dd>
                  {t(
                    "缺序列就是不可达 —— 探针不会为它补 0。对照 kafka_broker_up 的 instance 列表即可确认是哪一台。",
                    "A missing series means unreachable — the probe never fills in a zero. Compare the kafka_broker_up instance list to see which one.",
                  )}
                </dd>
              </div>
            </dl>
            <section className={styles.card} aria-labelledby="kafka-tuning">
            <div className={styles.cardHead}>
              <h3 className={styles.cardTitle} id="kafka-tuning">
                {t("可选：调采集节奏", "Optional: tuning the cadence")}
              </h3>
              <CopyButton text={KAFKA_TUNING} label={t("复制", "Copy")} />
            </div>
            <p className={styles.cardNote}>
              {t(
                "唯一还生效的 [kafka] 段内容。默认值适合大多数集群；消费组积压是成本主项（每组要 DescribeGroups + OffsetFetch + 每 leader 一次 ListOffsets），所以它有独立节奏。",
                "The only [kafka] settings that still take effect. Defaults suit most clusters; consumer-group lag is the expensive part (DescribeGroups + OffsetFetch + one ListOffsets per leader), so it has its own cadence.",
              )}
            </p>
            <pre className={styles.code}>
              <code>{KAFKA_TUNING}</code>
            </pre>
          </section>

        </section>
          </>
        ) : (
          <>
          <section className={styles.card} aria-labelledby="db-status">
            <h3 className={styles.cardTitle} id="db-status">
              {t("当前状态", "Current state")}
            </h3>
            <p className={styles.cardNote}>
              {t(
                "PostgreSQL / MySQL（含 TiDB）/ Doris 的采集单元目前在知识库里是 draft：网关的派发闸门会挡住，采集授权页也看不到它们。下面两步现在配好不会有坏处，但**不会**开始采集 —— 要等这三个单元在知识库里改成 active。",
                "The PostgreSQL / MySQL (incl. TiDB) / Doris units are still draft in the knowledge base: the gateway's dispatch gate rejects them and they do not appear on the collection-grants page. Doing the two steps below now is harmless, but collection will not start until those units are flipped to active.",
              )}
            </p>
          </section>

          <section className={styles.card} aria-labelledby="db-credentials">
            <div className={styles.cardHead}>
              <h3 className={styles.cardTitle} id="db-credentials">
                {t(
                  "1. agentd 侧：投放只读凭据",
                  "1. agentd side: drop a read-only credential",
                )}
              </h3>
              <CopyButton
                text={DB_SECRET_LAYOUT}
                label={t("复制", "Copy")}
              />
            </div>
            <p className={styles.cardNote}>
              {t(
                "库的地址与端口不需要写进配置：探针从 /proc 认出本机的数据库进程与监听端口（容器 / K8s 里同样认），再按下面的 key 去找凭据。用户名固定 wist-probe，密码只放文件。",
                "No host or port goes into the config: the probe identifies the database process and listening port from /proc (containers and K8s included) and then looks the credential up by the key below. The username is fixed to wist-probe and the password lives only in a file.",
              )}
            </p>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>{t("面", "Family")}</th>
                  <th>{t("来源类型", "Source kind")}</th>
                  <th>{t("凭据目录", "Credential dir")}</th>
                  <th>{t("用户名", "Username")}</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>DatabaseMetrics</td>
                  <td>
                    <code>PostgresInstance</code>
                  </td>
                  <td>
                    <code>/etc/wist-agentd/secrets/postgres/&lt;key&gt;/</code>
                  </td>
                  <td>
                    <code>wist-probe</code>
                  </td>
                </tr>
                <tr>
                  <td>DatabaseMetrics</td>
                  <td>
                    <code>MysqlInstance</code>
                  </td>
                  <td>
                    <code>/etc/wist-agentd/secrets/mysql/&lt;key&gt;/</code>
                  </td>
                  <td>
                    <code>wist-probe</code>
                  </td>
                </tr>
                <tr>
                  <td>DatabaseMetrics</td>
                  <td>
                    <code>DorisCluster</code>
                  </td>
                  <td>
                    <code>/etc/wist-agentd/secrets/doris/&lt;key&gt;/</code>
                  </td>
                  <td>
                    <code>wist-probe</code>
                  </td>
                </tr>
              </tbody>
            </table>
            <pre className={styles.code}>
              <code>{DB_SECRET_LAYOUT}</code>
            </pre>
          </section>

          <section className={styles.card} aria-labelledby="db-grants">
            <h3 className={styles.cardTitle} id="db-grants">
              {t(
                "2. 数据库侧：授权成只读",
                "2. Database side: grant read-only",
              )}
            </h3>
            <p className={styles.cardNote}>
              {t(
                "探针只跑监控查询，不给写入权限。下面的语句只覆盖探针实际用到的视图 / 命令；密码请用投放后的真实值替换 <password>。",
                "The probe only runs monitoring queries and never needs write access. The statements below cover exactly the views and commands the probe uses; replace <password> with the value you dropped in the previous step.",
              )}
            </p>

            <h4 className={styles.cardTitle}>
              {t("PostgreSQL", "PostgreSQL")}
            </h4>
            <p className={styles.cardNote}>
              {t(
                "读 pg_stat_activity 与 pg_stat_database。pg_read_all_stats 是必需的：没有它只能看到自己的会话（PG 16 实测）。",
                "Reads pg_stat_activity and pg_stat_database. pg_read_all_stats is required — without it the probe only sees its own session (verified on PG 16).",
              )}
            </p>
            <pre className={styles.code}>
              <code>{PG_SQL}</code>
            </pre>

            <h4 className={styles.cardTitle}>
              {t("MySQL / TiDB", "MySQL / TiDB")}
            </h4>
            <p className={styles.cardNote}>
              {t(
                "执行 SHOW GLOBAL STATUS / SHOW GLOBAL VARIABLES / SHOW REPLICA STATUS。MySQL 8.0 实测：PROCESS + REPLICATION CLIENT 足够，不需要 SELECT。",
                "Runs SHOW GLOBAL STATUS / SHOW GLOBAL VARIABLES / SHOW REPLICA STATUS. On MySQL 8.0 (verified) PROCESS + REPLICATION CLIENT is enough — no SELECT needed.",
              )}
            </p>
            <pre className={styles.code}>
              <code>{MYSQL_SQL}</code>
            </pre>

            <h4 className={styles.cardTitle}>{t("Doris", "Doris")}</h4>
            <p className={styles.cardNote}>
              {t(
                "只执行 SHOW BACKENDS，不需要任何写入权限。Doris 4.x 实测：建完账号即可用（默认权限能读 information_schema）；2.x / 3.x 若报权限不足，再补 ADMIN_PRIV 或 NODE_PRIV。",
                "Runs SHOW BACKENDS only — no write access. On Doris 4.x (verified) the account works as created (the default information_schema access is enough); on 2.x / 3.x add ADMIN_PRIV or NODE_PRIV if it reports insufficient privileges.",
              )}
            </p>
            <pre className={styles.code}>
              <code>{DORIS_SQL}</code>
            </pre>
          </section>
          </>
        )}
      </main>
    </div>
  );
}
