const { withAndroidManifest } = require('@expo/config-plugins');

/**
 * Notification listener library sets allowBackup=false; keep our allowBackup=true.
 */
function withAllowBackupReplace(config) {
  return withAndroidManifest(config, (cfg) => {
    const app = cfg.modResults.manifest.application?.[0];
    if (!app?.$) return cfg;
    app.$['android:allowBackup'] = 'true';
    const existing = app.$['tools:replace'];
    const parts = new Set(
      String(existing || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    );
    parts.add('android:allowBackup');
    app.$['tools:replace'] = [...parts].join(',');
    const manifest = cfg.modResults.manifest.$ || {};
    if (!manifest['xmlns:tools']) {
      manifest['xmlns:tools'] = 'http://schemas.android.com/tools';
      cfg.modResults.manifest.$ = manifest;
    }
    return cfg;
  });
}

module.exports = withAllowBackupReplace;
