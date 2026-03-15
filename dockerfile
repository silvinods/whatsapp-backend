FROM node:18-slim

# Instala apenas o Chromium (sem recomendações) para reduzir o tamanho
RUN apt-get update && apt-get install -y chromium --no-install-recommends && rm -rf /var/lib/apt/lists/*

# Configura o Puppeteer para usar o Chromium do sistema
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app

# Copia os arquivos de dependências primeiro (aproveita cache)
COPY package*.json ./

# Instala as dependências do Node (usando npm install para ser mais rápido)
RUN npm install

# Copia o restante do código
COPY . .

EXPOSE 8080

CMD ["npm", "start"]