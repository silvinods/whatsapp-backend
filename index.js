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
const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;

if (!MONGO_URI) {
    console.error('❌ ERRO: Variável MONGO_URI não definida.');
    process.exit(1);
}
//Minha conexão ao MongoDB
// ========== CONEXÃO MONGODB ==========
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
    data: { type: Date, default: Date.now },
    pagamentoId: { type: String },
    pagamentoStatus: { type: String, default: 'pendente' }
});
const Cadastro = mongoose.model('Cadastro', cadastroSchema);

// ========== ESTADO DO BOT ==========
let client = null;
let currentQR = null;
let botReady = false;
let botAtivo = true;
const userState = new Map(); // { ultimaResposta, etapa, dados, pagamentoId }

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
//onde está a função do QR Code para escaniar
// ========== FUNÇÃO PARA GERAR PAGAMENTO PIX (CORRIGIDA) ==========
async function gerarPagamentoPix(telefone, valor = 10.00) {

    console.log('🔄 Iniciando pagamento PIX');

    if (!MP_ACCESS_TOKEN) {
        console.log('❌ Token não configurado');
        return null;
    }

    const idempotencyKey = crypto.randomUUID();

    try {

        console.log('🔄 Chamando MercadoPago...');

        const response = await fetch(
            'https://api.mercadopago.com/v1/payments',
            {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${MP_ACCESS_TOKEN}`,
                    'Content-Type': 'application/json',
                    'X-Idempotency-Key': idempotencyKey
                },
                body: JSON.stringify({
                    transaction_amount: valor,
                    description: 'Agendamento Barbearia',
                    payment_method_id: 'pix',
                    payer: {
                        email: 'teste@email.com'
                    }
                })
            }
        );

        console.log('STATUS:', response.status);

        const data = await response.json();

        console.log('RESPOSTA MP:', data);

        if (
            data.point_of_interaction &&
            data.point_of_interaction.transaction_data
        ) {

            return {
                id: data.id,
                qr_code_base64:
                    data.point_of_interaction.transaction_data.qr_code_base64,
                qr_code:
                    data.point_of_interaction.transaction_data.qr_code
            };

        }

        return null;

    } catch (err) {

        console.log('ERRO PIX:', err);

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
        if (message.from.includes('@g.us')) return;
        if (message.fromMe) return;

        const userId = message.from;
        const info = await client.info;
        const isOwner = userId === info.wid._serialized;

        // Comandos do dono
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

        if (!botAtivo) {
            console.log('🤖 Bot desativado, ignorando mensagem');
            return;
        }

        const agora = Date.now();
        let estado = userState.get(userId) || { ultimaResposta: 0, etapa: null, dados: {} };

        if (message.type === 'chat') {
            if (!message.body) return;
            const textoOriginal = message.body;
            const texto = normalizarTexto(textoOriginal);
            console.log(`📩 Mensagem de ${userId}: "${textoOriginal}"`);

            // ---------- FLUXO DE CADASTRO ----------
            if (estado.etapa) {
                switch (estado.etapa) {
                    case 'aguardando_nome':
                        estado.dados.nome = textoOriginal;
                        estado.etapa = 'aguardando_sobrenome';
                        await client.sendMessage(userId, 'Qual seu sobrenome?');
                        break;
                    case 'aguardando_sobrenome':
                        estado.dados.sobrenome = textoOriginal;
                        estado.etapa = 'aguardando_profissao';
                        await client.sendMessage(userId, 'Qual sua profissão?');
                        break;
                    case 'aguardando_profissao':
                        estado.dados.profissao = textoOriginal;
                        estado.etapa = 'aguardando_telefone';
                        await client.sendMessage(userId, 'Qual seu telefone para contato?');
                        break;
                    case 'aguardando_telefone':
                        estado.dados.telefone = textoOriginal;
                        estado.etapa = 'aguardando_email';
                        await client.sendMessage(userId, 'Qual seu e-mail? (opcional, digite "não" para pular)');
                        break;
                    case 'aguardando_email':
                        if (textoOriginal.toLowerCase() !== 'não' && textoOriginal.includes('@')) {
                            estado.dados.email = textoOriginal;
                        } else {
                            estado.dados.email = '';
                        }
                        // Resumo dos dados
                        const resumo = `*Confirme seus dados:*\n\n` +
                                       `Nome: ${estado.dados.nome}\n` +
                                       `Sobrenome: ${estado.dados.sobrenome}\n` +
                                       `Profissão: ${estado.dados.profissao}\n` +
                                       `Telefone: ${estado.dados.telefone}\n` +
                                       `E-mail: ${estado.dados.email || '(não informado)'}\n\n` +
                                       `Está tudo correto? Responda *SIM* para confirmar ou *NÃO* para reiniciar.`;
                        await client.sendMessage(userId, resumo);
                        estado.etapa = 'aguardando_confirmacao';
                        break;
                    case 'aguardando_confirmacao':
                        const confirmacao = texto.toLowerCase();
                        if (confirmacao === 'sim') {
                            const existente = await Cadastro.findOne({ whatsapp: userId });
                            if (existente) {
                                await client.sendMessage(userId, 'Você já possui um cadastro. Se precisar atualizar, entre em contato com o suporte.');
                                estado.etapa = null;
                                estado.dados = {};
                            } else {
                                await client.sendMessage(userId, 'Deseja fazer o pagamento agora? (sim/não)');
                                estado.etapa = 'aguardando_pagamento';
                            }
                        } else if (confirmacao === 'não' || confirmacao === 'nao') {
                            estado.etapa = 'aguardando_nome';
                            estado.dados = {};
                            await client.sendMessage(userId, 'OK, vamos recomeçar. Qual seu nome?');
                        } else {
                            await client.sendMessage(userId, 'Por favor, responda *SIM* para confirmar ou *NÃO* para reiniciar.');
                        }
                        break;
                    case 'aguardando_pagamento':
                        const querPagar = texto.toLowerCase();
                        if (querPagar === 'sim') {
                            await client.sendMessage(userId, '⏳ Gerando QR code de pagamento...');
                            const pagamento = await gerarPagamentoPix(estado.dados.telefone, 10.00);
                            if (pagamento) {
                                estado.pagamentoId = pagamento.id;
                                // Envia a imagem do QR code
                                const buffer = Buffer.from(pagamento.qr_code_base64, 'base64');
                                await client.sendMessage(userId, { image: buffer, caption: '🔹 *QR Code PIX* 🔹\nEscaneie para pagar:' });
                                await client.sendMessage(userId, `Ou copie o código:\n\`${pagamento.qr_code}\``);
                                // Salva cadastro com ID do pagamento
                                try {
                                    const novo = new Cadastro({
                                        nome: estado.dados.nome,
                                        sobrenome: estado.dados.sobrenome,
                                        profissao: estado.dados.profissao,
                                        telefone: estado.dados.telefone,
                                        email: estado.dados.email,
                                        whatsapp: userId,
                                        pagamentoId: pagamento.id,
                                        pagamentoStatus: 'pendente'
                                    });
                                    await novo.save();
                                    await client.sendMessage(userId, '✅ *Cadastro concluído!*\nSeu pagamento está sendo processado. Assim que confirmado, você receberá um aviso.');
                                } catch (err) {
                                    console.error('Erro ao salvar cadastro:', err);
                                    await client.sendMessage(userId, '❌ Erro ao salvar seus dados. Tente novamente mais tarde.');
                                }
                            } else {
                                await client.sendMessage(userId, '❌ Não foi possível gerar o QR code. Tente novamente mais tarde.');
                                // Salva cadastro sem pagamento (opcional)
                                try {
                                    const novo = new Cadastro({
                                        nome: estado.dados.nome,
                                        sobrenome: estado.dados.sobrenome,
                                        profissao: estado.dados.profissao,
                                        telefone: estado.dados.telefone,
                                        email: estado.dados.email,
                                        whatsapp: userId
                                    });
                                    await novo.save();
                                    await client.sendMessage(userId, '✅ Cadastro concluído! O pagamento poderá ser feito depois.');
                                } catch (err) {
                                    console.error('Erro ao salvar cadastro:', err);
                                    await client.sendMessage(userId, '❌ Erro ao salvar seus dados.');
                                }
                            }
                            estado.etapa = null;
                            estado.dados = {};
                        } else if (querPagar === 'não' || querPagar === 'nao') {
                            // Salva cadastro sem pagamento
                            try {
                                const novo = new Cadastro({
                                    nome: estado.dados.nome,
                                    sobrenome: estado.dados.sobrenome,
                                    profissao: estado.dados.profissao,
                                    telefone: estado.dados.telefone,
                                    email: estado.dados.email,
                                    whatsapp: userId
                                });
                                await novo.save();
                                await client.sendMessage(userId, '✅ Cadastro concluído! O pagamento poderá ser feito depois.');
                            } catch (err) {
                                console.error('Erro ao salvar cadastro:', err);
                                await client.sendMessage(userId, '❌ Erro ao salvar seus dados.');
                            }
                            estado.etapa = null;
                            estado.dados = {};
                        } else {
                            await client.sendMessage(userId, 'Por favor, responda *SIM* para pagar agora ou *NÃO* para continuar sem pagamento.');
                        }
                        break;
                    default:
                        estado.etapa = null;
                }
                estado.ultimaResposta = agora;
                userState.set(userId, estado);
                return;
            }

            // ---------- MENU PRINCIPAL ----------
            if (texto === '1' || texto === '2' || texto === '3' || texto === '4' || texto === '5') {
                let resposta = '';
                switch (texto) {
                    case '1': resposta = 'Opção 1: Informações gerais. Em breve disponíveis.'; break;
                    case '2': resposta = 'Opção 2: Suporte. Entraremos em contato.'; break;
                    case '3': resposta = 'Opção 3: Horários. Segunda a sábado, 9h-18h.'; break;
                    case '4': resposta = 'Opção 4: Deixar recado. Envie sua mensagem.'; break;
                    case '5':
                        estado.etapa = 'aguardando_nome';
                        estado.dados = {};
                        resposta = 'Vamos fazer seu cadastro! Qual seu nome?';
                        break;
                }
                estado.ultimaResposta = agora;
                userState.set(userId, estado);
                await client.sendMessage(userId, resposta);
                console.log(`✅ Resposta de menu enviada para ${userId}`);
                return;
            }

            // Mensagem comum: oferece menu com silêncio
            if (agora - estado.ultimaResposta < 300000) {
                console.log(`⏳ Ignorando mensagem de ${userId} (silêncio)`);
                return;
            }
            const saudacao = getSaudacao();
            const menu = `${saudacao}! O Silvino não está no momento, mas pode deixar sua mensagem.\n\n` +
                         `Escolha uma opção:\n` +
                         `1 - Informações\n` +
                         `2 - Suporte\n` +
                         `3 - Horários\n` +
                         `4 - Deixar recado\n` +
                         `5 - Fazer cadastro`;
            estado.ultimaResposta = agora;
            userState.set(userId, estado);
            await client.sendMessage(userId, menu);
            console.log(`✅ Menu enviado para ${userId}`);
        } else {
            // Mídia
            const tipo = message.type;
            console.log(`📎 Mídia recebida de ${userId}, tipo: ${tipo}`);
            let resposta = '';
            if (tipo === 'image') resposta = '📸 Foto recebida! O Silvino vai ver.';
            else if (tipo === 'audio') resposta = '🎤 Áudio recebido! Ele vai ouvir.';
            else if (tipo === 'video') resposta = '🎥 Vídeo recebido! Será visto.';
            else if (tipo === 'document') resposta = '📄 Documento recebido! Enviado para análise.';
            else if (tipo === 'location') resposta = '📍 Localização recebida! Ajuda a identificar a área.';
            else if (tipo === 'vcard') resposta = '👤 Contato recebido! Salvo para futuras conversas.';
            else resposta = '📎 Mídia recebida! O Silvino vai ver.';
            estado.ultimaResposta = agora;
            userState.set(userId, estado);
            await client.sendMessage(userId, resposta);
            console.log(`✅ Resposta de mídia enviada para ${userId}`);
        }
    });

    client.initialize();
}

// ========== ROTAS ==========
app.get('/status', async (req, res) => {
    const numeroBot = botReady ? (await client.info).wid._serialized : null;
    res.json({ ready: botReady, qr: !!currentQR, botAtivo, numeroBot });
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

app.get('/cadastros', async (req, res) => {
    try {
        const cadastros = await Cadastro.find().sort({ data: -1 });
        res.json(cadastros);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/', (req, res) => {
    res.send('✅ Bot WhatsApp com cadastro e pagamento rodando.');
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
    iniciarBot();
});