/**
 * Android Auto: a car screen with live glucose (androidx.car.app) and car alerts.
 * Copies the Kotlin sources, reuses the watch's GlucoseTrendEngine (same file, car package),
 * and declares the CarAppService in the manifest.
 */
const {
  AndroidConfig,
  withAndroidManifest,
  withAppBuildGradle,
  withDangerousMod,
} = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const CAR_APP_VERSION = '1.4.0';
const PACKAGE = 'com.saffist3r.healthcompanion.car';
const SRC_DIR = path.join(__dirname, 'health-companion-car', 'android');
const TREND_ENGINE = path.join(
  __dirname,
  '..',
  '..',
  'watch',
  'android',
  'app',
  'src',
  'main',
  'java',
  'com',
  'saffist3r',
  'healthcompanion',
  'watch',
  'GlucoseTrendEngine.kt'
);

function copySources(projectRoot) {
  const destDir = path.join(projectRoot, 'android', 'app', 'src', 'main', 'java', ...PACKAGE.split('.'));
  fs.mkdirSync(destDir, { recursive: true });
  for (const file of fs.readdirSync(SRC_DIR)) {
    if (file.endsWith('.kt')) fs.copyFileSync(path.join(SRC_DIR, file), path.join(destDir, file));
  }
  const engine = fs
    .readFileSync(TREND_ENGINE, 'utf8')
    .replace(/^package .*$/m, `package ${PACKAGE}\n\n// Copied from apps/watch at prebuild by withHealthCompanionCar; edit the watch file.`);
  fs.writeFileSync(path.join(destDir, 'GlucoseTrendEngine.kt'), engine);

  const xmlDir = path.join(projectRoot, 'android', 'app', 'src', 'main', 'res', 'xml');
  fs.mkdirSync(xmlDir, { recursive: true });
  fs.writeFileSync(
    path.join(xmlDir, 'automotive_app_desc.xml'),
    '<?xml version="1.0" encoding="utf-8"?>\n<automotiveApp>\n  <uses name="template" />\n</automotiveApp>\n'
  );
}

function addToManifest(manifest) {
  const app = AndroidConfig.Manifest.getMainApplicationOrThrow(manifest);
  app.service = app.service || [];
  if (!app.service.some((s) => s.$['android:name'] === `${PACKAGE}.GlucoseCarAppService`)) {
    app.service.push({
      $: { 'android:name': `${PACKAGE}.GlucoseCarAppService`, 'android:exported': 'true' },
      'intent-filter': [
        {
          action: [{ $: { 'android:name': 'androidx.car.app.CarAppService' } }],
          category: [{ $: { 'android:name': 'androidx.car.app.category.IOT' } }],
        },
      ],
    });
  }
  app['meta-data'] = app['meta-data'] || [];
  const meta = [
    { 'android:name': 'com.google.android.gms.car.application', 'android:resource': '@xml/automotive_app_desc' },
    { 'android:name': 'androidx.car.app.minCarApiLevel', 'android:value': '1' },
  ];
  for (const m of meta) {
    if (!app['meta-data'].some((d) => d.$['android:name'] === m['android:name'])) app['meta-data'].push({ $: m });
  }
  return manifest;
}

function withHealthCompanionCar(config) {
  config = withDangerousMod(config, [
    'android',
    async (cfg) => {
      copySources(cfg.modRequest.projectRoot);
      return cfg;
    },
  ]);
  config = withAppBuildGradle(config, (cfg) => {
    if (!cfg.modResults.contents.includes('androidx.car.app:app')) {
      cfg.modResults.contents = cfg.modResults.contents.replace(
        /dependencies\s*\{/,
        `dependencies {\n    implementation("androidx.car.app:app:${CAR_APP_VERSION}")`
      );
    }
    return cfg;
  });
  config = withAndroidManifest(config, (cfg) => {
    cfg.modResults = addToManifest(cfg.modResults);
    return cfg;
  });
  return config;
}

module.exports = withHealthCompanionCar;
