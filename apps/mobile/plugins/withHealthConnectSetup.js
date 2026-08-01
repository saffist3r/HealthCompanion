const {
  withAndroidManifest,
  withMainActivity,
} = require('@expo/config-plugins');

const HEALTH_PERMISSIONS = [
  'android.permission.health.READ_STEPS',
  'android.permission.health.READ_ACTIVE_CALORIES_BURNED',
  'android.permission.health.READ_TOTAL_CALORIES_BURNED',
  'android.permission.health.READ_DISTANCE',
  'android.permission.health.READ_EXERCISE',
  'android.permission.health.READ_HEART_RATE',
  'android.permission.ACTIVITY_RECOGNITION',
];

function ensureUsesPermission(manifest, name) {
  if (!manifest['uses-permission']) manifest['uses-permission'] = [];
  const exists = manifest['uses-permission'].some((p) => p.$?.['android:name'] === name);
  if (!exists) {
    manifest['uses-permission'].push({ $: { 'android:name': name } });
  }
}

function withHealthConnectSetup(config) {
  config = withMainActivity(config, (cfg) => {
    let src = cfg.modResults.contents;
    if (!src.includes('HealthConnectPermissionDelegate')) {
      if (src.includes('import expo.modules.ReactActivityDelegateWrapper')) {
        src = src.replace(
          'import expo.modules.ReactActivityDelegateWrapper',
          'import expo.modules.ReactActivityDelegateWrapper\nimport dev.matinzd.healthconnect.permissions.HealthConnectPermissionDelegate'
        );
      } else {
        src = `import dev.matinzd.healthconnect.permissions.HealthConnectPermissionDelegate\n${src}`;
      }
      src = src.replace(
        /super\.onCreate\((?:savedInstanceState|null)\)/,
        (match) => `${match}\n    HealthConnectPermissionDelegate.setPermissionDelegate(this)`
      );
      cfg.modResults.contents = src;
    }
    return cfg;
  });

  config = withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;
    for (const perm of HEALTH_PERMISSIONS) {
      ensureUsesPermission(manifest, perm);
    }

    const app = manifest.application?.[0];
    if (!app) return cfg;

    if (!app['activity-alias']) app['activity-alias'] = [];
    const hasAlias = app['activity-alias'].some(
      (a) => a.$?.['android:name'] === 'ViewPermissionUsageActivity'
    );
    if (!hasAlias) {
      app['activity-alias'].push({
        $: {
          'android:name': 'ViewPermissionUsageActivity',
          'android:exported': 'true',
          'android:targetActivity': '.MainActivity',
          'android:permission': 'android.permission.START_VIEW_PERMISSION_USAGE',
        },
        'intent-filter': [
          {
            action: [{ $: { 'android:name': 'android.intent.action.VIEW_PERMISSION_USAGE' } }],
            category: [
              { $: { 'android:name': 'android.intent.category.HEALTH_PERMISSIONS' } },
            ],
          },
        ],
      });
    }

    return cfg;
  });

  return config;
}

module.exports = withHealthConnectSetup;
