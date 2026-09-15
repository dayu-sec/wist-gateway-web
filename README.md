# wist-gateway-web

`wist-gateway` 的 Web 前端。提供 Agent 总览、主机指标、数据采集管线、Agent 安装与升级、Gateway 初始化等管理界面，是 `wist-gateway-stack` 自托管栈的前端组件。

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
npm run test:gateway-initialize  # 校验 Gateway 初始化接口契约
```

## 页面路由

| 路径 | 说明 |
|------|------|
| `/` | Agent 总览 |
| `/control` | Agent 控制中心 |
| `/install` | 安装 Agent |
| `/init` | 初始化 Gateway |
| `/hosts` | 主机列表 |
| `/pipeline` | 数据采集管线 |
| `/agents/:agentId/metrics` | 主机指标详情 |

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

多阶段构建：`node:20-alpine` 编译 → `nginx:alpine` 托管静态产物。

```bash
docker build --build-arg APP_VERSION=0.1.2 -t ghcr.io/dayu-sec/wist-gateway-web:latest .
```

镜像只包含 `nginx` 与静态产物（不含 Node）。SPA 回退、`/api` 反向代理等**运行配置**不在本仓库内，由 `wist-gateway-stack/configs/web/nginx.conf` 在运行时以卷挂载注入，实现构建与运行配置分离。

镜像由 GitHub CI（`.github/workflows/release.yml`）在推送 `v*.*.*` tag 时自动构建并推送到 `ghcr.io/dayu-sec/wist-gateway-web`，支持 `linux/amd64` 与 `linux/arm64`。

## 与后端联调

1. 本地启动 `wist-gateway`（默认 `https://localhost:3000`）。
2. `WARP_INSIGHT_WEB_PROXY_TARGET=https://localhost:3000 npm run dev` 启动前端。
3. 或使用 `wist-gateway-stack` 的 `docker compose up` 一键拉起前后端 + `wparse` + `victoria-metrics`。
