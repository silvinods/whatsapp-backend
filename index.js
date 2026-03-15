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

function startBot() {
    if (client || starting) return;
    starting = true;
    botReady = false;
    currentQR = null;

    console.log('🚀 Iniciando bot...');

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
                '--single-process'
            ]
        }
    });

    client.on('qr', async (qr) => {
        console.log('📲 QR Code gerado. Acesse /qr para escanear.');
        try {
            currentQR = await qrcode.toDataURL(qr);
        } catch (err) {
            console.error('Erro ao gerar QR:', err);
        }
    });

    client.on('ready', () => {
        console.log('✅ Bot pronto e conectado!');
        botReady = true;
        currentQR = null;
        starting = false;
    });

    client.on('authenticated', () => {
        console.log('🔐 Autenticado com sucesso!');
    });

    client.on('auth_failure', (msg) => {
        console.error('❌ Falha na autenticação:', msg);
        botReady = false;
        starting = false;
        client = null;
        scheduleRestart();
    });

    client.on('disconnected', (reason) => {
        console.log('⚠️ Cliente desconectado:', reason);
        botReady = false;
        starting = false;
        client = null;
        scheduleRestart();
    });

    client.on('message', async (msg) => {
        if (msg.from.includes('@g.us')) return;
        const texto = msg.body.toLowerCase();
        if (texto === 'oi') msg.reply('Olá! Atendimento automático Silvino.');
        if (texto === 'menu') msg.reply('1 - Suporte\n2 - Horários');
    });

    client.initialize().catch((err) => {
        console.error('💥 Erro crítico na inicialização:', err);
        botReady = false;
        starting = false;
        client = null;
        scheduleRestart();
    });
}

function scheduleRestart() {
    if (restartTimer) return;
    const delay = 30000;
    console.log(`⏳ Reiniciando o bot em ${delay / 1000} segundos...`);
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
        res.send(`<html>
            <head><meta charset="UTF-8"></head>
            <body style="background:#000;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;">
                <div style="background:#fff;padding:20px;border-radius:10px;text-align:center;font-family:sans-serif;">
                    <h2>Escaneie o QR Code</h2>
                    <img src="${currentQR}" style="width:300px;height:300px;" alt="QR Code">
                    <p>O QR Code expira rápido, escaneie logo!</p>
                </div>
            </body>
        </html>`);
    } else {
        res.status(404).send('QR Code ainda não gerado. Aguarde e atualize a página.');
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
    res.json({ message: 'Reinicialização solicitada.' });
});

app.get('/', (req, res) => {
    res.send('Servidor Silvino Soares Ativo. Acesse /status para ver o estado.');
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🌐 Servidor rodando na porta ${PORT}`);
    startBot();
});