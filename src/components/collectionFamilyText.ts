import { t } from "../i18n";

/**
 * 采集面（`CollectionFamily`）的**工作名**与**说明文字**。
 *
 * 面名本身（`LoginSession` 这类）是协议值：进数据帧、进接口、大小写敏感，**不翻译**。
 * 页面上讲给人听的名称与说明放在这里；`t()` 在渲染期求值，切语言会跟着变
 * （与 `machineClassLabel` 同一写法）。
 *
 * 新增面时三处一起加：模型 `families.mju`、网关白名单 `FAMILIES`、本表。
 * 本表缺项不会崩：未知面回落成面名本身，且不编造说明。
 */
interface CollectionFamilyText {
  nameZh: string;
  nameEn: string;
  summaryZh: string;
  summaryEn: string;
}

const COLLECTION_FAMILY_TEXT: Record<string, CollectionFamilyText> = {
  LoginSession: {
    nameZh: "登录会话",
    nameEn: "Login sessions",
    summaryZh: "登录、退出与会话，含认证事件。",
    summaryEn: "Logins, logouts, and sessions, including authentication events.",
  },
  PrivilegeExecution: {
    nameZh: "提权执行",
    nameEn: "Privilege execution",
    summaryZh: "提权与命令执行。",
    summaryEn: "Privilege escalation and command execution.",
  },
  SoftwareChange: {
    nameZh: "软件变更",
    nameEn: "Software changes",
    summaryZh: "系统与软件变更。",
    summaryEn: "System and software changes.",
  },
  ServiceLifecycle: {
    nameZh: "服务生命周期",
    nameEn: "Service lifecycle",
    summaryZh: "服务生命周期（launchd / systemd）。",
    summaryEn: "Service lifecycle events (launchd / systemd).",
  },
  CrashPanic: {
    nameZh: "崩溃与 Panic",
    nameEn: "Crashes & panics",
    summaryZh: "应用崩溃与内核 panic。",
    summaryEn: "Application crashes and kernel panics.",
  },
  NetworkFirewall: {
    nameZh: "网络与防火墙",
    nameEn: "Network & firewall",
    summaryZh: "网络、防火墙与 Wi-Fi。",
    summaryEn: "Network, firewall, and Wi-Fi events.",
  },
  RebootPower: {
    nameZh: "关机与重启",
    nameEn: "Shutdown & reboot",
    summaryZh: "关机、重启与电源事件。",
    summaryEn: "Shutdown, reboot, and power events.",
  },
  MiscSystem: {
    nameZh: "系统杂项",
    nameEn: "System misc",
    summaryZh: "系统杂项日志。",
    summaryEn: "Miscellaneous system logs.",
  },
  HostMetrics: {
    nameZh: "主机指标",
    nameEn: "Host metrics",
    summaryZh: "主机负载、内存、磁盘与开机时长等指标。",
    summaryEn: "Host metrics such as load, memory, disk, and uptime.",
  },
  PrivacyTcc: {
    nameZh: "隐私与钥匙串",
    nameEn: "Privacy & Keychain",
    summaryZh: "隐私授权（TCC）与 Keychain。",
    summaryEn: "Privacy permissions (TCC) and Keychain.",
  },
  GatekeeperQuarantine: {
    nameZh: "隔离来源",
    nameEn: "Quarantine origins",
    summaryZh: "Gatekeeper 隔离来源。",
    summaryEn: "Gatekeeper quarantine origins.",
  },
  DevToolchain: {
    nameZh: "开发工具链",
    nameEn: "Developer toolchain",
    summaryZh: "Homebrew、Xcode、容器、包管理器与 IDE 等开发工具链。",
    summaryEn: "Developer toolchain such as Homebrew, Xcode, containers, package managers, and IDEs.",
  },
  KernelSystem: {
    nameZh: "内核与系统日志",
    nameEn: "Kernel & system logs",
    summaryZh: "内核与系统日志，含 OOM killer。",
    summaryEn: "Kernel and system logs, including the OOM killer.",
  },
  DatabaseService: {
    nameZh: "数据库服务",
    nameEn: "Database services",
    summaryZh: "数据库服务日志。",
    summaryEn: "Database service logs.",
  },
  StorageHealth: {
    nameZh: "存储健康",
    nameEn: "Storage health",
    summaryZh: "存储与文件系统健康（fsck / RAID / SMART / 容量）。",
    summaryEn: "Storage and filesystem health (fsck / RAID / SMART / capacity).",
  },
  ComputeWorkload: {
    nameZh: "作业与加速卡",
    nameEn: "Workloads & accelerators",
    summaryZh: "作业、调度与加速卡。",
    summaryEn: "Jobs, schedulers, and accelerators.",
  },
  BackupJob: {
    nameZh: "备份作业",
    nameEn: "Backup jobs",
    summaryZh: "备份与批处理。",
    summaryEn: "Backups and batch jobs.",
  },
  NetworkService: {
    nameZh: "网络服务",
    nameEn: "Network services",
    summaryZh: "网络服务（NFS / SMB / 防火墙规则）。",
    summaryEn: "Network services (NFS / SMB / firewall rules).",
  },
};

/** 面的人类可读工作名。未知面回落成面名本身（协议值仍然可读）。 */
export function collectionFamilyName(family: string): string {
  const text = COLLECTION_FAMILY_TEXT[family];
  return text ? t(text.nameZh, text.nameEn) : family;
}

/** 面的说明文字。未知面返回 `null` —— 不编造它采什么。 */
export function collectionFamilySummary(family: string): string | null {
  const text = COLLECTION_FAMILY_TEXT[family];
  return text ? t(text.summaryZh, text.summaryEn) : null;
}
