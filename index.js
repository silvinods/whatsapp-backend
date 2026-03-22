const { Client, LocalAuth } = require('whatsapp-web.js');
const express = require('express');
const qrcode = require('qrcode');
const cors = require('cors');
const mongoose = require('mongoose');
const crypto = require('crypto');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 8080;
const MONGO_URI = process.env.MONGO_URI;
const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN; // Token do Mercado Pago (teste ou produção)

if (!MONGO_URI) {
    console.error('❌ ERRO: Variável MONGO_URI não definida.');
    process.exit(1);
}

// ========== CONEXÃO MONGODB ==========
mongoose.connect(MONGO_URI)
    .then(() => console.log('✅ Conectado ao MongoDB Atlas'))
    .catch(err => {
        console.error('❌ Erro ao conectar ao MongoDB:', err);
        process.exit(1);
    });

// ========== MODELO DE RECADO ==========
const recadoSchema = new mongoose.Schema({
    nome: String,
    cidade: String,
    mensagem: String,
    whatsapp: { type: String, required: true },
    data: { type: Date, default: Date.now }
});
const Recado = mongoose.model('Recado', recadoSchema);

// ========== ESTADO DO BOT ==========
let client = null;
let currentQR = null;
let botReady = false;
let botAtivo = true;
const userState = new Map(); // { ultimaResposta, etapa, dados }

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

