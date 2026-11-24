import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  fetchApproverPackages,
  registerApproverPackage,
  removeApproverPackage,
  setAdminApiToken,
} from "../src/api/admin";

// 契约测试：审批终端安装包的**录入入口**（网关包管理）。
//
// 锁五件事：
//   1. 路径与方法：`GET/POST /approver/install-package`、`DELETE .../{platform}`；
//   2. **`package_sha256` 只在有值时发**（留空 = 网关对拉到的字节自行计算，而不是发一个空串）；
//   3. DELETE 的 `removed` 按布尔解析，且 platform 要 encodeURIComponent；
//   4. 列表保留 `available=false` 的行（缓存缺失 ≠ 没登记过，这两种状态处置方式不同）；
//   5. 页面确实在「安装与钥匙」tab 里渲染了录入入口（否则组件是死的，测试全绿而界面上没有）。
//
// Usage: npm run test:approver-package

interface Recorded {
  url: string;
  method: string;
  body: string;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAIL: ${message}`);
}

let recorded: Recorded[] = [];
let responder: () => Response = () => Response.json({});

globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  recorded.push({
    url: input.toString(),
    method: (init?.method ?? "GET").toUpperCase(),
    body: typeof init?.body === "string" ? init.body : "",
  });
  return responder();
};

setAdminApiToken("admin-token-under-test");

function lastCall(): Recorded {
  const call = recorded[recorded.length - 1];
  assert(call !== undefined, "expected at least one recorded call");
  return call;
}

function packageRow(
  platform: string,
  available: boolean,
  overrides: Record<string, unknown> = {},
) {
  return {
    platform,
    source: `/packages/wist-approve-v0.58.0-alpha-${platform}.tar.gz`,
    package_sha256: `sha256:${"a".repeat(64)}`,
    version: "0.58.0-alpha",
    updated_by: "admin:test",
    updated_at: "2026-11-23T00:00:00Z",
    available,
    ...overrides,
  };
}

// ── 列表：含 available=false 的行 ───────────────────────────────────────────
{
  recorded = [];
  responder = () =>
    Response.json({
      packages: [
        packageRow("x86_64-unknown-linux-musl", true),
        packageRow("aarch64-apple-darwin", false),
      ],
    });
  const packages = await fetchApproverPackages();
  const call = lastCall();
  assert(
    call.url === "/api/v1/admin/approver/install-package",
    `unexpected url: ${call.url}`,
  );
  assert(call.method === "GET", `expected GET, got ${call.method}`);
  assert(packages.length === 2, "two rows");
  assert(packages[0]?.available === true, "available row kept");
  assert(
    packages[1]?.available === false,
    "missing-cache row must be kept — it is not the same as never registered",
  );
  assert(
    packages[0]?.packageSha256 === `sha256:${"a".repeat(64)}`,
    "digest forwarded as-is",
  );
  assert(packages[0]?.version === "0.58.0-alpha", "version");
}

// ── 登记：不带摘要（网关自行计算）──────────────────────────────────────────
{
  recorded = [];
  responder = () =>
    Response.json(packageRow("x86_64-unknown-linux-musl", true));
  await registerApproverPackage({
    platform: "x86_64-unknown-linux-musl",
    source:
      "/packages/wist-approve-v0.58.0-alpha-x86_64-unknown-linux-musl.tar.gz",
  });
  const call = lastCall();
  assert(
    call.url === "/api/v1/admin/approver/install-package",
    `unexpected url: ${call.url}`,
  );
  assert(call.method === "POST", `expected POST, got ${call.method}`);
  const body = JSON.parse(call.body) as Record<string, unknown>;
  assert(body.platform === "x86_64-unknown-linux-musl", "platform");
  assert(
    typeof body.source === "string" && body.source.length > 0,
    "source is sent",
  );
  assert(
    !("package_sha256" in body),
    "empty digest must be omitted — an empty string would be rejected by the gateway",
  );
}

// ── 登记：带摘要（空白被 trim 后发出）──────────────────────────────────────
{
  recorded = [];
  responder = () => Response.json(packageRow("aarch64-apple-darwin", true));
  const digest = `sha256:${"b".repeat(64)}`;
  await registerApproverPackage({
    platform: "aarch64-apple-darwin",
    source: "https://mirror.example/wist-approve.tar.gz",
    packageSha256: `  ${digest}  `,
  });
  const body = JSON.parse(lastCall().body) as Record<string, unknown>;
  assert(body.package_sha256 === digest, "digest is trimmed before sending");
}

// ── 撤销：路径编码 + removed 解析 ───────────────────────────────────────────
{
  recorded = [];
  responder = () => Response.json({ removed: true });
  const removed = await removeApproverPackage("aarch64/apple darwin");
  const call = lastCall();
  assert(
    call.url ===
      "/api/v1/admin/approver/install-package/aarch64%2Fapple%20darwin",
    `unexpected url: ${call.url}`,
  );
  assert(call.method === "DELETE", `expected DELETE, got ${call.method}`);
  assert(removed === true, "removed=true parsed");
}

{
  // 记录本来就不存在：网关回 removed=false，不能当成成功。
  responder = () => Response.json({ removed: false });
  const removed = await removeApproverPackage("aarch64-apple-darwin");
  assert(removed === false, "removed=false parsed");
}

// ── 形状漂移要显式失败 ──────────────────────────────────────────────────────
{
  let threw = false;
  try {
    // 少了 packages 数组：契约漂移，不能当成“一个都没登记”。
    responder = () => Response.json({});
    await fetchApproverPackages();
  } catch {
    threw = true;
  }
  assert(threw, "missing packages array must throw");
}

// ── 源码闸：录入入口是「安装包」页动作行里的独立一级入口 ─────────────────────
{
  const pagePath = fileURLToPath(
    new URL(
      "../src/components/SubsystemApproverPackagePage.tsx",
      import.meta.url,
    ),
  );
  const page = readFileSync(pagePath, "utf8");
  assert(
    page.includes("<ApproverPackageSection />"),
    "the approver package page must render ApproverPackageSection (otherwise the entry is dead)",
  );

  const listPath = fileURLToPath(
    new URL(
      "../src/components/SubsystemAgentPackageListPage.tsx",
      import.meta.url,
    ),
  );
  const list = readFileSync(listPath, "utf8");
  assert(
    list.includes('to="/install-package/approver"'),
    "the install-package page must link to /install-package/approver (same action row as the agentd entry)",
  );
  assert(
    list.includes("<ApproverPackageRegistry />"),
    "the hosted-packages card must render the approver registry (it is a tab there now)",
  );
  assert(
    list.includes("styles.cardTabs"),
    "the hosted-packages card must offer tabs (WistAgentd / approval CLI)",
  );
  assert(
    !list.includes("<ApproverPackageSection />"),
    "the entry form does not belong on the list page",
  );

  const appPath = fileURLToPath(new URL("../src/App.tsx", import.meta.url));
  assert(
    readFileSync(appPath, "utf8").includes('path="/install-package/approver"'),
    "the /install-package/approver route must be registered in App.tsx",
  );

  // 审批页只留「装得上 + 有命令」：包来源的录入属于包管理，不能又长出第二个入口。
  const approvalPath = fileURLToPath(
    new URL(
      "../src/components/SubsystemAgentApprovalPage.tsx",
      import.meta.url,
    ),
  );
  const approval = readFileSync(approvalPath, "utf8");
  assert(
    !approval.includes("<ApproverPackageSection />"),
    "the approval page must not register packages — that lives on /install-package/approver",
  );
  // 只读页的另一面：公钥是登记，安装包也是登记；两者都不发起处置动作。
  for (const forbidden of ["useVoteActionApproval", "useIssueActionApproval"]) {
    assert(
      !approval.includes(forbidden),
      `approval page must stay read-only (found ${forbidden})`,
    );
  }

  const sectionPath = fileURLToPath(
    new URL("../src/components/ApproverPackageSection.tsx", import.meta.url),
  );
  const section = readFileSync(sectionPath, "utf8");
  // 录入页只留表单：已经登记的那几条在「已托管包」的审批终端档里看。
  assert(
    !section.includes("useApproverPackages") &&
      !section.includes("useRemoveApproverPackage"),
    "the entry form must not render the package list any more — that lives in the hosted-packages tab",
  );
  // 平台列表必须与安装命令同源，否则页面上两个地方会给出不同的 triple。
  assert(
    section.includes("approverPlatforms()"),
    "the per-platform rows must reuse approverPlatforms()",
  );
  // 表单形态与 agentd 录入页对齐：一行一个平台（槽位 + 来源 + 摘要），
  // 而不是一个“平台下拉 + 单个来源”。
  assert(
    section.includes("variantRow"),
    "the form must use per-platform rows (variantRow), aligned with the agentd entry page",
  );
  assert(
    section.includes("useRegisterApproverPackage"),
    "the entry form must register",
  );
  // 与 agentd 录入页一致的一键填充：两种解析来源都要有（否则只能手敲三个地址）。
  assert(
    section.includes("useResolveGitHubRelease") &&
      section.includes("useResolveCosPath"),
    "the form must offer both resolve sources (GitHub release / COS path), like the agentd entry page",
  );

  // 撤销在列表那边（已托管包 tab），不在录入表单里。
  const registryPath = fileURLToPath(
    new URL("../src/components/ApproverPackageRegistry.tsx", import.meta.url),
  );
  assert(
    readFileSync(registryPath, "utf8").includes("useRemoveApproverPackage"),
    "the registry must offer removing a platform",
  );
}

console.log("approver-package contract OK");
