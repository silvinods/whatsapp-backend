const { Client, LocalAuth } = require('whatsapp-web.js');
const express = require('express');
const qrcode = require('qrcode');
const cors = require('cors');
const mongoose = require('mongoose');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 8080;
const MONGO_URI = process.env.MONGO_URI; // Obrigatório

if (!MONGO_URI) {
    console.error('❌ ERRO: Variável MONGO_URI não definida no ambiente.');
    process.exit(1);
}

// ========== CONEXÃO COM MONGODB ==========
mongoose.connect(MONGO_URI)
    .then(() => console.log('✅ Conectado ao MongoDB Atlas'))
    .catch(err => {
        console.error('❌ Erro ao conectar ao MongoDB:', err);
        process.exit(1);
    });

// ========== MODELO DE CADASTRO ==========
const cadastroSchema = new mongoose.Schema({
    nome: String,
    sobrenome: String,
    profissao: String,
    telefone: String,
    email: String,
    whatsapp: { type: String, required: true, unique: true },
    data: { type: Date, default: Date.now }
});
const Cadastro = mongoose.model('Cadastro', cadastroSchema);

// ========== ESTADO DO BOT ==========
let client = null;
let currentQR = null;
let botReady = false;
let botAtivo = true;

// Mapa de estado dos usuários: { ultimaResposta: timestamp, etapa: string, dados: object }
const userState = new Map();

// ========== FUNÇÕES AUXILIARES ==========
function normalizarTexto(texto) {
    return texto
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^\w\s]/g, '');
}

function getSaudacao() {
    const hora = new Date().getHours();
    if (hora >= 6 && hora < 12) return 'Bom dia';
    if (hora >= 12 && hora < 18) return 'Boa tarde';
    if (hora >= 18 && hora < 24) return 'Boa noite';
    return 'Olá';
}

async function getBotNumber() {
    if (client && botReady) {
        const info = await client.info;
        return info.wid._serialized;
    }
    return null;
}

