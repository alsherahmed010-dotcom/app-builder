FROM node:18

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    openjdk-17-jdk \
    wget \
    unzip \
    zip \
    qemu-user-static \
    binfmt-support \
    && rm -rf /var/lib/apt/lists/*

# Register binfmt for x86_64 emulation
RUN update-binfmts --enable qemu-x86_64 || true

# Set Android SDK environment
ENV ANDROID_HOME=/opt/android-sdk
ENV ANDROID_SDK_ROOT=/opt/android-sdk
ENV PATH=$PATH:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/build-tools/34.0.0

# Install Android SDK
RUN mkdir -p $ANDROID_HOME/cmdline-tools && cd $ANDROID_HOME/cmdline-tools \
    && wget -q https://dl.google.com/android/repository/commandlinetools-linux-9477386_latest.zip \
    && unzip -q commandlinetools-linux-*_latest.zip \
    && rm commandlinetools-linux-*_latest.zip \
    && mv cmdline-tools latest \
    && yes | sdkmanager --licenses > /dev/null 2>&1 \
    && sdkmanager "platform-tools" "platforms;android-34" "build-tools;34.0.0" > /dev/null 2>&1 \
    && chmod +x $ANDROID_HOME/build-tools/34.0.0/*

# Verify aapt2 works
RUN $ANDROID_HOME/build-tools/34.0.0/aapt2 version || echo "⚠️ aapt2 test failed"

# Install Gradle
RUN wget -q https://services.gradle.org/distributions/gradle-8.5-bin.zip \
    && unzip -q gradle-8.5-bin.zip -d /opt/ \
    && rm gradle-8.5-bin.zip
ENV PATH=$PATH:/opt/gradle-8.5/bin

# Copy app files
COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 8080

CMD ["node", "server.js"]
