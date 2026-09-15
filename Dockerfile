# ===========================================================================
# wist-gateway-web — 前端构建 + 静态托管（nginx）
#
# 1. node 构建阶段：npm ci + npm run build → dist/
# 2. nginx 运行阶段：静态托管 + SPA 回退 + /api 反代到 wist-gateway
# ===========================================================================

# ── 构建阶段 ──
FROM node:24-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG APP_VERSION=dev
ENV VITE_APP_VERSION=${APP_VERSION}
RUN npm run build

# ── 运行阶段 ──
FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
EXPOSE 80
