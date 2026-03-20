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

if (!MONGO_URI) {
    console.log("SEM MONGO");
    process.exit(1);
}

mongoose.connect(MONGO_URI)
.then(()=>console.log("Mongo OK"))
.catch(err=>{
    console.log(err);
    process.exit(1);
});

const cadastroSchema = new mongoose.Schema({

    nome:String,
    sobrenome:String,
    profissao:String,
    telefone:String,
    email:String,

    whatsapp:{type:String,unique:true},

    pagamentoId:String,
    pagamentoStatus:String

});

const Cadastro = mongoose.model("Cadastro",cadastroSchema);

let client;
let currentQR=null;
let botReady=false;
let botAtivo=true;

const userState=new Map();



function normalizarTexto(t){

    return t.toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g,'')
    .replace(/[^\w\s]/g,'')

}



async function gerarPagamentoPix(telefone,valor=10){

    console.log("PIX INICIO");

    console.log("TOKEN:",MP_ACCESS_TOKEN);

    if(!MP_ACCESS_TOKEN){

        console.log("SEM TOKEN");

        return null;
    }

    const idempotencyKey=crypto.randomUUID();

    try{

        const response=await fetch(
            "https://api.mercadopago.com/v1/payments",
            {
                method:"POST",

                headers:{

                    Authorization:`Bearer ${MP_ACCESS_TOKEN}`,

                    "Content-Type":"application/json",

                    "X-Idempotency-Key":idempotencyKey
                },

                body:JSON.stringify({

                    transaction_amount:valor,

                    description:"Teste",

                    payment_method_id:"pix",

                    payer:{
                        email:"teste@email.com"
                    }

                })
            }
        );

        console.log("STATUS",response.status);

        const data=await response.json();

        console.log("DATA",data);

        if(
            data &&
            data.point_of_interaction &&
            data.point_of_interaction.transaction_data
        ){

            return{

                id:data.id,

                qr_code_base64:
                data.point_of_interaction.transaction_data.qr_code_base64,

                qr_code:
                data.point_of_interaction.transaction_data.qr_code

            }

        }

        return null;

    }catch(err){

        console.log("ERRO PIX",err);

        return null;

    }

}



function iniciarBot(){

client=new Client({

    authStrategy:new LocalAuth(),

    puppeteer:{
        headless:true,
        args:[
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--no-zygote',
            '--single-process'
        ]
    }

});


client.on("qr",async qr=>{

    console.log("QR GERADO");

    currentQR=await qrcode.toDataURL(qr);

});


client.on("ready",()=>{

    console.log("BOT PRONTO");

    botReady=true;

    currentQR=null;

});


client.on("message",async message=>{

    if(message.fromMe) return;

    if(message.from.includes("@g.us")) return;

    const userId=message.from;

    let estado=userState.get(userId)||{};

    const texto=normalizarTexto(message.body||"");



    if(texto==="5"){

        estado.etapa="pagamento";

        userState.set(userId,estado);

        await client.sendMessage(
            userId,
            "Gerar pagamento? sim"
        );

        return;
    }



    if(estado.etapa==="pagamento"){

        estado.etapa=null;

        userState.set(userId,estado);

        await client.sendMessage(
            userId,
            "Gerando QR..."
        );

        const pagamento=
        await gerarPagamentoPix("999",10);



        if(!pagamento){

            await client.sendMessage(
                userId,
                "Erro ao gerar PIX"
            );

            return;
        }



        const buffer=
        Buffer.from(
            pagamento.qr_code_base64,
            "base64"
        );



        await client.sendMessage(
            userId,
            {
                image:buffer,
                caption:"PIX"
            }
        );



        await client.sendMessage(
            userId,
            pagamento.qr_code
        );

    }

});

client.initialize();

}



app.get("/qr",(req,res)=>{

    if(currentQR){

        res.send(`<img src="${currentQR}">`);

    }else{

        res.send("sem qr");

    }

});



app.get("/",(req,res)=>{

    res.send("ok");

});



app.listen(PORT,"0.0.0.0",()=>{

    console.log("server",PORT);

    iniciarBot();

});