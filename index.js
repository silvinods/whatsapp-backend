const { Client, LocalAuth } = require('whatsapp-web.js');
const express = require('express');
const cors = require('cors');
const qrcode = require('qrcode');

const app = express();
app.use(cors());
app.use(express.json());

let client = null;
let currentQR = null;
let botReady = false;
let starting = false;

function startBot() {
    if (client || starting) {
        console.log("Bot já está em processo de inicialização ou rodando.");
        return;
    }

    starting = true;
    console.log("Iniciando Puppeteer... Aguarde, isso pode levar até 1 minuto no Railway.");

    client = new Client({
        authStrategy: new LocalAuth(),
        puppeteer: {
            headless: true,
            // Importante: Usa a variável que configuramos no painel do Railway
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
            args: [
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-dev-shm-usage",
                "--disable-accelerated-2d-canvas",
                "--no-first-run",
                "--no-zygote",
                "--single-process",
                "--disable-gpu"
            ]
        }
    });

    // Captura erros de inicialização (como falta de Chrome)
    client.initialize().catch(err => {
        console.error("ERRO FATAL Silvino: Falha ao iniciar o navegador", err);
        starting = false;
        client = null;
    });

    client.on('qr', async (qr) => {
        console.log("QR RECEBIDO Silvino - Gerando imagem...");
        try {
            currentQR = await qrcode.toDataURL(qr);
        } catch (err) {
            console.error("Erro ao converter QR para DataURL", err);
        }
    });

    client.on('ready', () => {
        console.log("BOT PRONTO Silvino Soares");
        botReady = true;
        currentQR = null;
        starting = false;
    });

    client.on('message', async (message) => {
        if (message.from.includes('@g.us')) return;

        const texto = message.body.toLowerCase();

        if (texto === 'oi') {
            message.reply('Olá, atendimento automático.');
        }

        if (texto === 'menu') {
            message.reply('Menu:\n1 - Horário\n2 - Suporte\n3 - Atendente');
        }
    });
}

// Rota de Status
app.get('/status', (req, res) => {
    res.json({
        ready: botReady,
        qr: currentQR ? true : false,
        starting: starting
    });
});

// Rota do QR Code
app.get('/qr', (req, res) => {
    if (currentQR) {
        // Retorna a imagem diretamente para facilitar a leitura
        res.send(`<img src="${currentQR}" style="width:300px;">`);
    } else {
        res.send("QR Code ainda não disponível. Verifique o /status");
    }
});

// Rota Home
app.get('/', (req, res) => {
    res.send("Backend rodando Silvino - Verifique os logs do Railway");
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT} Silvino`);
    // Inicia o bot automaticamente
    startBot();
});