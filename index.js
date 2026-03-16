const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const express = require('express');
const qrcode = require('qrcode');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 10000;
const SESSION_DIR = path.join(__dirname, 'auth_info');
const ADMIN_PASSWORD = '123456'; // Altere para uma senha segura

if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR, { recursive: true });

let sock = null;
let currentQR = null;
let botAtivo = true;

// Dicionário de respostas (chave pode ser string ou regex)
const respostas = [
    // Saudações
    { chave: /^(oi|olá|ola|oie|oii|oiii|hey|hi|hello)$/i, resposta: 'Olá! Como posso ajudar? 😊' },
    { chave: /^bom dia$/i, resposta: 'Bom dia! Em que posso ser útil? ☀️' },
    { chave: /^boa tarde$/i, resposta: 'Boa tarde! Como posso ajudar? 🌤️' },
    { chave: /^boa noite$/i, resposta: 'Boa noite! Precisa de algo? 🌙' },
    
    // Perguntas sobre localização/presença
    { chave: /(nino|tá em casa|ta em casa|está em casa|ta por onde|tá por onde|vem aqui|onde vc tá|onde você está)/i, 
      resposta: 'Olá! O Silvino não está no momento, mas em breve retornará. Deixe sua mensagem que assim que ele ver, responderá. 📝' },
    
    // Carinhosos
    { chave: /^(oi meu anjo|oi meu amor|oi querido|oi lindo|oi gato)/i, 
      resposta: 'Olá! 😊 O Silvino não está disponível agora, mas sua mensagem será entregue a ele.' },
    
    // Informações úteis
    { chave: /menu/i, resposta: '📋 *Menu de opções*\n1 - Informações\n2 - Suporte\n3 - Horários\nDigite o número da opção desejada.' },
    { chave: /info|informações|informacao/i, resposta: 'Somos uma empresa de tecnologia especializada em soluções digitais.' },
    { chave: /suporte|support/i, resposta: 'Para suporte, envie um email para suporte@exemplo.com ou aguarde, em breve retornaremos.' },
    { chave: /horario|horários|horarios/i, resposta: 'Atendimento de segunda a sexta, das 9h às 18h. Fins de semana e feriados, apenas mensagens serão respondidas no próximo dia útil.' },
    { chave: /contato|telefone|email|whatsapp/i, resposta: '📞 Contato: (89) 98126-2767\n📧 Email: silvino@exemplo.com' },
    { chave: /ajuda|help|comandos/i, resposta: 'Comandos disponíveis: oi, bom dia, boa tarde, boa noite, menu, info, suporte, horarios, contato, tchau, obrigado.' },
    { chave: /tchau|tchau|até mais|ate mais|bye|goodbye/i, resposta: 'Até logo! Se precisar, estou aqui. 👋' },
    { chave: /obrigado|obrigada|valeu|thanks/i, resposta: 'Por nada! Estou à disposição. 😄' },
    
    // Resposta padrão para mensagens não reconhecidas
    { chave: /.*/, resposta: 'Desculpe, não entendi. Deixe sua mensagem que o Silvino assim que possível responderá. Para ver os comandos, digite "ajuda".' }
];

// Função para obter o número do bot
function getBotNumber() {
    if (sock?.user?.id) {
        return sock.user.id.split(':')[0] + '@s.whatsapp.net';
    }
    return null;
}

// Verifica se o remetente é o dono (próprio número do bot)
function isOwner(from) {
    const botNumber = getBotNumber();
    return botNumber && from === botNumber;
}

// Função para encontrar a resposta apropriada
function encontrarResposta(texto) {
    for (let item of respostas) {
        if (item.chave.test(texto)) {
            return item.resposta;
        }
    }
    // Nunca deve chegar aqui porque o último item é /.*/
    return 'Desculpe, não entendi. Deixe sua mensagem que o Silvino assim que possível responderá.';
}

async function connectWhatsApp() {
    try {
        const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
        sock = makeWASocket({
            auth: state,
            printQRInTerminal: false,
            browser: ['Bot Silvino', 'Chrome', '1.0.0'],
            syncFullHistory: false,
            markOnlineOnConnect: true
        });

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;
            if (qr) {
                console.log('📲 QR Code gerado!');
                currentQR = await qrcode.toDataURL(qr);
            }
            if (connection === 'close') {
                const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
                console.log('❌ Conexão fechada. Reconectar?', shouldReconnect);
                currentQR = null;
                if (shouldReconnect) setTimeout(connectWhatsApp, 5000);
            } else if (connection === 'open') {
                console.log('✅ Bot pronto e conectado!');
                console.log('📞 Número do bot:', getBotNumber());
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

                console.log(`📩 Mensagem de ${from}: "${text}"`);

                // Se bot desativado, só responde ao dono
                if (!botAtivo && !isOwner(from)) {
                    console.log('🤖 Bot desativado, ignorando mensagem');
                    return;
                }

                const lowerText = text.toLowerCase().trim();

                // Comandos de admin (apenas do dono)
                if (isOwner(from)) {
                    if (lowerText === '!desligar' || lowerText === '!off') {
                        botAtivo = false;
                        await sock.sendMessage(from, { text: '🔴 Bot desativado. Não responderei a ninguém até que seja reativado.' });
                        console.log('🔴 Bot desativado pelo dono');
                        return;
                    }
                    if (lowerText === '!ligar' || lowerText === '!on') {
                        botAtivo = true;
                        await sock.sendMessage(from, { text: '🟢 Bot ativado. Responderei a todos.' });
                        console.log('🟢 Bot ativado pelo dono');
                        return;
                    }
                }

                // Encontra a resposta adequada
                const resposta = encontrarResposta(text);
                await sock.sendMessage(from, { text: resposta });
                console.log(`✅ Resposta enviada para ${from}`);

            } catch (err) {
                console.error('❌ Erro ao processar mensagem:', err);
            }
        });

    } catch (err) {
        console.error('💥 Erro fatal na conexão:', err);
        setTimeout(connectWhatsApp, 10000);
    }
}

// Rotas
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

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
    connectWhatsApp();
});