const fs = require('fs-extra');
const path = require('path');
const { exec } = require('child_process');
const { v4: uuidv4 } = require('uuid');

class BuildService {
  constructor() {
    this.buildsDir = path.join(__dirname, 'builds');
    fs.ensureDirSync(this.buildsDir);
  }

  async buildHTMLApp({ name, packageName, htmlContent, iconPath }) {
    const buildId = uuidv4();
    const buildDir = path.join(this.buildsDir, buildId);
    const wwwDir = path.join(buildDir, 'www');
    
    fs.ensureDirSync(wwwDir);
    fs.writeFileSync(path.join(wwwDir, 'index.html'), htmlContent);
    
    const capConfig = {
      appId: packageName || `com.app.${name.toLowerCase().replace(/\s/g, '')}`,
      appName: name,
      webDir: 'www',
      server: { androidScheme: 'https' }
    };
    fs.writeFileSync(path.join(buildDir, 'capacitor.config.json'), JSON.stringify(capConfig, null, 2));
    
    const pkg = {
      name: name.toLowerCase().replace(/\s/g, '-'),
      version: '1.0.0',
      dependencies: {
        '@capacitor/core': '^6.0.0',
        '@capacitor/cli': '^6.0.0',
        '@capacitor/android': '^6.0.0'
      }
    };
    fs.writeFileSync(path.join(buildDir, 'package.json'), JSON.stringify(pkg, null, 2));
    
    return { buildId, buildDir };
  }

  async buildWebViewApp({ name, packageName, url, iconPath }) {
    const htmlContent = `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${name}</title>
    <style>
        body { margin: 0; padding: 0; }
        iframe { width: 100%; height: 100vh; border: none; }
    </style>
</head>
<body>
    <iframe src="${url}" allowfullscreen></iframe>
</body>
</html>`;
    
    return this.buildHTMLApp({ name, packageName, htmlContent, iconPath });
  }

  async buildAPK(buildDir, buildId) {
    return new Promise((resolve, reject) => {
      // إضافة إعدادات ذاكرة أقل لـ Gradle
      const gradleProps = path.join(buildDir, 'android', 'gradle.properties');
      
      const command = `
        cd ${buildDir} && 
        npm install --silent &&
        npx cap add android &&
        npx cap sync android &&
        cd android && 
        echo "org.gradle.jvmargs=-Xmx512m -XX:MaxMetaspaceSize=256m" >> gradle.properties &&
        echo "org.gradle.daemon=false" >> gradle.properties &&
        echo "org.gradle.parallel=false" >> gradle.properties &&
        echo "android.enableJetifier=false" >> gradle.properties &&
        gradle assembleDebug --no-daemon --offline 2>/dev/null || gradle assembleDebug --no-daemon
      `;
      
      exec(command, { timeout: 900000, maxBuffer: 10*1024*1024 }, (error, stdout, stderr) => {
        if (error) {
          reject(error);
        } else {
          const apkPath = path.join(buildDir, 'android', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
          if (fs.existsSync(apkPath)) {
            const finalApk = path.join(this.buildsDir, `${buildId}.apk`);
            fs.copyFileSync(apkPath, finalApk);
            resolve(finalApk);
          } else {
            reject(new Error('APK not found at: ' + apkPath));
          }
        }
      });
    });
  }
}

module.exports = new BuildService();
