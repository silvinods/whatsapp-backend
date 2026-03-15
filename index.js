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
let restartTimer = null;

console.log('Iniciando bot...');

function startBot() {
    if (client || starting) return;
    starting = true;
    botReady = false;
    currentQR = null;

    if (restartTimer) {
        clearTimeout(restartTimer);
        restartTimer = null;
    }

    client = new Client({
        authStrategy: new LocalAuth(),
        puppeteer: {
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--no-zygote',
                '--single-process',
            ],
        },
    });

    client.on('qr', async (qr) => {
        console.log('QR Code gerado. Acesse /qr para escanear.');
        try {
            currentQR = await qrcode.toDataURL(qr);
        } catch (err) {
            console.error('Erro ao gerar QR:', err);
        }
    });

    client.on('ready', () => {
        console.log('Bot pronto!');
        botReady = true;
        currentQR = null;
        starting = false;
    });

    client.on('auth_failure', (msg) => {
        console.error('Falha autenticação:', msg);
        cleanupAndRestart();
    });

    client.on('disconnected', (reason) => {
        console.log('Desconectado:', reason);
        cleanupAndRestart();
    });

    client.on('message', async (msg) => {
        if (msg.from.includes('@g.us')) return;
        const texto = msg.body.toLowerCase();
        if (texto === 'oi') msg.reply('Olá! Atendimento automático.');
        if (texto === 'menu') msg.reply('1 - Suporte\n2 - Horários');
    });

    client.initialize().catch((err) => {
        console.error('Erro na inicialização:', err);
        cleanupAndRestart();
    });
}

function cleanupAndRestart() {
    botReady = false;
    starting = false;
    if (client) {
        client.destroy().catch(() => {});
        client = null;
    }
    scheduleRestart();
}

function scheduleRestart() {
    if (restartTimer) return;
    const delay = 30000;
    console.log(`Reiniciando em ${delay/1000}s...`);
    restartTimer = setTimeout(() => {
        restartTimer = null;
        startBot();
    }, delay);
}

app.get('/status', (req, res) => {
    res.json({ ready: botReady, qr: !!currentQR, starting });
});

app.get('/qr', (req, res) => {
    if (currentQR) {
        res.send(`<html><body style="background:#000;display:flex;justify-content:center;align-items:center;height:100vh;">
            <div style="background:#fff;padding:20px;border-radius:10px;text-align:center;">
                <h2>Escaneie o QR Code</h2>
                <img src="${currentQR}" style="width:300px;">
                <p>Escaneie rápido!</p>
            </div>
        </body></html>`);
    } else {
        res.status(404).send('QR não disponível');
    }
});

app.post('/restart', (req, res) => {
    if (client) {
        client.destroy().catch(() => {});
        client = null;
    }
    botReady = false;
    currentQR = null;
    starting = false;
    startBot();
    res.json({ message: 'Reiniciando' });
});

app.get('/', (req, res) => res.send('Bot ativo'));

const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Servidor na porta ${PORT}`);
    startBot();
});