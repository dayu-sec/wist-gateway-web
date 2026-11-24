import { useState, type FormEvent } from "react";
import { ApiError } from "../api";
import type { ResolvedGitHubRelease } from "../api/admin";
import {
  useRegisterApproverPackage,
  useResolveCosPath,
  useResolveGitHubRelease,
} from "../hooks";
import { t } from "../i18n";
import { approverPlatforms } from "../lib/approverInstall";
import {
  resolveSourceErrorMessage,
  type ResolveSource,
} from "./agentPackageUi";
import shared from "./SubsystemAgentPackages.module.css";

interface Draft {
  source: string;
  sha256: string;
}

/**
 * 「审批终端安装包」：按平台登记 `wist-approve` 的三个制品，网关负责缓存与分发。
 *
 * 表单形态与「安装包录入」（agentd）对齐：**一行一个平台**（槽位 + 来源 + 摘要），
 * 一行一个独立的请求 —— 网关的包管理接口就是按平台收的，所以这里不假装是「一次提交三平台」。
 *
 * `source` 必须是**网关进程能读到**的地址：容器部署走 `/packages/<文件名>`（用栈里的
 * `scripts/install-approver-package.sh` 投放），也可以是网关能访问的 `https://` 链接。
 * 录入时网关立刻拉一次并缓存；之后分发端点只读缓存，`available=false` 表示盘上那份没了。
 */
