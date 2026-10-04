const { withAppBuildGradle } = require("expo/config-plugins");

module.exports = function withCodelyAndroidSigning(config) {
  return withAppBuildGradle(config, (result) => {
    if (result.modResults.language !== "groovy")
      throw new Error("Codely signing requires Groovy Gradle");
    const marker = "// Paseo Codely external release signing";
    if (!result.modResults.contents.includes(marker)) {
      result.modResults.contents += `
${marker}
android {
    signingConfigs {
        codely {
            def keystorePath = System.getenv('PASEO_ANDROID_KEYSTORE')
            if (keystorePath) storeFile file(keystorePath)
            storePassword System.getenv('PASEO_ANDROID_STORE_PASSWORD')
            keyAlias System.getenv('PASEO_ANDROID_KEY_ALIAS') ?: 'paseo-codely'
            keyPassword System.getenv('PASEO_ANDROID_KEY_PASSWORD')
        }
    }
    buildTypes.release.signingConfig signingConfigs.codely
}
`;
    }
    return result;
  });
};
