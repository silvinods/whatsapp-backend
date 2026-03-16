const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const express = require('express');
const qrcode = require('qrcode');
const fs = require('fs');
const path = require('path');
const { Boom } = require('@hapi/boom');

const app = express();
const PORT = process.env.PORT || 10000;
const SESSION_DIR = path.join(__dirname, 'auth_info');
const ADMIN_PASSWORD = '123456'; // Senha para comandos do dono

if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR, { recursive: true });

let sock = null;
let currentQR = null;
let botAtivo = true;

// ========== CONFIGURAÇÃO DAS RESPOSTAS ==========
const respostas = {
    'oi': 'Olá! Como posso ajudar?',
    'ola': 'Olá! Como posso ajudar?',
    'nino': 'Olá! O Silvino não está no momento, mas deixe sua mensagem que ele retorna assim que possível.',
    'esta em casa': 'O Silvino não está em casa agora. Deixe seu recado!',
    'ta por onde': 'Ele não está por perto no momento. Em que posso ajudar?',
    'vem aqui': 'Infelizmente ele não pode ir agora. Deixe sua mensagem.',
    'oi meu anjo': 'Olá! 😊 Como posso ajudar você?',
    'bom dia': 'Bom dia! Em que posso ser útil?',
    'boa tarde': 'Boa tarde! Como posso ajudar?',
    'boa noite': 'Boa noite! Em que posso auxiliar?',
    'menu': '📋 *Menu de opções*\n1 - Informações\n2 - Suporte\n3 - Horários\nDigite o número da opção desejada.',
    'info': 'Somos uma empresa de tecnologia...',
    'suporte': 'Para suporte, entre em contato com nosso time.',
    'horarios': 'Atendimento de segunda a sexta, das 9h às 18h.',
    'contato': 'Nosso email: contato@exemplo.com',
    'ajuda': 'Comandos disponíveis: oi, menu, info, suporte, horarios, contato',
    'tchau': 'Até logo! Se precisar, estou aqui.',
    'obrigado': 'Por nada! Estou à disposição.'
};

// ========== FUNÇÃO PARA OBTER O NÚMERO DO BOT ==========
function getBotNumber() {
    return sock?.user?.id ? sock.user.id.split(':')[0] + '@s.whatsapp.net' : null;
}

// ========== FUNÇÃO PARA ENVIAR MENSAGEM COM RETRY ==========
async function sendMessageWithRetry(to, text, retries = 2) {
    for (let i = 0; i < retries; i++) {
        try {
            const sent = await sock.sendMessage(to, { text });
            console.log(`✅ Mensagem enviada com sucesso! ID: ${sent.key.id}`);
            return true;
        } catch (err) {
            console.log(`⚠️ Tentativa ${i+1} falhou: ${err.message}`);
            if (i === retries - 1) throw err;
            await new Promise(resolve => setTimeout(resolve, 2000)); // espera 2s antes de tentar de novo
        }
    }
    return false;
}

// ========== FUNÇÃO PRINCIPAL DE CONEXÃO ==========
async function connectWhatsApp() {
    try {
        // Busca a versão mais recente do Baileys
        const { version, isLatest } = await fetchLatestBaileysVersion();
        console.log(`📦 Versão do Baileys: ${version.join('.')} (última: ${isLatest})`);

        const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);

        sock = makeWASocket({
            version,
            auth: state,
            printQRInTerminal: false,
            browser: ['Bot Silvino', 'Chrome', '1.0.0'],
            syncFullHistory: false,
            markOnlineOnConnect: true,
            defaultQueryTimeoutMs: 60000,
        });

        // Evento de atualização de conexão
        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;

            if (qr) {
                console.log('📲 QR Code gerado!');
                currentQR = await qrcode.toDataURL(qr);
            }

            if (connection === 'close') {
                const shouldReconnect = (lastDisconnect?.error instanceof Boom) ? 
                    lastDisconnect.error.output.statusCode !== DisconnectReason.loggedOut : true;
                console.log('❌ Conexão fechada. Reconectar?', shouldReconnect);
                currentQR = null;
                if (shouldReconnect) {
                    setTimeout(connectWhatsApp, 5000);
                }
            } else if (connection === 'open') {
                console.log('✅ Bot pronto e conectado!');
                console.log('📞 Número do bot:', getBotNumber());
                currentQR = null;
            }
        });

        // Salvar credenciais
        sock.ev.on('creds.update', saveCreds);

        // Processamento de mensagens
        sock.ev.on('messages.upsert', async ({ messages }) => {
            try {
                const msg = messages[0];
                if (!msg.message || msg.key.fromMe) return; // ignora próprias mensagens
                if (msg.key.remoteJid.endsWith('@g.us')) return; // ignora grupos

                const text = msg.message.conversation ||
                            msg.message.extendedTextMessage?.text ||
                            msg.message.imageMessage?.caption ||
                            '';
                const from = msg.key.remoteJid;

                console.log(`📩 Mensagem de ${from}: "${text}"`);

                // Se o bot estiver desativado, só responde ao dono
                const isOwner = from === getBotNumber();
                if (!botAtivo && !isOwner) {
                    console.log('🤖 Bot desativado, ignorando mensagem');
                    return;
                }

                const lowerText = text.toLowerCase().trim();

                // ===== COMANDOS DO DONO =====
                if (isOwner) {
                    if (lowerText === '!desligar' || lowerText === '!off') {
                        botAtivo = false;
                        await sendMessageWithRetry(from, '🔴 Bot desativado. Não responderei a ninguém até que seja reativado.');
                        console.log('🔴 Bot desativado pelo dono');
                        return;
                    }
                    if (lowerText === '!ligar' || lowerText === '!on') {
                        botAtivo = true;
                        await sendMessageWithRetry(from, '🟢 Bot ativado. Responderei a todos.');
                        console.log('🟢 Bot ativado pelo dono');
                        return;
                    }
                }

                // Se não for comando do dono e o bot estiver ativo, processa respostas
                if (botAtivo) {
                    // Verifica se a mensagem corresponde a alguma chave
                    let resposta = null;
                    for (const [key, value] of Object.entries(respostas)) {
                        if (lowerText.includes(key)) {
                            resposta = value;
                            break;
                        }
                    }

                    // Se não encontrou, usa mensagem padrão
                    if (!resposta) {
                        resposta = 'Desculpe, não entendi. Digite "ajuda" para ver os comandos disponíveis.';
                    }

                    // Envia a resposta com retry
                    await sendMessageWithRetry(from, resposta);
                }
            } catch (err) {
                console.error('❌ Erro ao processar mensagem:', err);
            }
        });

    } catch (err) {
        console.error('💥 Erro fatal na conexão:', err);
        setTimeout(connectWhatsApp, 10000);
    }
}

// ========== ROTAS DO EXPRESS ==========
app.get('/qr', (req, res) => {
    if (currentQR) {
        res.send(`<html><body style="display:flex;justify-content:center;align-items:center;height:100vh;">
            <img src="${currentQR}" style="width:300px;">
        </body></html>`);
    } else {
        res.status(404).send('QR Code não disponível. Aguarde...');
    }
});

app.get('/status', (req, res) => {
    res.json({
        qr: !!currentQR,
        connected: sock?.user ? true : false,
        botAtivo,
        numeroBot: getBotNumber()
    });
});

app.get('/', (req, res) => {
    res.send('✅ Bot WhatsApp rodando. Acesse /qr para conectar e /status para ver estado.');
});

// ========== INICIALIZAÇÃO ==========
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
    connectWhatsApp();
});