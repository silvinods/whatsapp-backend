const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const express = require('express');
const cors = require('cors');
const qrcode = require('qrcode');
const qrcodeTerminal = require('qrcode-terminal');

const app = express();
app.use(cors());
app.use(express.json());

let sock = null;
let currentQR = null;
let botReady = false;

async function connectWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    
    sock = makeWASocket({
        auth: state,
        printQRInTerminal: false, // vamos gerar QR via código
        browser: ['Bot Simples', 'Chrome', '1.0.0']
    });

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            console.log('QR recebido, gerando imagem...');
            currentQR = await qrcode.toDataURL(qr);
            qrcodeTerminal.generate(qr, { small: true }); // opcional, aparece no log
        }
        
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Conexão fechada, reconectando?', shouldReconnect);
            botReady = false;
            currentQR = null;
            if (shouldReconnect) connectWhatsApp();
        } else if (connection === 'open') {
            console.log('✅ Bot conectado!');
            botReady = true;
            currentQR = null;
        }
    });

    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return;
        if (msg.key.remoteJid.endsWith('@g.us')) return; // ignora grupos

        const text = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
        const from = msg.key.remoteJid;

        if (text.toLowerCase() === 'oi') {
            await sock.sendMessage(from, { text: 'Olá! Atendimento automático.' });
        }
        if (text.toLowerCase() === 'menu') {
            await sock.sendMessage(from, { text: '1 - Suporte\n2 - Horários' });
        }
    });

    sock.ev.on('creds.update', saveCreds);
}

// Rotas
app.get('/status', (req, res) => {
    res.json({ ready: botReady, qr: !!currentQR });
});

app.get('/qr', (req, res) => {
    if (currentQR) {
        res.send(`<html>
            <body style="background:#000;display:flex;justify-content:center;align-items:center;height:100vh;">
                <div style="background:#fff;padding:20px;border-radius:10px;">
                    <h2>Escaneie o QR Code</h2>
                    <img src="${currentQR}" style="width:300px;">
                </div>
            </body>
        </html>`);
    } else {
        res.send('QR Code não gerado ainda. Aguarde...');
    }
});

app.get('/', (req, res) => {
    res.send('Bot Simples - Acesse /qr para escanear');
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Servidor rodando na porta ${PORT}`);
    connectWhatsApp();
});