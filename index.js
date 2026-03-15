const { Client, LocalAuth } = require('whatsapp-web.js');
const express = require('express');
const cors = require('cors');
const qrcode = require('qrcode');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.json());

let client = null;
let currentQR = null;
let botReady = false;
let starting = false;

function startBot() {
    if (client || starting) return;
    starting = true;

    console.log("--- INICIANDO BOT SILVINO ---");

    // Tenta encontrar o Google Chrome nos caminhos comuns do Railway/Linux
    const paths = ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium-browser'];
    const executablePath = paths.find(path => fs.existsSync(path));

    console.log(executablePath ? `Caminho do Chrome encontrado: ${executablePath}` : "Chrome não encontrado, tentando padrão...");

    client = new Client({
        authStrategy: new LocalAuth(),
        puppeteer: {
            headless: true,
            executablePath: executablePath || undefined,
            args: [
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-dev-shm-usage",
                "--disable-gpu",
                "--no-zygote",
                "--single-process"
            ]
        }
    });

    client.initialize().catch(err => {
        console.error("ERRO AO INICIAR CLIENTE:", err);
        starting = false;
    });

    client.on('qr', async (qr) => {
        console.log("QR CODE GERADO - Acesse a rota /qr");
        currentQR = await qrcode.toDataURL(qr);
    });

    client.on('ready', () => {
        console.log("BOT PRONTO E CONECTADO!");
        botReady = true;
        currentQR = null;
        starting = false;
    });

    client.on('message', async (msg) => {
        if (msg.from.includes('@g.us')) return;
        if (msg.body.toLowerCase() === 'oi') msg.reply('Olá! Atendimento automático Silvino.');
        if (msg.body.toLowerCase() === 'menu') msg.reply('1 - Suporte\n2 - Horários');
    });
}

// Rotas de Monitoramento
app.get('/status', (req, res) => {
    res.json({ ready: botReady, qr: !!currentQR, starting: starting });
});

app.get('/qr', (req, res) => {
    if (currentQR) {
        res.send(`<html><body style="background:#000;display:flex;justify-content:center;align-items:center;height:100vh;"><img src="${currentQR}" style="border:10px solid white; width:300px;"></body></html>`);
    } else {
        res.send("QR Code ainda nao gerado. Aguarde 1 minuto e atualize.");
    }
});

app.get('/', (req, res) => res.send("Servidor Ativo Silvino"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor na porta ${PORT}`);
    startBot(); // Inicia o bot assim que o servidor liga
});