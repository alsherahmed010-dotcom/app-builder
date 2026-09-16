FROM node:18

WORKDIR /app

# تثبيت Java و Android SDK
RUN apt-get update && apt-get install -y \
    openjdk-17-jdk \
    wget \
    unzip \
    zip \
    && rm -rf /var/lib/apt/lists/*

# تثبيت Gradle
RUN wget https://services.gradle.org/distributions/gradle-8.5-bin.zip \
    && unzip gradle-8.5-bin.zip -d /opt/ \
    && rm gradle-8.5-bin.zip

# تثبيت Android SDK
RUN mkdir -p /opt/android-sdk && cd /opt/android-sdk \
    && wget https://dl.google.com/android/repository/commandlinetools-linux-9477386_latest.zip \
    && unzip commandlinetools-linux-*_latest.zip \
    && rm commandlinetools-linux-*_latest.zip \
    && mkdir -p cmdline-tools/latest \
    && mv cmdline-tools/bin cmdline-tools/latest/ \
    && mv cmdline-tools/lib cmdline-tools/latest/ \
    && yes | sdkmanager --licenses \
    && sdkmanager "platform-tools" "platforms;android-34" "build-tools;34.0.0"

ENV ANDROID_HOME=/opt/android-sdk
ENV PATH=$PATH:$ANDROID_HOME/platform-tools:$ANDROID_HOME/build-tools/34.0.0

COPY package.json ./
RUN npm install

COPY . .

EXPOSE 8080

CMD ["node", "server.js"]
