const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const express = require('express');
const cors = require('cors');
const qrcode = require('qrcode');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

let sock = null;
let currentQR = null;
let botReady = false;
let connectionAttempts = 0;

// Função para conectar ao WhatsApp
async function connectWhatsApp() {
    try {
        connectionAttempts++;
        console.log(`🔄 Tentativa de conexão #${connectionAttempts}...`);

        // Pasta de autenticação - no Render, é efêmera, mas ok
        const authDir = path.join(__dirname, 'auth_info');
        if (!fs.existsSync(authDir)) {
            fs.mkdirSync(authDir, { recursive: true });
        }

        const { state, saveCreds } = await useMultiFileAuthState(authDir);
        
        sock = makeWASocket({
            auth: state,
            printQRInTerminal: true, // Vai aparecer no log do Render
            browser: ['Bot Render', 'Chrome', '1.0.0'],
            syncFullHistory: false,
            markOnlineOnConnect: true,
            generateHighQualityLinkPreview: false,
        });

        // Evento de atualização de conexão
        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;
            
            if (qr) {
                console.log('📲 QR Code gerado! Acesse a rota /qr para escanear.');
                try {
                    currentQR = await qrcode.toDataURL(qr);
                    console.log('QR Code convertido para imagem.');
                } catch (err) {
                    console.error('Erro ao gerar QR image:', err);
                }
            }
            
            if (connection === 'close') {
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
                console.log(`❌ Conexão fechada. Status code: ${statusCode}. Reconectar? ${shouldReconnect}`);
                
                botReady = false;
                currentQR = null;
                
                if (shouldReconnect) {
                    console.log('🔄 Tentando reconectar em 5 segundos...');
                    setTimeout(connectWhatsApp, 5000);
                } else {
                    console.log('🚫 Deslogado permanentemente. Apague a pasta auth_info e reinicie.');
                }
            } else if (connection === 'open') {
                console.log('✅ Bot conectado e pronto!');
                botReady = true;
                currentQR = null; // Limpa QR depois de conectar
            }
        });

        // Evento de mensagens
        sock.ev.on('messages.upsert', async (m) => {
            const msg = m.messages[0];
            if (!msg.message || msg.key.fromMe) return;
            if (msg.key.remoteJid.endsWith('@g.us')) return; // ignora grupos

            const text = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
            const from = msg.key.remoteJid;

            console.log(`📨 Mensagem de ${from}: ${text}`);

            if (text.toLowerCase() === 'oi') {
                await sock.sendMessage(from, { text: 'Olá! Atendimento automático.' });
            }
            if (text.toLowerCase() === 'menu') {
                await sock.sendMessage(from, { text: '1 - Suporte\n2 - Horários' });
            }
        });

        sock.ev.on('creds.update', saveCreds);

    } catch (error) {
        console.error('💥 Erro na função connectWhatsApp:', error);
        setTimeout(connectWhatsApp, 10000); // tenta novamente após 10s
    }
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
                    <p>O QR Code expira rápido, escaneie logo!</p>
                </div>
            </body>
        </html>`);
    } else {
        res.status(404).send('QR Code não gerado ainda. Aguarde e atualize a página. Verifique os logs para mais detalhes.');
    }
});

app.get('/', (req, res) => {
    res.send('Bot Simples - Acesse /qr para escanear');
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🌐 Servidor rodando na porta ${PORT}`);
    // Inicia a conexão
    connectWhatsApp();
});