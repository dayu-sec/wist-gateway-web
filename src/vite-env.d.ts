/// <reference types="vite/client" />

/** 仅 dev：vite 把网关 admin token 注入页面（见 vite.config.ts 的 devAdminTokenPlugin）。 */
interface Window {
  __DEV_ADMIN_TOKEN__?: string;
}

interface ImportMetaEnv {
  readonly VITE_APP_VERSION?: string;
}

declare module "*.module.css" {
  const classes: { readonly [key: string]: string };
  export default classes;
}
