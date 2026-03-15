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

    // Caminho padrão que o Railway usa ao instalar via NIXPACKS_PKGS
    const chromePath = '/usr/bin/google-chrome-stable';

    client = new Client({
        authStrategy: new LocalAuth(),
        puppeteer: {
            headless: true,
            executablePath: fs.existsSync(chromePath) ? chromePath : undefined,
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
        console.error("ERRO CRITICO Silvino:", err);
        starting = false;
    });

    client.on('qr', async (qr) => {
        console.log("QR CODE GERADO - Acesse /qr");
        currentQR = await qrcode.toDataURL(qr);
    });

    client.on('ready', () => {
        console.log("BOT PRONTO E CONECTADO Silvino!");
        botReady = true;
        currentQR = null;
        starting = false;
    });

    client.on('message', async (msg) => {
        if (msg.from.includes('@g.us')) return;
        const texto = msg.body.toLowerCase();
        if (texto === 'oi') msg.reply('Olá! Atendimento automático Silvino.');
        if (texto === 'menu') msg.reply('1 - Suporte\n2 - Horários');
    });
}

// Rotas de Monitoramento
app.get('/status', (req, res) => {
    res.json({ ready: botReady, qr: !!currentQR, starting: starting });
});

app.get('/qr', (req, res) => {
    if (currentQR) {
        res.send(`<html><body style="background:#000;display:flex;justify-content:center;align-items:center;height:100vh;">
            <div style="background:#fff;padding:20px;border-radius:10px;text-align:center;font-family:sans-serif;">
                <h2>Escaneie o QR Code</h2>
                <img src="${currentQR}" style="width:300px;">
                <p>O QR Code expira rápido, escaneie logo!</p>
            </div>
        </body></html>`);
    } else {
        res.send("QR Code ainda nao gerado. Aguarde 1 minuto e de F5.");
    }
});

app.get('/', (req, res) => res.send("Servidor Silvino Soares Ativo na Porta 8080"));

const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Servidor rodando na porta ${PORT} - Silvino`);
    startBot();
});