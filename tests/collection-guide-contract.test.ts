import { strict as assert } from "node:assert";
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
} from "../src/components/collectionGuideContent";

/**
 * 「采集指南」页的内容契约。
 *
 * 这页曾经落后于实现（单元早就 `active` 了，还写着「draft、配了也不会采」），
 * 而这种错只会让人白做一遍动作、且没有任何测试会红。所以把**与代码约定绑定的运维事实**
 * 钉在这里：凭据 key 口径、门控条件、SQL 权限、状态闭集。
 */

// ── 凭据 key：必须与 agentd `db_source::credential_key` 的四种回退一致 ──────────
const EXPECTED_KEY_PREFIX: Record<string, string> = {
  host: "port-",
  container: "container-",
  k8s: "pod-",
  fallback: "addr-",
};

assert.deepEqual(
  DB_KEY_RULES.map((rule) => rule.id),
  ["host", "container", "k8s", "fallback"],
  "四种实例范围的顺序：宿主 → 容器 → k8s → 回退",
);

for (const rule of DB_KEY_RULES) {
  assert.ok(
    rule.key.startsWith(EXPECTED_KEY_PREFIX[rule.id]),
    `${rule.id}: 目录名口径要以 ${EXPECTED_KEY_PREFIX[rule.id]} 开头（实际 ${rule.key}）`,
  );
  assert.ok(
    rule.example.startsWith(EXPECTED_KEY_PREFIX[rule.id]),
    `${rule.id}: 例子要和口径同前缀（实际 ${rule.example}）`,
  );
  assert.ok(
    rule.scopeZh.trim().length > 0 && rule.scopeEn.trim().length > 0,
    `${rule.id}: 两种语言都不能留空`,
  );
}

// ── 凭据投放：路径与权限是硬约定 ────────────────────────────────────────────
for (const path of [
  "/etc/wist-agentd/secrets/postgres/",
  "/etc/wist-agentd/secrets/mysql/",
  "/etc/wist-agentd/secrets/doris/",
]) {
  assert.ok(DB_SECRET_LAYOUT.includes(path), `凭据布局要覆盖 ${path}`);
}
assert.ok(DB_SECRET_LAYOUT.includes("container-"), "要给出容器场景（容器名作 key）");
assert.ok(DB_SECRET_LAYOUT.includes("ca.pem"), "要提到可选的 CA 文件");
assert.ok(
  DB_SECRET_LAYOUT.includes("install -d -m 700") &&
    DB_SECRET_LAYOUT.includes("install -m 600"),
  "投放示例要带上目录 700 / 文件 600（防同机其他用户读走口令）",
);
assert.ok(
  !DB_SECRET_LAYOUT.includes("password=") && !DB_SECRET_LAYOUT.includes("PASSWORD="),
  "不要把口令写进命令行（会进 shell 历史/进程表）",
);

// ── 门控：mac 单元必须写清条件，Linux 单元没有条件 ──────────────────────────
assert.equal(DB_GATING_ROWS.length, 6, "三个 Linux + 三个 macOS 指标单元");
const macRows = DB_GATING_ROWS.filter((row) => row.platform === "macos");
assert.equal(macRows.length, 3);
for (const row of macRows) {
  assert.ok(
    row.condition.includes("container:"),
    `${row.unit}: macOS 上必须能靠容器名门控（Docker 里的库没有宿主进程）`,
  );
  assert.ok(
    row.summaryZh.trim().length > 0 && row.summaryEn.trim().length > 0,
    `${row.unit}: 两种语言都不能留空`,
  );
}
for (const row of DB_GATING_ROWS.filter((row) => row.platform === "linux")) {
  assert.equal(row.condition, "", `${row.unit}: Linux 指标单元随包派发，没有 match`);
}

// ── SQL：只读权限，且各产品要的不一样 ───────────────────────────────────────
assert.ok(PG_SQL.includes("pg_read_all_stats"), "PG 必须授予 pg_read_all_stats");
assert.ok(PG_SQL.includes("GRANT CONNECT ON DATABASE postgres"), "PG 要能连维护库");
assert.ok(
  !PG_SQL.includes("REPLICATION CLIENT"),
  "REPLICATION CLIENT 是 MySQL 的权限，别混进 PG",
);
assert.ok(
  MYSQL_SQL.includes("PROCESS") && MYSQL_SQL.includes("REPLICATION CLIENT"),
  "MySQL 需要 PROCESS + REPLICATION CLIENT",
);
assert.ok(!MYSQL_SQL.includes("pg_read_all_stats"), "别把 PG 的权限混进 MySQL");
assert.ok(
  DORIS_SQL.includes("不需要额外 GRANT"),
  "Doris 4.x 实测默认权限够用，页面要这么写",
);

// ── 状态闭集：与契约 `AgentLocalCollection.status` 对齐 ────────────────────
assert.deepEqual(
  COLLECTION_STATUS_DOCS.map((doc) => doc.status).sort(),
  ["degraded", "failed", "ok", "paused", "unknown"],
  "采集结果只有这五个状态",
);
for (const doc of COLLECTION_STATUS_DOCS) {
  assert.ok(doc.zh.trim().length > 0 && doc.en.trim().length > 0);
}

// ── Kafka 侧没被这次改动带坏 ───────────────────────────────────────────────
assert.ok(KAFKA_SECRET_LAYOUT.includes("/etc/wist-agentd/secrets/kafka/probe"));
assert.ok(KAFKA_SECRET_LAYOUT.includes("/etc/wist-agentd/secrets/kafka/ca.pem"));
assert.ok(KAFKA_TUNING.includes("[kafka]"), "Kafka 调优段仍在");

console.log("collection guide content: OK（key 口径 / 凭据路径 / 门控 / SQL / 状态闭集）");