// ========== INICIALIZAÇÃO DO BOT ==========
function iniciarBot() {
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
        console.log('📲 QR Code gerado');
        currentQR = await qrcode.toDataURL(qr);
    });

    client.on('ready', () => {
        console.log('✅ Bot pronto!');
        botReady = true;
        currentQR = null;
    });

    client.on('message', async (message) => {
        // Filtros gerais
        if (message.from.includes('@g.us')) return; // ignora grupos
        if (message.fromMe) return; // ignora próprias mensagens

        const userId = message.from;
        const info = await client.info;
        const isOwner = userId === info.wid._serialized;

        // ===== COMANDOS DO DONO (sempre processados) =====
        if (isOwner && message.type === 'chat' && message.body) {
            const texto = normalizarTexto(message.body);
            if (texto === '!desligar' || texto === '!off' || texto === 'desligar' || texto === 'off') {
                botAtivo = false;
                await client.sendMessage(userId, '🔴 Bot desativado.');
                console.log('🔴 Bot desativado pelo dono');
                return;
            }
            if (texto === '!ligar' || texto === '!on' || texto === 'ligar' || texto === 'on') {
                botAtivo = true;
                await client.sendMessage(userId, '🟢 Bot ativado.');
                console.log('🟢 Bot ativado pelo dono');
                return;
            }
        }

        // Se o bot estiver desativado, ignora (exceto comandos do dono já tratados)
        if (!botAtivo) {
            console.log('🤖 Bot desativado, ignorando mensagem');
            return;
        }

        const agora = Date.now();
        let estado = userState.get(userId) || { ultimaResposta: 0, etapa: null, dados: {} };

        // ===== CONTROLE DE SILÊNCIO (evita respostas repetidas) =====
        // Se não estiver em meio a um fluxo (cadastro) e já respondeu nos últimos 5 minutos, ignora
        if (!estado.etapa && (agora - estado.ultimaResposta < 300000)) {
            console.log(`⏳ Ignorando mensagem de ${userId} (dentro do período de silêncio)`);
            return;
        }

        let resposta = '';

        // ===== PROCESSAMENTO BASEADO NO TIPO DE MENSAGEM =====
        if (message.type === 'chat') {
            if (!message.body) return;
            const textoOriginal = message.body;
            const texto = normalizarTexto(textoOriginal);
            console.log(`📩 Mensagem de ${userId}: "${textoOriginal}"`);

            // Se o usuário está em alguma etapa de cadastro
            if (estado.etapa) {
                // Fluxo de cadastro
                switch (estado.etapa) {
                    case 'aguardando_nome':
                        estado.dados.nome = textoOriginal;
                        estado.etapa = 'aguardando_sobrenome';
                        resposta = 'Qual seu sobrenome?';
                        break;
                    case 'aguardando_sobrenome':
                        estado.dados.sobrenome = textoOriginal;
                        estado.etapa = 'aguardando_profissao';
                        resposta = 'Qual sua profissão?';
                        break;
                    case 'aguardando_profissao':
                        estado.dados.profissao = textoOriginal;
                        estado.etapa = 'aguardando_telefone';
                        resposta = 'Qual seu telefone para contato?';
                        break;
                    case 'aguardando_telefone':
                        estado.dados.telefone = textoOriginal;
                        estado.etapa = 'aguardando_email';
                        resposta = 'Qual seu e-mail? (opcional, digite "não" para pular)';
                        break;
                    case 'aguardando_email':
                        if (textoOriginal.toLowerCase() !== 'não' && textoOriginal.includes('@')) {
                            estado.dados.email = textoOriginal;
                        } else {
                            estado.dados.email = '';
                        }
                        // Finaliza o cadastro
                        try {
                            // Salva no MongoDB
                            const novo = new Cadastro({
                                nome: estado.dados.nome,
                                sobrenome: estado.dados.sobrenome,
                                profissao: estado.dados.profissao,
                                telefone: estado.dados.telefone,
                                email: estado.dados.email,
                                whatsapp: userId
                            });
                            await novo.save();
                            resposta = '✅ Cadastro concluído com sucesso! Obrigado.';
                        } catch (err) {
                            console.error('Erro ao salvar cadastro:', err);
                            resposta = '❌ Erro ao salvar seus dados. Tente novamente mais tarde.';
                        }
                        // Limpa o estado
                        estado.etapa = null;
                        estado.dados = {};
                        break;
                    default:
                        estado.etapa = null;
                }
            } else {
                // Não está em cadastro: verifica se é uma opção do menu
                if (texto === '1' || texto === '2' || texto === '3' || texto === '4' || texto === '5') {
                    // Menu principal
                    switch (texto) {
                        case '1':
                            resposta = 'Opção 1: Informações gerais. Aqui você pode colocar qualquer texto.';
                            break;
                        case '2':
                            resposta = 'Opção 2: Suporte. Em breve alguém falará com você.';
                            break;
                        case '3':
                            resposta = 'Opção 3: Horários. Estamos disponíveis 24h por dia.';
                            break;
                        case '4':
                            resposta = 'Opção 4: Deixar recado. Por favor, envie sua mensagem que o Silvino verá depois.';
                            // Aqui você pode implementar o salvamento de recados
                            break;
                        case '5':
                            // Inicia o fluxo de cadastro
                            estado.etapa = 'aguardando_nome';
                            estado.dados = {};
                            resposta = 'Vamos fazer seu cadastro! Qual seu nome?';
                            break;
                    }
                } else {
                    // Mensagem não reconhecida: oferece o menu
                    const saudacao = getSaudacao();
                    resposta = `${saudacao}! O Silvino não está no momento, mas pode deixar sua mensagem que ele responderá assim que possível.\n\n` +
                               `Enquanto isso, posso ajudar com alguma informação? Escolha uma opção:\n` +
                               `1 - Informações gerais\n` +
                               `2 - Suporte\n` +
                               `3 - Horários\n` +
                               `4 - Deixar recado\n` +
                               `5 - Fazer cadastro`;
                }
            }

            // Atualiza o timestamp e estado
            estado.ultimaResposta = agora;
            userState.set(userId, estado);
            await client.sendMessage(userId, resposta);
            console.log(`✅ Resposta enviada para ${userId}`);
        } else {
            // Mensagens de mídia
            const tipo = message.type;
            console.log(`📎 Mídia recebida de ${userId}, tipo: ${tipo}`);

            if (tipo === 'image') {
                resposta = '📸 Foto recebida! O Silvino vai ver assim que possível.';
            } else if (tipo === 'audio') {
                resposta = '🎤 Áudio recebido! Ele vai ouvir quando voltar.';
            } else if (tipo === 'video') {
                resposta = '🎥 Vídeo recebido! Será visto em breve.';
            } else if (tipo === 'document') {
                resposta = '📄 Documento recebido! Foi encaminhado para análise.';
            } else if (tipo === 'location') {
                resposta = '📍 Localização recebida! Isso pode ajudar a identificar a área.';
            } else if (tipo === 'vcard') {
                resposta = '👤 Contato recebido! Será salvo para futuras conversas.';
            } else {
                resposta = '📎 Mídia recebida! O Silvino vai ver quando possível.';
            }

            // Atualiza timestamp (mas não altera o estado de cadastro, se houver)
            estado.ultimaResposta = agora;
            userState.set(userId, estado);
            await client.sendMessage(userId, resposta);
            console.log(`✅ Resposta de mídia enviada para ${userId}`);
        }
    });

    client.initialize();
}

// ========== ROTAS DA API ==========
app.get('/status', async (req, res) => {
    const numeroBot = botReady ? (await client.info).wid._serialized : null;
    res.json({
        ready: botReady,
        qr: !!currentQR,
        botAtivo,
        numeroBot
    });
});

app.get('/qr', (req, res) => {
    if (currentQR) {
        res.send(`<html><body style="display:flex;justify-content:center;align-items:center;height:100vh;">
            <img src="${currentQR}" style="width:300px;">
        </body></html>`);
    } else {
        res.status(404).send('QR Code não disponível. Aguarde...');
    }
});

app.post('/toggle', (req, res) => {
    const { ativo } = req.body;
    if (typeof ativo === 'boolean') {
        botAtivo = ativo;
        console.log(`Bot ${ativo ? 'ativado' : 'desativado'} via API`);
        res.json({ success: true, botAtivo });
    } else {
        res.status(400).json({ error: 'Parâmetro "ativo" booleano obrigatório' });
    }
});

// Rota para listar cadastros (exemplo de painel)
app.get('/cadastros', async (req, res) => {
    // Proteção simples: verifica se a requisição tem um token ou senha (opcional)
    // Por simplicidade, vamos deixar pública, mas em produção coloque autenticação
    try {
        const cadastros = await Cadastro.find().sort({ data: -1 });
        res.json(cadastros);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/', (req, res) => {
    res.send('✅ Bot WhatsApp com cadastro rodando. Acesse /qr para conectar e /status para ver estado.');
});

// ========== INICIALIZAÇÃO DO SERVIDOR ==========
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
    iniciarBot();
});