import { useSearchParams } from "react-router-dom";
import styles from "./SubsystemKafkaAccessPage.module.css";
import { CopyButton } from "./CopyButton";
import { SubsystemKafkaAclHelp } from "./SubsystemKafkaAclHelp";
import { t } from "../i18n";
import {
  COLLECTION_STATUS_DOCS,
  DB_GATING_ROWS,
  DB_KEY_RULES,
  DB_SECRET_LAYOUT,
  DORIS_SQL,
  KAFKA_SECRET_LAYOUT,
  KAFKA_TUNING,
  MYSQL_SQL,
  PG_SQL,
} from "./collectionGuideContent";

/**
 * 「采集指南」页：按采集面列出两侧各自要做的动作。
 *
 * 为什么单独一页：这是**跨两个权限域**的事（agentd 配置 / 目标系统授权），
 * 塞在任何一方的页面底部都会被那一页的读者当成附录跳过。
 *
 * 分组按**采集面**（Kafka / 数据库 …），而不是按产品：同一个面下的产品共享一套
 * agentd 侧动作，只有"目标系统侧授权"这一步按产品不同。
 *
 * 数据库那一栏刻意分成「先让它被选中（门控）→ 投凭据 → 授只读 → 验证」四步：
 * 门控是 macOS 特有的坑（开发机大包 + 容器里的库），不写清楚人会在授权页
 * 找不到条目却不知道为什么。字符串与门控表在 `collectionGuideContent.ts`，
 * 由 `tests/collection-guide-contract.test.ts` 钉住与 agentd / 知识库的一致性。
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
          <section className={styles.card} aria-labelledby="db-faces">
            <h3 className={styles.cardTitle} id="db-faces">
              {t("两个面别混", "Two different faces")}
            </h3>
            <p className={styles.cardNote}>
              {t(
                "数据库相关的采集面有两个，授权与凭据都不一样：指标看运行状态（连库跑 SQL），日志采数据库自己的文件（不连库）。同一台机器可以只开其中一个。",
                "Two database-related families exist, with different grants and credentials: metrics read runtime state by connecting to the database; logs collect the database's own files without connecting. A host may have only one of them.",
              )}
            </p>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>{t("面", "Family")}</th>
                  <th>{t("采什么", "What is collected")}</th>
                  <th>{t("怎么判定有东西可采", "How we know there is something")}</th>
                  <th>{t("来源类型", "Source kind")}</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>
                    <code>DatabaseMetrics</code>
                  </td>
                  <td>
                    {t(
                      "连接、事务、死锁、IO、容量、复制…",
                      "Connections, transactions, deadlocks, IO, capacity, replication…",
                    )}
                  </td>
                  <td>
                    {t(
                      "agentd 自探端点（进程 / 监听端口 / 容器发布端口），再协议握手",
                      "agentd self-discovers the endpoint (process / listener / container-published port) and then handshakes the protocol",
                    )}
                  </td>
                  <td>
                    <code>PostgresInstance</code> / <code>MysqlInstance</code> /{" "}
                    <code>DorisCluster</code>
                  </td>
                </tr>
                <tr>
                  <td>
                    <code>DatabaseService</code>
                  </td>
                  <td>
                    {t(
                      "数据库自己的日志（csvlog / slow log / error log）",
                      "The database's own logs (csvlog / slow log / error log)",
                    )}
                  </td>
                  <td>
                    {t(
                      "日志目录存在（path_exists），按白名单 FileGlob 采",
                      "The log directory exists (path_exists); files are collected via an allow-listed FileGlob",
                    )}
                  </td>
                  <td>
                    <code>FileGlob</code>
                  </td>
                </tr>
              </tbody>
            </table>
            <p className={styles.cardNote}>
              {t(
                "指标的 source 只认 auto：工作里写具体地址会被判 unsupported（不把 agentd 变成任意地址的探针）。要采远端库需要显式端点覆盖，属于单独评审的能力。",
                "Metric sources only accept auto: an explicit address in the work spec is rejected as unsupported (agentd must not become a probe for arbitrary addresses). Collecting a remote database needs an explicit endpoint override — a separately reviewed capability.",
              )}
            </p>
          </section>

          <section className={styles.card} aria-labelledby="db-gating">
            <h3 className={styles.cardTitle} id="db-gating">
              {t("1. 先让它被选中（门控）", "1. Get the unit selected (gating)")}
            </h3>
            <p className={styles.cardNote}>
              {t(
                "采集授权页只能看到「这台机器上被选中」的单元。Linux 的指标单元随 linux-datastore 包走；macOS 的 macos-dev 是开发机大包，所以三个 mac 单元各自带门控 —— 没装库的机器不会被派上活。不满足时行会显示「不可授权」并给出具体原因。",
                "The grants page only lists units selected for that host. On Linux the metric units ship with the linux-datastore pack; on macOS macos-dev is a broad developer pack, so each mac unit carries its own gate — machines without a database never receive the work. When the gate is not met the row shows “not grantable” with the concrete reason.",
              )}
            </p>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>{t("单元", "Unit")}</th>
                  <th>{t("平台", "Platform")}</th>
                  <th>{t("被选中的条件", "Selected when")}</th>
                </tr>
              </thead>
              <tbody>
                {DB_GATING_ROWS.map((row) => (
                  <tr key={row.unit}>
                    <td>
                      <code>{row.unit}</code>
                    </td>
                    <td>{row.platform}</td>
                    <td>
                      {t(row.summaryZh, row.summaryEn)}
                      {row.condition ? (
                        <>
                          {" "}
                          <code>{row.condition}</code>
                        </>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className={styles.cardNote}>
              {t(
                "门控条件用的是「事实」：容器名（Docker / OrbStack 里的库）、监听端口、已探测的路径。都不满足时在采集授权页点「检查当前筛选」会顺带取预检，「预检」按钮可让机器自己再探一次。",
                "Gates are evaluated from facts: container names (databases in Docker / OrbStack), listening ports, and probed paths. When none match, “Check current filter” on the grants page also fetches the preflight, and the “Preflight” button lets the host probe itself again.",
              )}
            </p>
          </section>

          <section className={styles.card} aria-labelledby="db-credentials">
            <div className={styles.cardHead}>
              <h3 className={styles.cardTitle} id="db-credentials">
                {t(
                  "2. agentd 侧：投放只读凭据",
                  "2. agentd side: drop a read-only credential",
                )}
              </h3>
              <CopyButton
                text={DB_SECRET_LAYOUT}
                label={t("复制", "Copy")}
              />
            </div>
            <p className={styles.cardNote}>
              {t(
                "库的地址与端口不需要写进配置：Linux 读 /proc（容器 netns 也看得到），macOS 读 libproc + Docker API（取容器发布到宿主的端口），两边都是握手确认后才算发现。凭据按**实例范围**分目录，用户名固定 wist-probe，密码只放文件。",
                "No host or port goes into the config: Linux reads /proc (container netns included), macOS uses libproc plus the Docker API (published host ports), and discovery only counts after a protocol handshake. Credentials are filed by instance scope; the username is fixed to wist-probe and the password lives only in a file.",
              )}
            </p>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>{t("实例在哪", "Where the instance lives")}</th>
                  <th>{t("凭据目录名", "Credential dir name")}</th>
                  <th>{t("例子", "Example")}</th>
                </tr>
              </thead>
              <tbody>
                {DB_KEY_RULES.map((rule) => (
                  <tr key={rule.id}>
                    <td>{t(rule.scopeZh, rule.scopeEn)}</td>
                    <td>
                      <code>{rule.key}</code>
                    </td>
                    <td>
                      <code>{rule.example}</code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <pre className={styles.code}>
              <code>{DB_SECRET_LAYOUT}</code>
            </pre>
          </section>

          <section className={styles.card} aria-labelledby="db-grants">
            <h3 className={styles.cardTitle} id="db-grants">
              {t(
                "3. 数据库侧：授权成只读",
                "3. Database side: grant read-only",
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

          <section className={styles.card} aria-labelledby="db-verify">
            <h3 className={styles.cardTitle} id="db-verify">
              {t("4. 验证：从「能不能采」到「真的采到了」", "4. Verify: from “can it collect” to “it did collect”")}
            </h3>
            <p className={styles.cardNote}>
              {t(
                "第一步看预检（能不能派），第二步看采集结果（派下去到底成不成）。两边不一致时，以采集结果为准 —— 那才是真采到了没有。",
                "First the preflight (can it be dispatched), then the collection result (did the dispatched work actually collect). When they disagree, trust the collection result — that is what actually happened.",
              )}
            </p>
            <p className={styles.cardNote}>
              {t(
                "本机手工验（不经过网关，不需要授权）：agentd probe pg --list 看自探能看到哪些候选；agentd probe pg --addr 127.0.0.1:<port> --password-file <path> 直接验一次采集。",
                "Manual check on the host (no gateway, no grant needed): agentd probe pg --list shows what self-discovery sees; agentd probe pg --addr 127.0.0.1:<port> --password-file <path> collects once.",
              )}
            </p>
            <p className={styles.cardNote}>
              {t(
                "走完授权后，到「Agent 工作」页看该面板的「采集结果」徽标；摘要区会单独统计「采集异常」（failed / degraded），与「漂移」（没拉到授权）分开计。",
                "After granting, open the Agent work page and check the “Collection result” badge on that family; the summary counts “collection problems” (failed / degraded) separately from “drift” (authorization not pulled).",
              )}
            </p>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>{t("状态", "Status")}</th>
                  <th>{t("含义", "Meaning")}</th>
                </tr>
              </thead>
              <tbody>
                {COLLECTION_STATUS_DOCS.map((doc) => (
                  <tr key={doc.status}>
                    <td>
                      <code>{doc.status}</code>
                    </td>
                    <td>{t(doc.zh, doc.en)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className={styles.card} aria-labelledby="db-faq">
            <h3 className={styles.cardTitle} id="db-faq">
              {t("常见问题", "Common issues")}
            </h3>
            <dl className={styles.faq}>
              <div className={styles.faqRow}>
                <dt>
                  {t(
                    "采集授权页看不到 DatabaseMetrics / 显示不可授权",
                    "DatabaseMetrics is missing or not grantable on the grants page",
                  )}
                </dt>
                <dd>
                  {t(
                    "门控不满足（见第 1 步）。行上的原因会写具体条件（container: / port: / path_exists:）；点「预检」让机器自己再探一次。没有库的机器本来就不该派这个面。",
                    "The gate is not met (see step 1). The row states the exact condition (container: / port: / path_exists:); click “Preflight” to let the host probe again. A host without a database should not be granted this family at all.",
                  )}
                </dd>
              </div>
              <div className={styles.faqRow}>
                <dt>
                  {t(
                    "Docker / OrbStack 里有库，但没被发现",
                    "The database runs in Docker / OrbStack but is not discovered",
                  )}
                </dt>
                <dd>
                  {t(
                    "三个常见原因：容器没把端口发布到宿主（没有 -p）；容器名不含产品关键词（container: 是子串匹配，pg-probe-test 能过、db 不行）；agentd 低于 0.30.0（预检会直接说 agent_too_old）。",
                    "Three usual causes: the container did not publish a host port (no -p); the container name lacks the product keyword (container: is a substring match — pg-probe-test passes, db does not); agentd is older than 0.30.0 (the preflight says agent_too_old).",
                  )}
                </dd>
              </div>
              <div className={styles.faqRow}>
                <dt>
                  {t(
                    "采集结果是 unknown 或 degraded",
                    "Collection result is unknown or degraded",
                  )}
                </dt>
                <dd>
                  {t(
                    "unknown = 首轮还没完成或没有目标（常见于刚授权、或端口在听但握手不过）；degraded = 部分目标失败，看明细行写的具体实例与错误。",
                    "unknown = the first round has not finished or there are no targets (typical right after granting, or when a port listens but the handshake fails); degraded = some targets failed — see the detail line for the instance and error.",
                  )}
                </dd>
              </div>
              <div className={styles.faqRow}>
                <dt>
                  {t(
                    "库装在非标准目录或想采远端库",
                    "The database lives in a non-standard directory, or is remote",
                  )}
                </dt>
                <dd>
                  {t(
                    "指标面不支持写地址（source 只认 auto）。非标准目录但仍是本机进程时，只要端口在听就能发现；日志面可以用日志源覆盖接口钉目录。远端库需要显式端点覆盖，尚未开放。",
                    "Metric sources do not accept addresses (only auto). A non-standard directory is fine as long as the local process is listening; for log families you can pin the directory via the log-source override API. Remote databases need an explicit endpoint override, which is not available yet.",
                  )}
                </dd>
              </div>
              <div className={styles.faqRow}>
                <dt>
                  {t(
                    "PostgreSQL 报权限不足 / 连接数只有 1",
                    "PostgreSQL reports insufficient privilege, or sees only one connection",
                  )}
                </dt>
                <dd>
                  {t(
                    "缺 pg_read_all_stats：没有它只能看到探针自己的会话，别人库上的事务与 IO 都是 0 而不会报错 —— 这是最难发现的一种「看着正常、实际错了」。",
                    "pg_read_all_stats is missing: without it the probe only sees its own session, and transactions/IO for other databases read 0 without any error — the hardest “looks fine, actually wrong” case.",
                  )}
                </dd>
              </div>
            </dl>
          </section>
          </>
        )}
      </main>
    </div>
  );
}
