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
    
    // إنشاء المجلدات
    fs.ensureDirSync(wwwDir);
    
    // حفظ HTML
    fs.writeFileSync(path.join(wwwDir, 'index.html'), htmlContent);
    
    // إنشاء capacitor.config.json
    const capConfig = {
      appId: packageName || `com.app.${name.toLowerCase().replace(/\s/g, '')}`,
      appName: name,
      webDir: 'www',
      server: {
        androidScheme: 'https'
      }
    };
    fs.writeFileSync(path.join(buildDir, 'capacitor.config.json'), JSON.stringify(capConfig, null, 2));
    
    // إنشاء package.json
    const pkg = {
      name: name.toLowerCase().replace(/\s/g, '-'),
      version: '1.0.0',
      description: name,
      main: 'index.js',
      dependencies: {
        '@capacitor/core': '^6.0.0',
        '@capacitor/cli': '^6.0.0',
        '@capacitor/android': '^6.0.0'
      },
      scripts: {
        build: 'cap add android && cd android && gradle assembleDebug'
      }
    };
    fs.writeFileSync(path.join(buildDir, 'package.json'), JSON.stringify(pkg, null, 2));
    
    // نسخ الأيقونة لو موجودة
    if (iconPath && fs.existsSync(iconPath)) {
      const resDir = path.join(buildDir, 'android', 'app', 'src', 'main', 'res');
      fs.ensureDirSync(path.join(resDir, 'mipmap'));
      fs.copyFileSync(iconPath, path.join(resDir, 'mipmap', 'ic_launcher.png'));
    }
    
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
      const command = `
        cd ${buildDir} && 
        npm install --silent &&
        npx cap add android --no-sync &&
        npx cap sync android &&
        cd android && 
        gradle assembleDebug --no-daemon
      `;
      
      exec(command, { timeout: 600000 }, (error, stdout, stderr) => {
        if (error) {
          reject(error);
        } else {
          const apkPath = path.join(buildDir, 'android', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
          if (fs.existsSync(apkPath)) {
            const finalApk = path.join(this.buildsDir, `${buildId}.apk`);
            fs.copyFileSync(apkPath, finalApk);
            resolve(finalApk);
          } else {
            reject(new Error('APK not found'));
          }
        }
      });
    });
  }
}

module.exports = new BuildService();
