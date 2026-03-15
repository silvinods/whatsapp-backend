const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const express = require('express');
const cors = require('cors');
const qrcode = require('qrcode');

const app = express();
app.use(cors());
app.use(express.json());

let sock = null;
let currentQR = null;
let botReady = false;

async function connectWhatsApp() {
    console.log('Iniciando conexão WhatsApp...');
    const { state, saveCreds } = await useMultiFileAuthState('auth_info'); // pasta local
    
    sock = makeWASocket({
        auth: state,
        printQRInTerminal: false, // vamos exibir via rota
        browser: ['Bot Simples', 'Chrome', '1.0.0']
    });

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            console.log('QR recebido, gerando imagem...');
            try {
                currentQR = await qrcode.toDataURL(qr);
            } catch (err) {
                console.error('Erro ao gerar QR:', err);
            }
        }
        
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Conexão fechada, reconectar?', shouldReconnect);
            botReady = false;
            currentQR = null;
            if (shouldReconnect) {
                console.log('Tentando reconectar...');
                connectWhatsApp();
            } else {
                console.log('Deslogado permanentemente, aguardando novo QR...');
                // Se deslogou, mantém sock = null e QR será gerado na nova conexão
            }
        } else if (connection === 'open') {
            console.log('✅ Bot conectado!');
            botReady = true;
            currentQR = null; // limpa QR após conectar
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
            <head><meta charset="UTF-8"></head>
            <body style="background:#000;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;">
                <div style="background:#fff;padding:20px;border-radius:10px;text-align:center;">
                    <h2>Escaneie o QR Code</h2>
                    <img src="${currentQR}" style="width:300px;height:300px;" alt="QR Code">
                </div>
            </body>
        </html>`);
    } else {
        res.status(404).send('QR Code não gerado ainda. Aguarde e tente novamente.');
    }
});

app.get('/', (req, res) => {
    res.send('Bot Simples - Acesse /qr para escanear ou /status para ver o estado.');
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Servidor rodando na porta ${PORT}`);
    connectWhatsApp();
});