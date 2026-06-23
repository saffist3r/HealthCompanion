const {
  withAppBuildGradle,
  withMainApplication,
  withDangerousMod,
} = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const PACKAGE_JAVA_DIR = ['com', 'saffist3r', 'healthcompanion', 'wearbridge'];
const SRC_DIR = path.join(__dirname, 'health-companion-wear', 'android');

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
}

function addWearPackage(mainApplication) {
  const importLine = 'import com.saffist3r.healthcompanion.wearbridge.HealthCompanionWearPackage';
  if (mainApplication.includes('HealthCompanionWearPackage')) {
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

  if (contents.includes('add(HealthCompanionWearPackage())')) {
    return contents;
  }
  if (contents.includes('PackageList(this).packages.apply')) {
    contents = contents.replace(
      /PackageList\(this\)\.packages\.apply\s*\{/,
      'PackageList(this).packages.apply {\n              add(HealthCompanionWearPackage())'
    );
  } else {
    contents = contents.replace(
      'PackageList(this).packages',
      'PackageList(this).packages.apply {\n              add(HealthCompanionWearPackage())\n            }'
    );
  }
  return contents;
}

function withHealthCompanionWear(config) {
  config = withDangerousMod(config, [
    'android',
    async (cfg) => {
      copyNativeSources(cfg.modRequest.projectRoot);
      return cfg;
    },
  ]);

  config = withAppBuildGradle(config, (cfg) => {
    if (!cfg.modResults.contents.includes('play-services-wearable')) {
      cfg.modResults.contents = cfg.modResults.contents.replace(
        /dependencies\s*\{/,
        'dependencies {\n    implementation("com.google.android.gms:play-services-wearable:18.1.0")'
      );
    }
    return cfg;
  });

  config = withMainApplication(config, (cfg) => {
    cfg.modResults.contents = addWearPackage(cfg.modResults.contents);
    return cfg;
  });

  return config;
}

module.exports = withHealthCompanionWear;
