FROM node:18

# تثبيت Java والأدوات
RUN apt-get update && apt-get install -y \
    openjdk-17-jdk \
    wget \
    unzip \
    zip \
    && rm -rf /var/lib/apt/lists/*

# تثبيت Android SDK
ENV ANDROID_HOME=/opt/android-sdk
ENV ANDROID_SDK_ROOT=/opt/android-sdk
ENV PATH=$PATH:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools

RUN mkdir -p $ANDROID_HOME && cd $ANDROID_HOME \
    && wget https://dl.google.com/android/repository/commandlinetools-linux-9477386_latest.zip \
    && unzip commandlinetools-linux-*_latest.zip \
    && rm commandlinetools-linux-*_latest.zip \
    && mkdir -p cmdline-tools/latest \
    && mv cmdline-tools/bin cmdline-tools/latest/ \
    && mv cmdline-tools/lib cmdline-tools/latest/ \
    && yes | sdkmanager --licenses \
    && sdkmanager "platform-tools" "platforms;android-34" "build-tools;34.0.0"

# تثبيت Gradle
RUN wget https://services.gradle.org/distributions/gradle-8.5-bin.zip \
    && unzip gradle-8.5-bin.zip -d /opt/ \
    && rm gradle-8.5-bin.zip
ENV PATH=$PATH:/opt/gradle-8.5/bin

WORKDIR /app

COPY package.json ./
RUN npm install

COPY . .

EXPOSE 8080

CMD ["npm", "start"]
