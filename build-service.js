const fs = require('fs-extra');
const path = require('path');
const { exec } = require('child_process');
const { v4: uuidv4 } = require('uuid');

class BuildService {
  constructor() {
    this.buildsDir = path.join(__dirname, 'builds');
    fs.ensureDirSync(this.buildsDir);
  }

  async buildHTMLApp({ name, packageName, htmlContent }) {
    const buildId = uuidv4();
    const buildDir = path.join(this.buildsDir, buildId);
    fs.ensureDirSync(buildDir);
    fs.writeFileSync(path.join(buildDir, 'index.html'), htmlContent);
    return { buildId, buildDir };
  }

  async buildWebViewApp({ name, packageName, url }) {
    const htmlContent = `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;">
    <iframe src="${url}" style="width:100%;height:100vh;border:none;" allowfullscreen></iframe>
</body>
</html>`;
    return this.buildHTMLApp({ name, packageName, htmlContent });
  }

  async buildAPK(buildDir, buildId) {
    return new Promise((resolve, reject) => {
      const command = `
        cd ${buildDir} &&
        mkdir -p app/src/main &&
        cp index.html app/src/main/index.html &&
        cat > app/build.gradle << 'GRADLE'
plugins {
    id 'com.android.application'
}
android {
    namespace 'com.simple.webview'
    compileSdk 34
    defaultConfig {
        applicationId 'com.simple.webview'
        minSdk 21
        targetSdk 34
        versionCode 1
        versionName '1.0'
    }
}
GRADLE
        mkdir -p app/src/main/java/com/simple/webview &&
        cat > app/src/main/java/com/simple/webview/MainActivity.java << 'JAVA'
package com.simple.webview;

import android.app.Activity;
import android.os.Bundle;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import java.io.InputStream;

public class MainActivity extends Activity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        WebView webView = new WebView(this);
        webView.setWebViewClient(new WebViewClient());
        webView.getSettings().setJavaScriptEnabled(true);
        try {
            InputStream is = getAssets().open("index.html");
            byte[] buffer = new byte[is.available()];
            is.read(buffer);
            is.close();
            String html = new String(buffer, "UTF-8");
            webView.loadDataWithBaseURL(null, html, "text/html", "UTF-8", null);
        } catch (Exception e) {
            webView.loadUrl("about:blank");
        }
        setContentView(webView);
    }
}
JAVA
        mkdir -p app/src/main/assets &&
        cp index.html app/src/main/assets/index.html &&
        cat > app/src/main/AndroidManifest.xml << 'XML'
<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <uses-permission android:name="android.permission.INTERNET" />
    <application android:label="WebView App" android:hardwareAccelerated="true">
        <activity android:name=".MainActivity" android:exported="true">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>
    </application>
</manifest>
XML
        gradle assembleDebug --no-daemon -Dorg.gradle.jvmargs="-Xmx256m" 2>&1 | tail -5
      `;
      
      exec(command, { timeout: 300000, maxBuffer: 5*1024*1024 }, (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stdout || stderr));
        } else {
          const apkPath = path.join(buildDir, 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
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
