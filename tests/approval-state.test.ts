import {
  APPROVAL_TABS,
  APPROVAL_VIEWS,
  allowedActions,
  approvedCount,
  isApprovalTab,
  matchesTab,
  shortDigest,
  type ApprovalTab,
} from "../src/lib/approvalState";

// 审批页的**纯逻辑**测试（零依赖，`tsx` 直接跑）。
//
// 锁的是「状态 → 界面该显示什么」：tab 过滤、票数、摘要截断、以及**每行允许哪些动作**。
// 最后一条最重要 —— 按钮出现却不该出现，或者该出现却不出现，都是审批流程里的真实事故
// （通过不可撤回，签发会下发到机器）。
//
// Usage: npm run test:approval-state

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAIL: ${message}`);
}

const STATUSES = ["pending", "approved", "rejected", "expired", "weird"];

// ── 页顶 tab 的完整集合 ──────────────────────────────────────────────────
// 三个过滤档 + 一个设置档（安装与钥匙）。“安装与钥匙”不参与审批单过滤。
assert(
  JSON.stringify([...APPROVAL_VIEWS]) ===
    JSON.stringify(["pending", "approved", "all", "setup"]),
  `页顶 tab 应为 pending/approved/all/setup，现为 ${APPROVAL_VIEWS.join("/")}`,
);
for (const tab of APPROVAL_TABS) {
  assert(isApprovalTab(tab), `过滤档 ${tab} 必须被认作审批单 tab`);
}
assert(!isApprovalTab("setup"), "setup 不是审批单过滤档（不能让 matchesTab 去筛它）");

// ── tab 过滤 ────────────────────────────────────────────────────────────────
// `all` 收全部（含未知状态：宁可显示出来，也不要藏起来）。
for (const status of STATUSES) {
  assert(matchesTab({ status }, "all"), `all must include status=${status}`);
  assert(
    matchesTab({ status }, "pending") === (status === "pending"),
    `pending tab must only take pending (got status=${status})`,
  );
  assert(
    matchesTab({ status }, "approved") === (status === "approved"),
    `approved tab must only take approved (got status=${status})`,
  );
}

// ── 票数：数的是人，不是次数 ────────────────────────────────────────────────
assert(approvedCount([]) === 0, "no votes -> 0");
assert(approvedCount([{ decision: "approve" }]) === 1, "one approve -> 1");
assert(
  approvedCount([{ decision: "reject" }]) === 0,
  "a reject is not an approval",
);
assert(
  approvedCount([{ decision: "approve" }, { decision: "approve" }]) === 2,
  "two approvals -> 2",
);
assert(
  approvedCount([{ decision: "approve" }, { decision: "reject" }]) === 1,
  "mixed -> only approvals counted",
);
// 未来若网关多出一种 decision（如 abstain），不能被当成票。
assert(
  approvedCount([{ decision: "abstain" } as never]) === 0,
  "an unknown decision must not count as an approval",
);

// ── 摘要截断 ────────────────────────────────────────────────────────────────
const digest = `plan-v1:sha256:${"ab".repeat(32)}`;
assert(
  shortDigest(digest) === "abababababab",
  `plan digest must show the first 12 hex chars, got ${shortDigest(digest)}`,
);
assert(
  shortDigest("deadbeefcafebabe") === "deadbeefcafe",
  "an input without a colon is treated as the hex itself",
);
assert(shortDigest("abc") === "abc", "short input is returned as-is");

// ── 动作矩阵 ────────────────────────────────────────────────────────────────
interface Expected {
  canApprove: boolean;
  canReject: boolean;
  canIssue: boolean;
}

const cases: Array<[string, boolean, Expected]> = [
  ["pending", false, { canApprove: true, canReject: true, canIssue: false }],
  ["approved", false, { canApprove: false, canReject: false, canIssue: true }],
  ["approved", true, { canApprove: false, canReject: false, canIssue: false }],
  ["rejected", false, { canApprove: false, canReject: false, canIssue: false }],
  ["expired", false, { canApprove: false, canReject: false, canIssue: false }],
  // 未知状态按「什么都不许」处理：宁可不给按钮，也不要在不认识的状态上放开写操作。
  ["weird", false, { canApprove: false, canReject: false, canIssue: false }],
];

for (const [status, issued, expected] of cases) {
  const actual = allowedActions({ status, issued });
  assert(
    actual.canApprove === expected.canApprove &&
      actual.canReject === expected.canReject &&
      actual.canIssue === expected.canIssue,
    `allowedActions(status=${status}, issued=${issued}) -> ${JSON.stringify(actual)}`,
  );
}

// ── tab 定义 ────────────────────────────────────────────────────────────────
assert(APPROVAL_TABS.length === 3, "there are exactly three tabs");
assert(new Set(APPROVAL_TABS).size === 3, "tabs are distinct");
const expectedTabs: ApprovalTab[] = ["pending", "approved", "all"];
assert(
  expectedTabs.every((tab) => APPROVAL_TABS.includes(tab)),
  "tabs cover pending / approved / all",
);

// 分区性质：pending / approved 两个子集**互斥**。若哪天改成重叠，一个算在「待审批」
// 的单子会同时出现在「已批准」，计数相加 > 总数，界面上的数字就没法解释了。
for (const status of STATUSES) {
  const inPending = matchesTab({ status }, "pending");
  const inApproved = matchesTab({ status }, "approved");
  assert(
    !(inPending && inApproved),
    `pending and approved tabs must not overlap (status=${status})`,
  );
}

console.log("approval state OK");
