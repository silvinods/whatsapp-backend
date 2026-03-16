const { default: makeWASocket, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const express = require('express');
const qrcode = require('qrcode');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 10000;
const SESSION_DIR = path.join(__dirname, 'auth_info');

// Garante que a pasta de sessão existe
if (!fs.existsSync(SESSION_DIR)) {
    fs.mkdirSync(SESSION_DIR, { recursive: true });
}

let currentQR = null;
let sock = null;

// Função para conectar ao WhatsApp
async function connectToWhatsApp() {
    try {
        const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
        
        sock = makeWASocket({
            auth: state,
            printQRInTerminal: false,
            browser: ['Bot', 'Chrome', '1.0.0']
        });

        sock.ev.on('connection.update', async (update) => {
            const { qr, connection } = update;
            
            if (qr) {
                console.log('✅ QR Code gerado!');
                currentQR = await qrcode.toDataURL(qr);
            }
            
            if (connection === 'open') {
                console.log('✅ Conectado ao WhatsApp!');
                currentQR = null;
            }
        });

        sock.ev.on('creds.update', saveCreds);
        
    } catch (err) {
        console.error('Erro na conexão:', err);
        setTimeout(connectToWhatsApp, 5000);
    }
}

// Rota para exibir o QR Code
app.get('/qr', (req, res) => {
    if (currentQR) {
        res.send(`
            <html>
                <body style="display:flex;justify-content:center;align-items:center;height:100vh;">
                    <img src="${currentQR}" style="width:300px;">
                </body>
            </html>
        `);
    } else {
        res.send('Aguardando QR Code... (atualize a página)');
    }
});

// Rota de status
app.get('/status', (req, res) => {
    res.json({ 
        qr: !!currentQR,
        connected: sock?.user ? true : false 
    });
});

// Inicia o servidor
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
    connectToWhatsApp();
});