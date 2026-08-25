/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GOOGLE_CLIENT_ID?: string;
  readonly VITE_PROVIDER_MODE?: "local";
  readonly VITE_LOCAL_PROVIDER_SCENARIO?:
    | "success"
    | "provider_failure"
    | "submission_unknown_then_success"
    | "delivery_failure"
    | "cost_shock_success";
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface Window {
  google?: any;
}
