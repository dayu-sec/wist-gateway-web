import styles from "./SubsystemKafkaAclHelp.module.css";
import { CopyButton } from "./CopyButton";
import { t } from "../i18n";

/**
 * Kafka 探针的授权说明（只展示命令，不在网关侧执行）。
 *
 * 为什么放在页面上而不是"由网关自动搞定"：ACL 是 **Kafka broker 侧**按 SASL 身份判定的，
 * 网关拿不到、也不该拿到 Kafka 的管理员凭据。agentd 在本机是不是 root 与它无关 ——
 * 这是两个权限体系。
 */

interface AclCommand {
  id: string;
  purpose: string;
  command: string;
}

function aclCommands(): AclCommand[] {
  const bootstrap = "kafka-0:9093";
  return [
    {
      id: "topic",
      purpose: t(
        "读元数据、ISR 与日志末端 offset（LEO）",
        "Read metadata, ISR and log end offsets (LEO)",
      ),
      command: `kafka-acls.sh --bootstrap-server ${bootstrap} --command-config admin.properties \\\n  --add --allow-principal User:wist-probe --operation Describe --topic '*'`,
    },
    {
      id: "group-read",
      purpose: t(
        "读消费组已提交的 offset（lag 的减数）",
        "Read committed offsets of consumer groups (the subtrahend of lag)",
      ),
      command: `kafka-acls.sh --bootstrap-server ${bootstrap} --command-config admin.properties \\\n  --add --allow-principal User:wist-probe --operation Read --group '*'`,
    },
    {
      id: "group-describe",
      purpose: t(
        "读消费组状态（Stable / Empty / Rebalancing）",
        "Read consumer group state (Stable / Empty / Rebalancing)",
      ),
      command: `kafka-acls.sh --bootstrap-server ${bootstrap} --command-config admin.properties \\\n  --add --allow-principal User:wist-probe --operation Describe --group '*'`,
    },
  ];
}

export function SubsystemKafkaAclHelp() {
  const commands = aclCommands();

  return (
    <section className={styles.card} aria-labelledby="kafka-acl-help">
      <header className={styles.head}>
        <div className={styles.titleRow}>
          <h2 className={styles.title} id="kafka-acl-help">
            {t("2. Kafka 侧：授权给探针", "2. Kafka side: authorize the probe")}
          </h2>
          <span className={styles.chip}>
            {t("由 Kafka 管理员执行", "Run by the Kafka admin")}
          </span>
        </div>
        <p className={styles.summary}>
          {t(
            "agentd 用 SASL 身份连 broker 取指标。Kafka 的 ACL 在 broker 侧按这个身份判定，和 agentd 在本机是不是 root 无关 —— 这是两个权限体系。若集群没有启用 authorizer（authorizer.class.name 为空），则不需要下面任何一条。",
            "The agentd probe connects to brokers with a SASL identity. Kafka decides ACLs on the broker side for that identity; being root on the host is irrelevant — these are two different permission systems. If the cluster does not enable an authorizer (empty authorizer.class.name), none of the commands below are needed.",
          )}
        </p>
      </header>

      <ol className={styles.list}>
        {commands.map((item) => (
          <li className={styles.item} key={item.id}>
            <div className={styles.itemHead}>
              <span className={styles.purpose}>{item.purpose}</span>
              <CopyButton text={item.command} label={t("复制", "Copy")} />
            </div>
            <pre className={styles.code}>
              <code>{item.command}</code>
            </pre>
          </li>
        ))}
      </ol>

      <p className={styles.note}>
        {t(
          "把 User:wist-probe 换成 agentd 配置 [kafka] 里的用户名；--topic '*' / --group '*' 可以收窄成白名单。缺了 group 的两条时，拓扑与容量照常，只有消费组 lag 为空 —— 这是最容易被误判成“探针没工作”的一种情况。",
          "Replace User:wist-probe with the username in agentd's [kafka] section; narrow --topic '*' / --group '*' to a whitelist if needed. Without the two group permissions, topology and capacity still work but consumer lag stays empty — the case most often mistaken for “the probe is not running”.",
        )}
      </p>
    </section>
  );
}
