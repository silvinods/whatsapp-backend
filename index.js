const { Client, LocalAuth } = require('whatsapp-web.js');
const express = require('express');
const qrcode = require('qrcode');
const cors = require('cors');
const mongoose = require('mongoose');
const crypto = require('crypto');
const fetch = require('node-fetch');

const app = express();

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 8080;
const MONGO_URI = process.env.MONGO_URI;
const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;

let client;
let currentQR = null;
let botReady = false;





// ================= MONGO =================

if (MONGO_URI) {

    mongoose.connect(MONGO_URI)
        .then(() => console.log("Mongo OK"))
        .catch(err => console.log(err));

}





// ================= PIX =================

async function gerarPagamentoPix(valor = 10) {

    console.log("PIX INICIO");

    console.log("TOKEN:", MP_ACCESS_TOKEN);

    if (!MP_ACCESS_TOKEN) {

        console.log("SEM TOKEN");

        return null;
    }

    const idempotencyKey = crypto.randomUUID();

    try {

        const response = await fetch(
            "https://api.mercadopago.com/v1/payments",
            {
                method: "POST",

                headers: {

                    Authorization: `Bearer ${MP_ACCESS_TOKEN}`,

                    "Content-Type": "application/json",

                    "X-Idempotency-Key": idempotencyKey
                },

                body: JSON.stringify({

                    transaction_amount: valor,

                    description: "Teste",

                    payment_method_id: "pix",

                    payer: {
                        email: "teste@email.com"
                    }

                })
            }
        );

        console.log("STATUS", response.status);

        const data = await response.json();

        console.log("DATA", data);

        if (
            data &&
            data.point_of_interaction &&
            data.point_of_interaction.transaction_data
        ) {

            return {

                id: data.id,

                qr_code_base64:
                    data.point_of_interaction.transaction_data.qr_code_base64,

                qr_code:
                    data.point_of_interaction.transaction_data.qr_code

            }

        }

        return null;

    } catch (err) {

        console.log("ERRO PIX", err);

        return null;

    }

}





// ================= BOT =================

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



    client.on("qr", async qr => {

        console.log("QR GERADO");

        currentQR = await qrcode.toDataURL(qr);

    });



    client.on("ready", () => {

        console.log("BOT PRONTO");

        botReady = true;

        currentQR = null;

    });



    client.on("message", async msg => {

        if (msg.fromMe) return;

        if (msg.body === "pix") {

            await client.sendMessage(
                msg.from,
                "Gerando PIX..."
            );

            const pagamento = await gerarPagamentoPix(10);

            if (!pagamento) {

                await client.sendMessage(
                    msg.from,
                    "Erro ao gerar PIX"
                );

                return;
            }

            const buffer =
                Buffer.from(
                    pagamento.qr_code_base64,
                    "base64"
                );

            await client.sendMessage(
                msg.from,
                {
                    image: buffer,
                    caption: "QR PIX"
                }
            );

            await client.sendMessage(
                msg.from,
                pagamento.qr_code
            );

        }

    });



    client.initialize();

}





// ================= ROTAS =================

app.get("/", (req, res) => {

    res.send("ok");

});



app.get("/status", async (req, res) => {

    res.json({

        ready: botReady,

        qr: !!currentQR

    });

});



app.get("/qr", (req, res) => {

    if (currentQR) {

        res.send(
            `<img src="${currentQR}" width="300">`
        );

    } else {

        res.send("sem qr");

    }

});





// ================= SERVER =================

app.listen(PORT, "0.0.0.0", () => {

    console.log("SERVER", PORT);

    iniciarBot();

});