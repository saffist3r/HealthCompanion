const {
  withAppBuildGradle,
  withMainApplication,
  withAndroidManifest,
  withDangerousMod,
} = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const PACKAGE_JAVA_DIR = ['com', 'saffist3r', 'healthcompanion', 'samsunghealth'];
const SRC_DIR = path.join(__dirname, 'samsung-health', 'android');
const AAR_SRC = path.join(__dirname, 'samsung-health', 'libs', 'samsung-health-data-api.aar');

function copyNativeSources(projectRoot) {
  const destDir = path.join(
    projectRoot,
    'android',
    'app',
    'src',
    'main',
    'java',
    ...PACKAGE_JAVA_DIR
  );
  fs.mkdirSync(destDir, { recursive: true });
  for (const file of fs.readdirSync(SRC_DIR)) {
    if (file.endsWith('.kt')) {
      fs.copyFileSync(path.join(SRC_DIR, file), path.join(destDir, file));
    }
  }

  const libsDir = path.join(projectRoot, 'android', 'app', 'libs');
  fs.mkdirSync(libsDir, { recursive: true });
  if (fs.existsSync(AAR_SRC)) {
    fs.copyFileSync(AAR_SRC, path.join(libsDir, 'samsung-health-data-api.aar'));
  }
}

function addPackage(mainApplication) {
  const importLine =
    'import com.saffist3r.healthcompanion.samsunghealth.SamsungHealthPackage';
  if (mainApplication.includes('SamsungHealthPackage')) {
    return mainApplication;
  }
  let contents = mainApplication;
  if (contents.includes('import com.facebook.react.ReactApplication')) {
    contents = contents.replace(
      'import com.facebook.react.ReactApplication',
      `import com.facebook.react.ReactApplication\n${importLine}`
    );
  } else {
    contents = `${importLine}\n${contents}`;
  }
  if (contents.includes('add(SamsungHealthPackage())')) {
    return contents;
  }
  if (contents.includes('PackageList(this).packages.apply')) {
    contents = contents.replace(
      /PackageList\(this\)\.packages\.apply\s*\{/,
      'PackageList(this).packages.apply {\n              add(SamsungHealthPackage())'
    );
  } else {
    contents = contents.replace(
      'PackageList(this).packages',
      'PackageList(this).packages.apply {\n              add(SamsungHealthPackage())\n            }'
    );
  }
  return contents;
}

function withSamsungHealth(config) {
  config = withDangerousMod(config, [
    'android',
    async (cfg) => {
      copyNativeSources(cfg.modRequest.projectRoot);
      return cfg;
    },
  ]);

  config = withAppBuildGradle(config, (cfg) => {
    let contents = cfg.modResults.contents;
    if (!contents.includes('samsung-health-data-api.aar')) {
      contents = contents.replace(
        /dependencies\s*\{/,
        `dependencies {
    implementation(files("libs/samsung-health-data-api.aar"))
    implementation("com.google.code.gson:gson:2.11.0")`
      );
    }
    if (!contents.includes('kotlin-parcelize') && !contents.includes('plugin.parcelize')) {
      // parcelize usually applied at project level; skip if missing
    }
    cfg.modResults.contents = contents;
    return cfg;
  });

  config = withMainApplication(config, (cfg) => {
    cfg.modResults.contents = addPackage(cfg.modResults.contents);
    return cfg;
  });

  config = withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;
    if (!manifest.queries) manifest.queries = [{}];
    const q = manifest.queries[0];
    if (!q.package) q.package = [];
    const has = q.package.some((p) => p.$?.['android:name'] === 'com.sec.android.app.shealth');
    if (!has) {
      q.package.push({ $: { 'android:name': 'com.sec.android.app.shealth' } });
    }
    return cfg;
  });

  return config;
}

module.exports = withSamsungHealth;
