import styles from "./SubsystemKafkaAccessPage.module.css";
import { CopyButton } from "./CopyButton";
import { SubsystemKafkaAclHelp } from "./SubsystemKafkaAclHelp";
import { t } from "../i18n";

const CONFIG_SAMPLE = `[kafka]
enabled = true
bootstrap_servers = ["kafka-0:9093", "kafka-1:9093"]
security_protocol = "SASL_SSL"   # PLAINTEXT | SSL | SASL_PLAINTEXT | SASL_SSL
sasl_mechanism    = "auto"       # 由 broker 的 SaslHandshake 在同一加密等级内挑
username          = "wist-probe"
password_file     = "/etc/wist-agentd/kafka-password"   # agentd 可读即可，别写进配置
tls_ca_file       = "/etc/wist-agentd/kafka-ca.pem"     # 可选：覆盖系统根证书
interval_ms       = 30000`;

/**
 * 「Kafka 接入」页：agentd 侧要配什么 + Kafka 管理员要授权什么。
 *
 * 为什么单独一页：这是**跨两个权限域**的事（agentd 配置 / Kafka ACL），
 * 塞在任何一方的页面底部都会被那一页的读者当成附录跳过。
 */
export function SubsystemKafkaAccessPage() {
  return (
    <div className={styles.container}>
      <header className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>{t("Kafka 接入", "Kafka access")}</h1>
        <p className={styles.pageSummary}>
          {t(
            "Kafka 指标由 agentd 的协议探针直接采集：不依赖 Prometheus、不要求部署 exporter。这里列出两侧要做的两件事 —— agentd 侧填什么配置，Kafka 侧授权给哪个身份。",
            "Kafka metrics are collected by the agentd protocol probe directly: no Prometheus, no exporter. This page lists the two things two different people must do — what goes into the agentd config, and what the Kafka side must authorize.",
          )}
        </p>
      </header>

      <main className={styles.main}>
        <section className={styles.card} aria-labelledby="kafka-config">
          <div className={styles.cardHead}>
            <h2 className={styles.cardTitle} id="kafka-config">
              {t("1. agentd 配置", "1. agentd configuration")}
            </h2>
            <CopyButton text={CONFIG_SAMPLE} label={t("复制", "Copy")} />
          </div>
          <p className={styles.cardNote}>
            {t(
              "写在 agentd 的 agentd.toml 里。密码只从文件读（agentd 能读即可，权限由运维约定），不进配置、不进日志、也不进诊断包。sasl_mechanism = auto 时，探针按 broker 返回的可用机制在同一加密等级内选，不会从 TLS 降级到明文。",
              "Put this in agentd.toml. The password is read from a file (agentd just needs read access; permissions are an ops convention) — never in the config, logs, or diagnostics. With sasl_mechanism = auto the probe picks from the mechanisms the broker advertises, within the same encryption level; it never downgrades from TLS to plaintext.",
            )}
          </p>
          <pre className={styles.code}>
            <code>{CONFIG_SAMPLE}</code>
          </pre>
        </section>

        <SubsystemKafkaAclHelp />

        <section className={styles.card} aria-labelledby="kafka-faq">
          <h2 className={styles.cardTitle} id="kafka-faq">
            {t("3. 常见失败怎么判断", "3. Reading the failures")}
          </h2>
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
        </section>
      </main>
    </div>
  );
}
