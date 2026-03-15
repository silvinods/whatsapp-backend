FROM node:18-slim

# Instala apenas o Chromium e dependências mínimas (sem recommends)
RUN apt-get update && apt-get install -y \
    chromium \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Define o caminho do Chromium para o Puppeteer
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

WORKDIR /app

# Copia os arquivos de dependências primeiro (aproveita cache)
COPY package*.json ./
RUN npm install

# Copia o resto do código
COPY . .

EXPOSE 8080

CMD ["npm", "start"]