export function ApproverPackageSection() {
  const register = useRegisterApproverPackage();
  const githubResolve = useResolveGitHubRelease();
  const cosResolve = useResolveCosPath();

  const platforms = approverPlatforms();
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() =>
    Object.fromEntries(
      platforms.map((platform) => [
        platform.triple,
        { source: "", sha256: "" },
      ]),
    ),
  );
  /** 解析来源与输入：可选，一键把各平台资产填进对应槽位（与 agentd 录入页同一套）。 */
  const [resolveSource, setResolveSource] = useState<ResolveSource>("github");
  const [sourceInput, setSourceInput] = useState("");
  const [resolveNote, setResolveNote] = useState<string | null>(null);
  const resolve = resolveSource === "github" ? githubResolve : cosResolve;
  /** 本次提交失败的行（`triple：原因`）；一次可能失败多个，所以集中列出来。 */
  const [failures, setFailures] = useState<string[]>([]);
  const [registered, setRegistered] = useState<number | null>(null);

  const filled = platforms.filter(
    (platform) => (drafts[platform.triple]?.source ?? "").trim() !== "",
  );

  function updateDraft(triple: string, patch: Partial<Draft>) {
    setDrafts((prev) => ({
      ...prev,
      [triple]: { ...(prev[triple] ?? { source: "", sha256: "" }), ...patch },
    }));
  }

  function errorText(error: unknown): string {
    if (error instanceof ApiError) {
      return error.detail
        ? `${error.code}：${error.detail}`
        : `${error.code}（HTTP ${error.status}）`;
    }
    return t(
      "请求失败：响应不符合当前契约。",
      "Request failed: the response does not match the current contract.",
    );
  }

  /** 把一次解析结果按 target-triple 填进对应行；缺哪个就点名，不静默留空。 */
  function applyResolved(result: ResolvedGitHubRelease) {
    const missing: string[] = [];
    setDrafts((current) => {
      const next = { ...current };
      for (const platform of platforms) {
        const asset = result.assets.find(
          (item) => item.platform === platform.triple,
        );
        if (!asset) {
          missing.push(platform.label);
          continue;
        }
        next[platform.triple] = {
          source: asset.artifactUrl,
          sha256: asset.sha256 ?? "",
        };
      }
      return next;
    });
    setResolveNote(
      missing.length === 0
        ? t(
            "已按 {version} 填充 {n} 个平台。",
            "Filled {n} platforms from {version}.",
            { version: result.version, n: platforms.length },
          )
        : t(
            "{version}：已填充 {n} 个平台，缺少 {missing}，请手动补址（或该 release 本次没有这个平台的资产）。",
            "{version}: filled {n} platforms; missing {missing}. Fill in those URLs manually (or this release has no asset for that platform).",
            {
              version: result.version,
              n: platforms.length - missing.length,
              missing: missing.join(" / "),
            },
          ),
    );
  }

  function handleResolve() {
    const value = sourceInput.trim();
    if (!value) return;
    resolve.mutate(value, { onSuccess: applyResolved });
  }

  function selectResolveSource(next: ResolveSource) {
    if (next === resolveSource) return;
    setResolveSource(next);
    // 两种来源的输入不可互换（页面地址 vs 桶/前缀），切换就清掉，别留一个必然失败的值。
    setSourceInput("");
    setResolveNote(null);
    githubResolve.reset();
    cosResolve.reset();
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setFailures([]);
    setRegistered(null);
    let ok = 0;
    const failed: string[] = [];
    // 逐平台提交：每个平台本来就是一条记录，某个平台失败不影响已登记的那些。
    for (const platform of filled) {
      const draft = drafts[platform.triple];
      try {
        await register.mutateAsync({
          platform: platform.triple,
          source: draft.source.trim(),
          packageSha256: draft.sha256.trim() ? draft.sha256.trim() : undefined,
        });
        ok += 1;
        updateDraft(platform.triple, { source: "", sha256: "" });
      } catch (error) {
        failed.push(`${platform.triple}：${errorText(error)}`);
      }
    }
    setRegistered(ok);
    setFailures(failed);
  }

  return (
    <section className={shared.card} aria-labelledby="approver-package-entry">
      <header className={shared.cardHead}>
        <h2 id="approver-package-entry">
          {t("按平台登记", "Register per platform")}
        </h2>
        <p>
          {t(
            "审批人从本网关装 wist-approve，所以网关要先持有三个平台的制品。来源必须是网关进程自己能读到的地址：容器部署填 /packages/<文件名>（用栈里的 scripts/install-approver-package.sh 投放），或填网关可访问的 https 地址。录入时网关会立刻拉取并缓存，失败则这一行不生效。",
            "Approvers install wist-approve from this gateway, so the gateway must hold the artifacts for all three platforms. The source must be readable by the gateway process itself: in a container use /packages/<file> (place it with scripts/install-approver-package.sh in the stack), or an https URL the gateway can reach. The gateway fetches and caches it on registration; a failed fetch records nothing for that row.",
          )}
        </p>
      </header>

      <form className={shared.form} onSubmit={handleSubmit}>
        <p className={shared.variantsHint}>
          {t(
            "填了来源的平台会被登记，没填的不动；已经登记过的平台再填一次就是「换这一份」。",
            "Platforms with a source are registered; empty rows are left alone. Filling an already registered platform replaces that platform's package.",
          )}
        </p>

        {/* 解析来源：GitHub Release 页面地址 / 腾讯 COS 路径。与「安装包录入」页同一个接口、
              同一套控件；两种输入的“填什么”不同，填充与缺平台提示共用。 */}
        <div
          className={shared.sourceTabs}
          role="tablist"
          aria-label={t("解析来源", "Resolve source")}
        >
          {(["github", "cos"] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={resolveSource === value}
              className={
                resolveSource === value
                  ? `${shared.sourceTab} ${shared.sourceTabActive}`
                  : shared.sourceTab
              }
              onClick={() => selectResolveSource(value)}
            >
              {value === "github"
                ? "GitHub Release"
                : t("COS 路径", "COS path")}
            </button>
          ))}
        </div>

        <div className={shared.resolveField}>
          <label
            className={shared.resolveLabel}
            htmlFor="approver-package-resolve"
          >
            {resolveSource === "github"
              ? t(
                  "GitHub Release 地址（可选，一键填充）",
                  "GitHub Release URL (optional, one-click fill)",
                )
              : t(
                  "COS 路径（可选，一键填充）",
                  "COS path (optional, one-click fill)",
                )}
          </label>
          <div className={shared.resolveControls}>
            <input
              id="approver-package-resolve"
              className={shared.resolveInput}
              type="text"
              value={sourceInput}
              onChange={(event) => {
                setSourceInput(event.target.value);
                if (resolveNote) setResolveNote(null);
              }}
              onKeyDown={(event) => {
                // 回车是「解析」，别把表单提交掉（那会立刻变成一次空提交）。
                if (event.key === "Enter") {
                  event.preventDefault();
                  handleResolve();
                }
              }}
              placeholder={
                resolveSource === "github"
                  ? "https://github.com/dayu-sec/wist-approve/releases/tag/<tag>"
                  : t(
                      "桶/组件/版本，如 <桶>/wist-approve/v0.58.0-alpha",
                      "bucket/component/version, e.g. <bucket>/wist-approve/v0.58.0-alpha",
                    )
              }
              autoComplete="off"
              spellCheck={false}
            />
            <button
              type="button"
              className={shared.resolveButton}
              onClick={handleResolve}
              disabled={resolve.isPending || !sourceInput.trim()}
            >
              {resolve.isPending
                ? t("解析中…", "Resolving…")
                : t("解析并填充", "Resolve and fill")}
            </button>
          </div>
          <small className={shared.resolveHint}>
            {t(
              "填地址后点「解析并填充」：网关读该来源的资产，按 target-triple 自动填到对应平台（摘要一并填上）。填进来的是制品地址；隔离站点仍建议先用栈脚本把包投到 /packages，再填容器内路径。",
              "Enter the address and click Resolve and fill: the gateway reads that source's assets and fills the matching platform rows by target-triple (digests included). What gets filled is the artifact URL; for air-gapped sites prefer the stack script that places packages under /packages and then use the in-container path.",
            )}
          </small>
        </div>
        {resolve.error ? (
          <div className={shared.errorBanner} role="alert">
            {t("解析失败：{detail}", "Resolve failed: {detail}", {
              detail: resolveSourceErrorMessage(resolve.error, resolveSource),
            })}
          </div>
        ) : null}
        {resolveNote ? <p className={shared.fieldHint}>{resolveNote}</p> : null}

        {platforms.map((platform) => (
          <div key={platform.triple} className={shared.variantRow}>
            <div className={shared.variantSlot}>
              <strong>{platform.label}</strong>
              <code>{platform.triple}</code>
            </div>
            <label className={shared.field}>
              <span>
                {t("来源（网关可读）", "Source (readable by gateway)")}
              </span>
              <input
                type="text"
                value={drafts[platform.triple]?.source ?? ""}
                onChange={(event) =>
                  updateDraft(platform.triple, { source: event.target.value })
                }
                placeholder={`/packages/wist-approve-<tag>-${platform.triple}.tar.gz`}
                autoComplete="off"
                spellCheck={false}
              />
            </label>
            <label className={shared.field}>
              <span>
                {t(
                  "期望摘要（sha256，可选）",
                  "Expected digest (sha256, optional)",
                )}
              </span>
              <input
                type="text"
                value={drafts[platform.triple]?.sha256 ?? ""}
                onChange={(event) =>
                  updateDraft(platform.triple, { sha256: event.target.value })
                }
                placeholder={t(
                  "留空则由网关对拉到的字节自行计算",
                  "Leave empty to let the gateway hash the fetched bytes",
                )}
                autoComplete="off"
                spellCheck={false}
              />
            </label>
          </div>
        ))}

        <p className={shared.formNote}>
          {t(
            "文件名约定：wist-approve-<tag>-<平台>.tar.gz（与 wist-approve 的 Release 制品同名）。来源可以是 https:// 地址，或网关容器里能读到的绝对路径（如 /packages/…）；不支持明文 http。摘要在填了的情况下必须与拉到的字节一致，不符即拒。",
            "File naming: wist-approve-<tag>-<platform>.tar.gz (same name as the wist-approve release artifact). The source may be an https URL or an absolute path readable inside the gateway container (for example /packages/…); plain http is not supported. When a digest is given it must match the fetched bytes, otherwise the row is rejected.",
          )}
        </p>

        {failures.length > 0 ? (
          <div className={shared.errorBanner} role="alert">
            {t("部分平台登记失败：", "Some platforms failed: ")}
            {failures.join("；")}
          </div>
        ) : null}
        {registered !== null && registered > 0 ? (
          <div className={shared.formNotice} role="status">
            {t(
              "已登记 {n} 个平台：网关已拉取并缓存，审批人的安装命令现在就能取到。",
              "Registered {n} platform(s): the gateway fetched and cached them, and approvers' install command can use them now.",
              { n: registered },
            )}
          </div>
        ) : null}

        <div className={shared.submitBar}>
          <span className={shared.submitHint}>
            {t(
              "逐平台提交；某个平台失败不影响其它平台。",
              "Submitted platform by platform; one failure does not affect the others.",
            )}
          </span>
          <button
            type="submit"
            className={shared.primaryButton}
            disabled={register.isPending || filled.length === 0}
          >
            {register.isPending
              ? t("正在拉取并登记…", "Fetching and registering…")
              : t("登记安装包", "Register packages")}
          </button>
        </div>
      </form>
    </section>
  );
}
