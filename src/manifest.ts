import type { ManifestV3Export } from '@crxjs/vite-plugin'

export default {
  manifest_version: 3,
  name: 'Mustard',
  version: '0.0.1',

  icons: {
    16: 'mustard_bottle_smile_16.png',
    48: 'mustard_bottle_smile_48.png',
    128: 'mustard_bottle_smile_128.png',
    512: 'mustard_bottle_smile_512.png',
  },

  action: {
    default_popup: 'src/ui/popup/index.html',
    default_icon: {
      16: 'mustard_bottle_smile_16.png',
      48: 'mustard_bottle_smile_48.png',
      128: 'mustard_bottle_smile_128.png',
    },
  },

  options_page: 'src/ui/options/index.html',

  background: {
    service_worker: 'src/background/service-worker.ts',
    type: 'module',
  },

  permissions: ['storage', 'contextMenus', 'identity'],

  host_permissions: ['<all_urls>'],

  content_security_policy: {
    extension_pages: "script-src 'self'; object-src 'self'; img-src 'self' https: data:",
  },

  content_scripts: [
    {
      matches: ['<all_urls>'],
      js: ['src/content/content-script.ts'],
    },
  ],

  web_accessible_resources: [
    {
      resources: [
        'url-change-detector.js',
        'close_x_red_48.png',
        'upvote_blue_48.png',
        'eye_open_48.png',
        'eye_closed_48.png',
        'save_disk_48.png',
        'delete_bin_48.png',
        'publish_arrow_blue_48.png',
        'published_cloud_check_48.png',
      ],
      matches: ['<all_urls>'],
    },
  ],
} satisfies ManifestV3Export
