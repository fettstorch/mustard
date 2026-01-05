import type { ManifestV3Export } from "@crxjs/vite-plugin";

export default {
  manifest_version: 3,
  name: "Notes Overlay",
  version: "0.0.1",

  action: {
    default_popup: "src/ui/popup/index.html",
  },

  options_page: "src/ui/options/index.html",

  background: {
    service_worker: "src/background/service-worker.ts",
    type: "module",
  },

  permissions: [
    "storage"
  ],

  host_permissions: [
    "<all_urls>"
  ],

  content_scripts: [
    {
      matches: ["<all_urls>"],
      js: ["src/content/content-script.ts"],
    },
  ],
} satisfies ManifestV3Export;