// ========== FUNÇÃO PARA GERAR PAGAMENTO PIX ==========
async function gerarPagamentoPix(valor, telefone) {
    console.log('🔄 Gerando pagamento PIX de R$', valor);
    if (!MP_ACCESS_TOKEN) {
        console.error('❌ Token do Mercado Pago não configurado');
        return null;
    }

    const idempotencyKey = crypto.randomUUID();

    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);

        const response = await fetch('https://api.mercadopago.com/v1/payments', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${MP_ACCESS_TOKEN}`,
                'Content-Type': 'application/json',
                'X-Idempotency-Key': idempotencyKey
            },
            body: JSON.stringify({
                transaction_amount: valor,
                description: 'Doação via WhatsApp',
                payment_method_id: 'pix',
                payer: { email: `${telefone}@exemplo.com` }
            }),
            signal: controller.signal
        });

        clearTimeout(timeout);
        const data = await response.json();

        if (data.status === 'pending' && data.point_of_interaction?.transaction_data) {
            const qr = data.point_of_interaction.transaction_data;
            if (!qr.qr_code) {
                console.error('❌ Código copia/cola ausente');
                return null;
            }
            return {
                id: data.id,
                qr_code: qr.qr_code
            };
        } else {
            console.error('❌ Erro na resposta do Mercado Pago:', data);
            return null;
        }
    } catch (err) {
        console.error('❌ Erro na requisição ao Mercado Pago:', err);
        return null;
    }
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
        // Filtros: apenas mensagens de texto, ignorar grupos e próprias mensagens
        if (message.from.includes('@g.us')) return; // grupos
        if (message.fromMe) return;
        if (message.type !== 'chat') return; // ignora qualquer mídia, status, etc.
        if (!message.body) return;

        const userId = message.from;
        const info = await client.info;
        const isOwner = userId === info.wid._serialized;

        // ===== COMANDOS DO DONO =====
        if (isOwner && message.body) {
            const texto = normalizarTexto(message.body);
            if (texto === '!desligar' || texto === '!off') {
                botAtivo = false;
                await client.sendMessage(userId, '🔴 Bot desativado.');
                console.log('🔴 Bot desativado pelo dono');
                return;
            }
            if (texto === '!ligar' || texto === '!on') {
                botAtivo = true;
                await client.sendMessage(userId, '🟢 Bot ativado.');
                console.log('🟢 Bot ativado pelo dono');
                return;
            }
        }

        if (!botAtivo) return;

        const agora = Date.now();
        let estado = userState.get(userId) || { ultimaResposta: 0, etapa: null, dados: {} };

        const textoOriginal = message.body;
        const texto = normalizarTexto(textoOriginal);
        console.log(`📩 Mensagem de ${userId}: "${textoOriginal}"`);

        // ===== FLUXOS ATIVOS =====
        if (estado.etapa) {
            // Processa fluxo atual
            switch (estado.etapa) {
                case 'aguardando_valor_pix':
                    const valor = parseFloat(textoOriginal.replace(',', '.'));
                    if (isNaN(valor) || valor <= 0) {
                        await client.sendMessage(userId, '❌ Valor inválido. Digite apenas números, ex: 25.50');
                        break;
                    }
                    await client.sendMessage(userId, '⏳ Gerando código Pix...');
                    const pagamento = await gerarPagamentoPix(valor, userId);
                    if (pagamento && pagamento.qr_code) {
                        await client.sendMessage(userId, '🔹 *Código PIX (copia e cola)* 🔹');
                        await client.sendMessage(userId, pagamento.qr_code);
                        await client.sendMessage(userId, '✅ Pix gerado! Obrigado pela doação.');
                    } else {
                        await client.sendMessage(userId, '❌ Não foi possível gerar o Pix. Tente novamente mais tarde.');
                    }
                    estado = { ultimaResposta: agora, etapa: null, dados: {} };
                    break;

                case 'aguardando_recado_nome':
                    estado.dados.nome = textoOriginal;
                    estado.etapa = 'aguardando_recado_cidade';
                    await client.sendMessage(userId, 'Qual sua cidade?');
                    break;

                case 'aguardando_recado_cidade':
                    estado.dados.cidade = textoOriginal;
                    estado.etapa = 'aguardando_recado_mensagem';
                    await client.sendMessage(userId, 'Escreva seu recado:');
                    break;

                case 'aguardando_recado_mensagem':
                    estado.dados.mensagem = textoOriginal;
                    const resumo = `*Confirme seu recado:*\n\n` +
                                   `Nome: ${estado.dados.nome}\n` +
                                   `Cidade: ${estado.dados.cidade}\n` +
                                   `Recado: ${estado.dados.mensagem}\n\n` +
                                   `Está correto? (sim/não)`;
                    await client.sendMessage(userId, resumo);
                    estado.etapa = 'aguardando_recado_confirmacao';
                    break;

                case 'aguardando_recado_confirmacao':
                    if (texto === 'sim') {
                        try {
                            const novo = new Recado({
                                nome: estado.dados.nome,
                                cidade: estado.dados.cidade,
                                mensagem: estado.dados.mensagem,
                                whatsapp: userId
                            });
                            await novo.save();
                            await client.sendMessage(userId, '✅ Recado salvo com sucesso! O Silvino vai ler assim que possível.');
                        } catch (err) {
                            console.error('Erro ao salvar recado:', err);
                            await client.sendMessage(userId, '❌ Erro ao salvar recado. Tente novamente.');
                        }
                        estado = { ultimaResposta: agora, etapa: null, dados: {} };
                    } else if (texto === 'não') {
                        await client.sendMessage(userId, 'OK, vamos recomeçar. Qual seu nome?');
                        estado = { ultimaResposta: agora, etapa: 'aguardando_recado_nome', dados: {} };
                    } else {
                        await client.sendMessage(userId, 'Por favor, responda *sim* para confirmar ou *não* para recomeçar.');
                    }
                    break;

                default:
                    estado = { ultimaResposta: agora, etapa: null, dados: {} };
            }

            userState.set(userId, estado);
            return;
        }

        // ===== SE NÃO ESTÁ EM FLUXO, OFERECE MENU =====
        // Verifica silêncio (5 minutos)
        if (agora - estado.ultimaResposta < 300000) {
            console.log(`⏳ Ignorando mensagem de ${userId} (silêncio)`);
            return;
        }

        const saudacao = getSaudacao();
        const menu = `${saudacao}! O Silvino não está no momento, mas pode deixar seu recado.\n\n` +
                     `Escolha uma opção:\n` +
                     `1 - Fazer um Pix (doação)\n` +
                     `2 - Deixar um recado\n` +
                     `\nDigite o número da opção.`;

        await client.sendMessage(userId, menu);
        console.log(`✅ Menu enviado para ${userId}`);

        // Aguarda a próxima mensagem para processar a escolha
        estado.ultimaResposta = agora;
        userState.set(userId, estado);
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
        res.send(`<html><body style="display:flex;justify-content:center;align-items:center;height:100vh;"><img src="${currentQR}" style="width:300px;"></body></html>`);
    } else {
        res.status(404).send('QR Code não disponível.');
    }
});

app.post('/toggle', (req, res) => {
    const { ativo } = req.body;
    if (typeof ativo === 'boolean') {
        botAtivo = ativo;
        res.json({ success: true, botAtivo });
    } else {
        res.status(400).json({ error: 'Parâmetro "ativo" booleano obrigatório' });
    }
});

app.get('/recados', async (req, res) => {
    try {
        const recados = await Recado.find().sort({ data: -1 });
        res.json(recados);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/', (req, res) => {
    res.send('✅ Bot pessoal rodando. Acesse /qr para conectar e /status para ver estado.');
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
    iniciarBot();
});