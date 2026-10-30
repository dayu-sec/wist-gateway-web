# wist-gateway-web

[![Build & Test](https://github.com/dayu-sec/wist-gateway-web/actions/workflows/ci.yml/badge.svg)](https://github.com/dayu-sec/wist-gateway-web/actions/workflows/ci.yml)
[![Release](https://github.com/dayu-sec/wist-gateway-web/actions/workflows/release.yml/badge.svg)](https://github.com/dayu-sec/wist-gateway-web/actions/workflows/release.yml)
[![Version](https://img.shields.io/github/v/tag/dayu-sec/wist-gateway-web?label=version&sort=semver)](https://github.com/dayu-sec/wist-gateway-web/releases)

`wist-gateway` 的 Web 前端。提供 Agent 总览、主机指标、数据采集管线、Agent 安装与升级、Gateway 信息等管理界面，是 `wist-gateway-stack` 自托管栈的前端组件。

前端与后端解耦，通过 `/api` 反向代理访问 `wist-gateway`；可独立构建、独立发布、独立升级。

## 技术栈

- React 18 + TypeScript
- Vite 5
- React Router 6
- TanStack Query 5（数据请求与缓存）
- Zustand（全局状态）
- change-case

## 目录结构

```
wist-gateway-web/
├── jumo-ui-model.json    # Jumo UI 模型（界面唯一事实来源）
├── generate.ts           # 代码生成入口
├── generators/           # 各类生成器（components/api/hooks/store/types...）
├── src/
│   ├── api/              # 后端 API 封装（admin 等）
│   ├── components/       # 由模型生成的页面与组件
│   ├── hooks/            # React Hooks
│   ├── lib/              # 工具函数
│   ├── store/            # Zustand store
│   └── types/            # 类型定义（enums/messages/variants/views...）
├── tests/                # 契约与防泄漏测试
├── Dockerfile            # node 构建 → nginx 托管
└── .github/workflows/    # CI / Release 流水线
```

## 快速开始

### 安装与开发

```bash
npm install
npm run dev
```

开发服务器默认监听 `http://localhost:5174`。所有 `/api` 请求会被 Vite 代理到后端：

- 默认目标：`https://localhost:3000`
- 覆盖：设置环境变量 `WARP_INSIGHT_WEB_PROXY_TARGET`

```bash
WARP_INSIGHT_WEB_PROXY_TARGET=https://localhost:3000 npm run dev
```

### 构建

```bash
npm run build    # 等价于 tsc -b && vite build，产物输出到 dist/
npm run preview  # 预览构建产物
```

### 测试

```bash
npm run test:bundle              # 校验 admin token 等敏感信息未泄漏进产物
npm run test:i18n                # 校验双语取词：默认 zh、双向切换、占位符、与共享口径同源
npm run test:routes              # 校验路由约定（/control 已删、/gateway-info 只读那一项 + 可写那一项、旧路名有重定向、采集授权入口）
npm run test:collection-grants    # 校验「按采集面授权」主机状态判定（现有授权优先 / 用途 / 模板 / 就绪度）
npm run test:gateway-initialize  # 校验网关初始化材料（initial-config）接口契约
```

其余接口契约测试（`install-package` / `uplink` / `advertise-url` / `rollout` / `agent-logs` …）
见 `package.json` 的 `test:*`；都是离线可跑的 mock fetch 脚本。

## 中英双语（i18n）

界面支持**中文 / English 切换**（**右上角**状态条里的「中文 / English」开关，选择记在 `localStorage`）。
默认中文；切换**整棵树重挂载**，因此页面内的局部状态（筛选、展开的面板）会重置 —— 数据在
React Query 缓存里，不会重新拉。

- 取词：`import { t } from "../i18n"`，`t("中文原文", "English")`；
  带变量用占位符 `t("已选 {n} 台", "{n} selected", { n })`。
- **中文原文就是这段文案的身份**（第一个参数），不另立 key 表：文案一改不用同步两张表。
- ⚠️ `t()` 必须在**渲染期**求值：模块顶层常量里不要写 `t(...)`（只求值一次，切语言不会变）；
  这类表要写成函数（渲染期调用）或把文案挪进组件。
- **共享口径**（计划 / 阶段 / 条目状态、推进闸门、筛选项文案…）的双语在
  [`@dayu-sec/wist-web-core`](../wist-web-core) 的 `i18n` 里（`setLocale` / `pickLabel`），
  本 app 只在 `src/i18n/index.ts` 调一次 `setLocale`；别在别处再映射一遍。
- 全站唯一的语言状态与持久化都在 `src/i18n/index.ts`。

## 主题（浅色 / 深色）

右上角状态条里有一个日/月图标开关（与语言开关同一条 chrome 区）：**首次进入跟随系统**
（`prefers-color-scheme`），点过之后以你的选择为准（存 `localStorage`，键 `wistGatewayWeb.theme`）。

- 两套配色都在 [`src/index.css`](src/index.css)：深色是默认（`:root`），浅色是 `:root[data-theme="light"]`
  的**覆盖**。切主题只改 `<html data-theme>` 一个属性 —— 颜色全走 CSS 变量，**不需要重挂载组件树**
  （这与语言切换不同）。
- ⚠️ **新增颜色 token 时两处都要加**：漏一处，浅色下那块就是深色的。`npm run test:theme` 会拦这件事
  （`:root` 里凡是给了字面量值的 token，浅色块必须再给一次；尺度 / 字体 / `var()` 别名不算）。
- ⚠️ **组件 CSS 里不要写颜色字面量**：用 token。除了配色 token，还有一组「叠加层 / 浮层」也是随主题变的：
  `--overlay-soft`（悬停高亮）、`--overlay` / `--overlay-border`、`--bar-bg`（贴顶状态条）、
  `--panel-solid` / `--panel-translucent`（弹层）、`--scrim`（遮罩）、`--scrollbar-thumb*`。
  `#fff` 只该出现在**彩色底上的白字/白描边**（徽标、主按钮、品牌标）。
- 图表（`Sparkline` / `TrendChart`）把颜色当 `var(--series-*)` 传进 SVG，所以切主题自动跟着变；
  如果以后有组件在 JS 里**读出**具体颜色（canvas、导图），要订阅 `useAppTheme()` 重画。

## 页面路由

| 路径 | 说明 |
|------|------|
| `/` | Agent 总览 |
| `/install` | 安装 Agent |
| `/link-upstream` | 链接上级（接入上级控制中心） |
| `/gateway-info` | Gateway 信息（网关对外地址，只读 / 数据面上送地址与开关，可改） |
| `/install-package` | 安装包管理（已托管包：组件 / 版本 / 平台 / 状态 / 兼容性 / 录入时间） |
| `/install-package/add` | 安装包录入（三平台一次录入 + GitHub Release 一键填充 + 最近录入） |
| `/knowledge` | 知识库（策展内容：录入包 / 切换生效版本 / 锁旧版的工作 / 包兼容性） |
| `/init` | 已改名 `/link-upstream`，保留重定向 |
| `/gateway-init`、`/uplink`、`/agent-init` | 已改名 `/gateway-info`，保留重定向 |
| `/hosts` | 主机列表 |
| `/software` | 资产清单 |
| `/pipeline` | 数据采集管线（吞吐 / 配置与规则） |
| `/logs` | 采集日志（下拉选文件 + tail 数据面输出；支持 `grep` 式行过滤） |
| `/work` | 采集工作（按主机查看在采什么、授权/暂停/撤回） |
| `/collection-grants` | 采集授权（按采集面选主机，批量授权） |
| `/fleet` | Agent 机队（在册 Agent，含离线；删除离线机器，不可恢复） |
| `/upgrade` | Agent 升级（灰度发布计划） |
| `/upgrade/:planId` | 升级计划详情 |
| `/agents/:agentId/metrics` | 主机指标详情 |
| `/agents/:agentId/purpose` | Agent 用途 |
| `/agents/:agentId/work` | 采集工作（在采什么 / 授权 / 暂停 / 撤回） |
| `/agents/:agentId/investigations` | 一次性调查（下发只读取证 + 看 wparse 落盘的报告） |

## 代码生成

界面由 Jumo 模型驱动，`jumo-ui-model.json` 是唯一事实来源。修改模型后重新生成代码：

```bash
npx tsx generate.ts jumo-ui-model.json .
```

生成产物覆盖 `src/` 下的组件、hooks、store、types 等。**模型是源，生成代码是投影**，避免直接手改生成产物。

## 版本注入

前端版本在**构建期**注入，通过构建参数 `APP_VERSION` 写入 `VITE_APP_VERSION`，运行期在状态条显示（如 `v0.1.2`）。

- Docker 构建：`--build-arg APP_VERSION=x.y.z`
- 本地构建：`VITE_APP_VERSION=x.y.z npm run build`

## Docker 镜像

多阶段构建：`node:24-alpine` 编译 → `nginx:alpine` 托管静态产物。

```bash
docker build --build-arg APP_VERSION=0.1.2 -t ghcr.io/dayu-sec/wist-gateway-web:latest .
```

镜像只包含 `nginx` 与静态产物（不含 Node）。SPA 回退、`/api` 反向代理等**运行配置**不在本仓库内，由 `wist-gateway-stack/configs/web/nginx.conf` 在运行时以卷挂载注入，实现构建与运行配置分离。

镜像由 GitHub CI（`.github/workflows/release.yml`）在推送 `v*.*.*` tag 时自动构建并推送到 `ghcr.io/dayu-sec/wist-gateway-web`，支持 `linux/amd64` 与 `linux/arm64`。

## 与后端联调

1. 本地启动 `wist-gateway`（默认 `https://localhost:3000`）。
2. `WARP_INSIGHT_WEB_PROXY_TARGET=https://localhost:3000 npm run dev` 启动前端。
3. 或使用 `wist-gateway-stack` 的 `docker compose up` 一键拉起前后端 + `wparse` + `victoria-metrics`。
