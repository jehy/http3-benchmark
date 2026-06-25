FROM node:26-slim

# Устанавливаем зависимости для Puppeteer и Chromium
RUN apt-get update && apt-get install -y \
    wget \
    gnupg \
    ca-certificates \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libc6 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libexpat1 \
    libfontconfig1 \
    libgbm1 \
    libgcc1 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libstdc++6 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxi6 \
    libxrandr2 \
    libxrender1 \
    libxss1 \
    libxtst6 \
    lsb-release \
    xdg-utils \
    libatspi2.0-0 \
    libdrm2 \
    libxkbcommon0 \
    libxshmfence1 \
    chromium \
    unzip \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Рабочая директория
WORKDIR /app

# Копируем package.json
COPY package*.json ./

# Устанавливаем переменные для Chrome (решение проблемы crashpad_handler)
ENV XDG_CONFIG_HOME=/tmp/.chromium
ENV XDG_CACHE_HOME=/tmp/.chromium
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
# Дополнительная опция для Chrome, чтобы отключить crashpad
ENV CHROME_FLAGS="--no-sandbox --disable-dev-shm-usage --disable-crash-reporter"

# Устанавливаем зависимости
RUN npm ci --only=production && npm cache clean --force

# Копируем исходный код
COPY . .

# Создаем директорию для результатов и устанавливаем права
RUN mkdir -p /app/benchmark-results && \
    mkdir -p /tmp/.chromium && \
    chmod 777 /tmp/.chromium

# Создаем непривилегированного пользователя
RUN groupadd -r puppeteer && \
    useradd -r -g puppeteer -G audio,video puppeteer && \
    chown -R puppeteer:puppeteer /app && \
    chown -R puppeteer:puppeteer /tmp/.chromium

# Переключаемся на него
USER puppeteer

# Запуск скрипта
ENTRYPOINT ["node", "benchmark.ts"]
CMD ["--help"]