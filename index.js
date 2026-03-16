const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const express = require('express');
const cors = require('cors');
const qrcode = require('qrcode');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 10000;
const SESSION_DIR = path.join(__dirname, 'auth_info');

// Garante que a pasta existe
if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR, { recursive: true });

let sock = null;
let currentQR = null;
let botReady = false;

// Tratamento de erros global
process.on('uncaughtException', (err) => console.error('Exceção não capturada:', err));
process.on('unhandledRejection', (err) => console.error('Rejeição não tratada:', err));

async function connectWhatsApp() {
    try {
        const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
        sock = makeWASocket({
            auth: state,
            printQRInTerminal: false,
            browser: ['Bot Automático', 'Chrome', '1.0.0']
        });

        sock.ev.on('error', (err) => console.error('Erro interno (ignorado):', err));

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;
            if (qr) {
                console.log('QR gerado');
                currentQR = await qrcode.toDataURL(qr);
                botReady = false;
            }
            if (connection === 'close') {
                const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
                botReady = false;
                currentQR = null;
                if (shouldReconnect) setTimeout(connectWhatsApp, 5000);
            } else if (connection === 'open') {
                console.log('Bot conectado!');
                botReady = true;
                currentQR = null;
            }
        });

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('messages.upsert', async ({ messages }) => {
            try {
                const msg = messages[0];
                if (!msg.message || msg.key.fromMe) return;
                if (msg.key.remoteJid.endsWith('@g.us')) return;

                const text = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
                const from = msg.key.remoteJid;

                console.log(`Mensagem de ${from}: "${text}"`);

                // Responde automaticamente a qualquer mensagem (teste)
                const resposta = `Olá! Recebi sua mensagem: "${text}". Em breve responderei.`;
                await sock.sendMessage(from, { text: resposta });
                console.log(`Resposta enviada para ${from}`);
            } catch (err) {
                console.error('Erro ao processar mensagem:', err);
            }
        });
    } catch (err) {
        console.error('Erro na conexão:', err);
        setTimeout(connectWhatsApp, 10000);
    }
}

// Rota de status
app.get('/status', (req, res) => res.json({ ready: botReady, qr: !!currentQR }));

// Rota do QR
app.get('/qr', (req, res) => {
    if (currentQR) {
        res.send(`<html><body style="background:#000;display:flex;justify-content:center;align-items:center;"><div style="background:#fff;padding:20px;"><img src="${currentQR}" style="width:300px;"></div></body></html>`);
    } else {
        res.status(404).send('QR não disponível');
    }
});

// Rota para resetar a sessão (use com cuidado)
app.get('/reset', (req, res) => {
    const key = req.query.key;
    if (key !== '123') { // chave simples, mude se quiser
        return res.status(403).send('Chave inválida');
    }
    try {
        if (fs.existsSync(SESSION_DIR)) {
            fs.rmSync(SESSION_DIR, { recursive: true, force: true });
            console.log('Sessão removida');
        }
        if (sock) {
            sock.end();
            sock = null;
        }
        botReady = false;
        currentQR = null;
        res.send('Sessão resetada. Acesse /qr para escanear novamente.');
        // Reinicia o bot após 2 segundos
        setTimeout(connectWhatsApp, 2000);
    } catch (err) {
        console.error('Erro ao resetar:', err);
        res.status(500).send('Erro ao resetar');
    }
});

app.get('/', (req, res) => res.send('Bot rodando. Acesse /qr para ver o QR.'));

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Servidor na porta ${PORT}`);
    connectWhatsApp();
});