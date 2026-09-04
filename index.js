require("dotenv").config();

const dns = require("dns");
dns.setServers(["8.8.8.8", "1.1.1.1"]);

const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const { MongoClient } = require("mongodb");
const qrcode = require("qrcode-terminal");
const QRCode = require("qrcode");
const PDFDocument = require("pdfkit");
const pino = require("pino");

const {
  default: makeWASocket,
  DisconnectReason,
  downloadMediaMessage,
  isJidBroadcast,
  Browsers,
  normalizeMessageContent,
} = require("@whiskeysockets/baileys");

const { useMongoAuthState } = require("./mongoAuthState");

const OpenAI = require("openai");

const app = express();

app.use(cors());
app.use(express.json());

/* ======================================================
   LOGGER
====================================================== */

const logger = pino({ level: "silent" });

/* ======================================================
   OPENAI
====================================================== */

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/* ======================================================
====================================================== */

const PROMPT_SISTEMA = `
Você é um vendedor profissional de uma loja especializada em sofás, estofados sob medida, poltronas e colchões.

Seu principal objetivo é VENDER, mas de forma natural, humana e sem pressionar excessivamente o cliente.

Você deve agir como um vendedor experiente que sabe conversar, entender a necessidade do cliente, apresentar a solução certa, trabalhar dúvidas e objeções e conduzir o cliente até a compra.

==================================================
REGRAS PRINCIPAIS
==================================================

- Nunca diga que você é uma inteligência artificial, robô ou assistente virtual.
- Responda sempre em português do Brasil.
- Seja simpático, natural, educado e profissional.
- Responda de forma curta e objetiva.
- Evite textos longos.
- Não faça várias perguntas de uma vez.
- Faça uma pergunta estratégica por vez.
- Preste atenção ao que o cliente já informou.
- Nunca pergunte novamente algo que o cliente já respondeu.
- Nunca invente informações, preços, descontos, promoções, prazos ou características.
- Nunca invente disponibilidade.
- Nunca crie falsa urgência.
- Não pressione o cliente de forma agressiva.

==================================================
ESTRATÉGIA DE VENDA
==================================================

Siga esta lógica durante o atendimento:

APRESENTAR → PERGUNTAR → ENTENDER → EXPLICAR → MOSTRAR VALOR → CONDUZIR → FECHAR

A primeira resposta deve, quando apropriado:

1. Cumprimentar o cliente.
2. Apresentar rapidamente a loja/produto.
3. Fazer UMA pergunta para descobrir o que realmente interessa ao cliente.

Não transforme a primeira mensagem em um interrogatório.

Exemplo:

"Olá! 😊 Trabalhamos com sofás e estofados sob medida. Me conta: você está procurando um modelo específico ou ainda está escolhendo?"

==================================================
ENTENDER O QUE O CLIENTE REALMENTE QUER
==================================================

Leia atentamente a mensagem do cliente e raciocine sobre a intenção antes de responder.

O cliente pode informar:

- modelo
- cor
- tamanho
- estilo
- material
- ambiente
- quantidade
- preferência
- orçamento
- finalidade

Use essas informações para continuar a venda.

IMPORTANTE:

Se o cliente pedir uma característica específica, NÃO envie automaticamente o catálogo.

Exemplo:

Cliente:
"Quero um sofá dourado."

Não responda enviando fotos imediatamente.

Primeiro entenda o pedido e continue a conversa:

"Claro! 😊 Você procura um sofá dourado em algum modelo específico ou quer uma opção sob medida para o seu espaço?"

Outro exemplo:

Cliente:
"Quero um sofá retrátil."

Não envie automaticamente todas as fotos.

Responda sobre o interesse dele e faça uma pergunta que avance a venda.

==================================================
QUANDO ENVIAR FOTOS
==================================================

Envie fotos da pasta "imagens" somente quando o cliente demonstrar que quer ver modelos, fotos ou catálogo.

Exemplos:

"Quero ver os modelos."
"Me manda fotos."
"Tem catálogo?"
"Quero ver as opções."
"Quais modelos vocês têm?"

Nesses casos, envie as imagens disponíveis.

Depois de enviar as imagens, continue a venda.

Pergunte:

"Qual modelo você mais gostou? 😊"

Quando o cliente escolher um modelo, avance para a medida.

==================================================
PREÇO DOS ESTOFADOS
==================================================

Os estofados são fabricados sob medida.

Preço:

R$ 1.100,00 por metro.

Cálculo:

medida × R$ 1.100,00

Exemplos:

2,00 m = R$ 2.200,00
2,20 m = R$ 2.420,00
2,50 m = R$ 2.750,00
2,80 m = R$ 3.080,00
3,00 m = R$ 3.300,00

Quando o cliente informar uma medida, calcule corretamente o valor.

Nunca responda somente o preço quando houver oportunidade de continuar a venda.

Exemplo:

Cliente:
"Quanto fica um sofá de 2,50?"

Resposta:

"Um sofá de 2,50 m fica em R$ 2.750,00. 😊 Você já tem um modelo em mente ou quer ver algumas opções?"

==================================================
COMO CONDUZIR A VENDA
==================================================

Depois que o cliente responder à primeira pergunta, use a informação fornecida para personalizar a próxima resposta.

Não repita uma apresentação genérica.

Exemplo:

Cliente:
"Quero um sofá para minha sala, de 2,50 metros."

Resposta:

"Perfeito! 😊 Para 2,50 m, o valor fica em R$ 2.750,00. Você prefere um modelo retrátil, tradicional ou ainda está escolhendo?"

Depois que o cliente escolher:

"Ótima escolha! 😊 Qual cor você gostaria?"

Depois de obter informações suficientes:

"Perfeito! Podemos prosseguir com esse modelo. 😊"

O objetivo é sempre levar o cliente para o próximo passo.

==================================================
CLIENTE DEMONSTRA INTERESSE DE COMPRA
==================================================

Quando perceber intenção real de compra, não fique fazendo perguntas desnecessárias.

Conduza para o fechamento.

Exemplos:

"Perfeito! Podemos prosseguir com esse modelo. 😊"

"Ótimo! Vamos definir a medida para calcular o valor certinho."

"Perfeito. Se quiser, podemos continuar seu pedido por aqui."

Quando o cliente estiver pronto para comprar, facilite a decisão em vez de continuar prolongando a conversa.

==================================================
OBJEÇÕES
==================================================

Se o cliente disser:

"Está caro."

Não invente desconto.

Responda com empatia e tente descobrir o que pode ajudar.

Exemplo:

"Entendo você. 😊 Como o sofá é feito sob medida, podemos trabalhar exatamente com a medida que você precisa. Qual tamanho você estava pensando?"

Se o cliente disser:

"Vou pensar."

Não encerre imediatamente.

Exemplo:

"Claro, sem problema. 😊 Ficou alguma dúvida sobre o modelo, medida ou valor que eu possa esclarecer?"

Se o cliente disser:

"Vou falar com meu marido/esposa."

Responda:

"Claro! 😊 Se quiser, posso te ajudar a deixar o modelo e a medida definidos para vocês avaliarem juntos."

==================================================
NÃO DEIXAR O CLIENTE IR EMBORA
==================================================

Enquanto existir interesse comercial, não encerre a conversa com:

"Qualquer coisa estou à disposição."

"Se precisar, é só chamar."

"Tenha um ótimo dia."

Essas frases só devem ser usadas quando a conversa realmente terminou.

Se ainda existir uma oportunidade de venda, faça uma pergunta ou indique o próximo passo.

Exemplo:

"Você prefere que eu te mostre algumas opções ou já sabe qual modelo procura?"

==================================================
COLCHÕES
==================================================

A loja também trabalha com colchões.

Quando o cliente perguntar sobre colchões, descubra primeiro a necessidade.

Exemplos:

"Claro! 😊 Você precisa de colchão solteiro, casal, queen ou king?"

Depois descubra a preferência de conforto quando necessário:

"Você prefere um colchão mais firme ou mais macio?"

Nunca invente preços de colchões.

Se uma informação específica não estiver disponível, informe que um vendedor da loja poderá confirmar.

==================================================
LOCALIZAÇÃO
==================================================

Endereço:

Rua Piauí, 922
Bairro Vila Nova

A loja realiza entregas.

Horário:

Segunda-feira a sábado
Das 08:00 às 17:00.

Quando o cliente perguntar onde fica, informe o endereço.

==================================================
ENTREGA
==================================================

A loja realiza entregas.

Nunca invente preço de frete, prazo ou regiões atendidas.

Quando essas informações não estiverem disponíveis, informe que um vendedor poderá confirmar.

==================================================
IMAGENS ENVIADAS PELO CLIENTE
==================================================

Se o cliente enviar uma imagem relacionada a sofá, estofado ou colchão, analise a imagem e tente entender o que ele está procurando.

Se estiver mostrando um modelo de referência, converse sobre o modelo antes de oferecer outras imagens.

==================================================
ÁUDIOS
==================================================

Se o cliente enviar áudio, compreenda o conteúdo e responda de acordo com a necessidade apresentada.

Mantenha a mesma estratégia comercial utilizada nas mensagens de texto.

==================================================
MEMÓRIA DA CONVERSA
==================================================

Lembre-se das informações já fornecidas pelo cliente durante a conversa.

Considere:

- produto
- modelo
- cor
- medida
- ambiente
- preferência
- dúvidas
- objeções
- intenção de compra

Nunca faça novamente uma pergunta que já foi respondida.

==================================================
REGRA DE RACIOCÍNIO
==================================================

Antes de responder, analise:

1. O que o cliente realmente quer?
2. Ele está apenas pesquisando ou demonstra intenção de compra?
3. O que ele já informou?
4. Qual é a próxima informação mais importante?
5. Qual é o próximo passo que pode aproximá-lo da compra?

Não envie catálogo simplesmente porque o cliente mencionou "sofá".

Envie catálogo quando ele pedir para ver modelos, fotos ou opções.

Pedido específico deve ser tratado como pedido específico.

==================================================
REGRA DE OURO
==================================================

Você não é apenas um atendente que responde perguntas.

Você é um vendedor.

Seu trabalho é entender o cliente, apresentar a solução adequada, gerar interesse, esclarecer dúvidas, trabalhar objeções e conduzir naturalmente a conversa até a compra.

SEMPRE tente fazer a conversa avançar.

Se o cliente demonstrar interesse, não deixe a oportunidade morrer.

Seja natural, curto, convincente e humano.
`;
/* ======================================================
   VARIÁVEIS GLOBAIS
====================================================== */

let sock;
let latestQr = null;
let connectionState = "starting";
let authResetInProgress = false;
let pairingFlowActive = false;
const conversas = {};
// Guarda o horário (timestamp) da última mensagem de cada conversa, para
// saber se a conversa ainda está "ativa" ou se já passou muito tempo
// (nesse caso o histórico é reiniciado e a saudação inicial volta a valer).
const ultimaInteracaoConversa = {};
// Tempo sem mensagens, em ms, após o qual a conversa é considerada nova.
const LIMITE_INATIVIDADE_MS = 6 * 60 * 60 * 1000; // 6 horas
const atendimentosHumanos = new Set();
const idsMensagensDoBot = new Set();
const mensagensDoBotPendentes = new Map();
const tentativasPlaceholderResend = new Map();
const mensagensAgrupadas = new Map();
const chavesAgrupamentoConversa = new Map();
const idsMensagensRecebidas = new Set();
const ESPERA_MENSAGENS_MS = 10 * 1000;
let authCollection = null;
let mongoClient = null;
const ENDERECO_YAN = "AVENIDA ADELINO FERREIRA JARDIN NUMERO 80 APARTAMENTO 304 PORO ALEGRE RIO GRANDE DO SUL";
// Endereço real da loja de sofás, usado quando o cliente pede localização/endereço.
const ENDERECO_LOJA = "Rua Piauí, 922 - Bairro Vila Nova";
const PASTA_PDFS_TEMPORARIOS = path.join(__dirname, "pdfs-temp");
const PASTA_AUDIOS_TEMPORARIOS = path.join(__dirname, "audios-temp");

// Pasta onde ficam as fotos dos modelos de sofá (catálogo de imagens).
const PASTA_IMAGENS_CATALOGO = path.join(__dirname, "imagenes");

// Extensões de imagem aceitas ao ler a pasta do catálogo.
const EXTENSOES_IMAGEM_VALIDAS = /\.(jpe?g|png|webp)$/i;

// Palavras-chave que, ao serem digitadas pelo cliente, disparam o envio
// automático de todas as fotos do catálogo.
const PALAVRAS_CATALOGO = [
  "catalogo",
  "fotos",
  "foto",
  "imagens",
  "imagem",
  "modelos",
  "sofa",
  "sofas",
  "quero ver os modelos",
  "quero ver os sofas",
  "mostrar modelos",
];

// Preço, em reais, cobrado por metro de sofá sob medida.
const PRECO_POR_METRO = 1100;
const MODELO_TRANSCRICAO_AUDIO =
  process.env.OPENAI_TRANSCRIPTION_MODEL || "whisper-1";
const MODELO_VOZ_AUDIO =
  process.env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts";
const VOZ_AUDIO =
  process.env.OPENAI_TTS_VOICE || "alloy";

function obterIdsDaConversa(message) {
  return [message.key.remoteJid, message.key.remoteJidAlt].filter(Boolean);
}

// O WhatsApp pode identificar o mesmo contato com IDs diferentes
// (remoteJid "clássico" e remoteJid alternativo/LID) entre uma mensagem e
// outra. Se o histórico fosse guardado sempre pelo remoteJid da mensagem
// atual, o mesmo cliente podia "perder" a conversa e o bot voltava a
// tratá-lo como se fosse a primeira vez. Esta função reutiliza a chave já
// existente (se algum dos IDs já tiver histórico) para manter o contexto.
function obterNumeroConversa(message) {
  const ids = obterIdsDaConversa(message);
  const idComHistorico = ids.find((id) => conversas[id]);
  return idComHistorico || ids[0];
}

// Marca un mensaje enviado por el propio bot para no confundirlo
// con una intervención manual del humano cuando llegue el eco por messages.upsert.
function marcarComoEnviadoPeloBot(sentMsg) {
  if (sentMsg?.key?.id) {
    idsMensagensDoBot.add(sentMsg.key.id);
  }
}

function obterTextoDaMensagem(message) {
  return (
    message?.conversation ||
    message?.extendedTextMessage?.text ||
    ""
  );
}

function obterChaveMensagemPendente(numero, texto) {
  return `${numero}\u0000${texto}`;
}

function registrarMensagemDoBotPendente(numero, conteudo) {
  const texto = obterTextoDaMensagem(conteudo);
  if (!texto) return null;

  const chave = obterChaveMensagemPendente(numero, texto);
  mensagensDoBotPendentes.set(
    chave,
    (mensagensDoBotPendentes.get(chave) || 0) + 1
  );
  return chave;
}

function removerMensagemDoBotPendente(chave) {
  if (!chave) return;

  const quantidade = mensagensDoBotPendentes.get(chave) || 0;
  if (quantidade <= 1) {
    mensagensDoBotPendentes.delete(chave);
  } else {
    mensagensDoBotPendentes.set(chave, quantidade - 1);
  }
}

function consumirMensagemDoBotPendente(numero, mensagem) {
  const texto = obterTextoDaMensagem(mensagem);
  if (!texto) return false;

  const chave = obterChaveMensagemPendente(numero, texto);
  const quantidade = mensagensDoBotPendentes.get(chave) || 0;
  if (!quantidade) return false;

  removerMensagemDoBotPendente(chave);
  return true;
}

function enfileirarMensagens(numeroConversa, mensagens) {
  let grupo = mensagensAgrupadas.get(numeroConversa);

  if (!grupo) {
    grupo = { mensagens: [], timer: null };
    mensagensAgrupadas.set(numeroConversa, grupo);
  }

  grupo.mensagens.push(...mensagens);
  clearTimeout(grupo.timer);
  grupo.timer = setTimeout(async () => {
    const grupoAtual = mensagensAgrupadas.get(numeroConversa);
    if (!grupoAtual) return;

    mensagensAgrupadas.delete(numeroConversa);
    try {
      await processarMensagensAgrupadas(numeroConversa, grupoAtual.mensagens);
    } catch (erro) {
      console.log("❌ ERRO ao processar mensagens agrupadas:");
      console.log(erro);
    }
  }, ESPERA_MENSAGENS_MS);
}

function obterChaveAgrupamentoConversa(message) {
  const ids = obterIdsDaConversa(message);
  const chaveExistente = ids.find((id) => chavesAgrupamentoConversa.has(id));
  const chave = chaveExistente
    ? chavesAgrupamentoConversa.get(chaveExistente)
    : obterNumeroConversa(message);

  ids.forEach((id) => chavesAgrupamentoConversa.set(id, chave));
  return chave;
}

async function processarMensagensAgrupadas(numeroConversa, mensagens) {
  const primeiraMensagem = mensagens[0];
  if (!primeiraMensagem) return;

  if (
    mensagens.some((mensagem) =>
      obterIdsDaConversa(mensagem).some((id) => atendimentosHumanos.has(id))
    )
  ) {
    return;
  }

  const numero = primeiraMensagem.key.remoteJid;
  const agora = Date.now();
  const ultimaInteracao = ultimaInteracaoConversa[numeroConversa];
  if (!ultimaInteracao || agora - ultimaInteracao > LIMITE_INATIVIDADE_MS) {
    conversas[numeroConversa] = [];
  }
  ultimaInteracaoConversa[numeroConversa] = agora;

  const textos = [];
  let recebeuAudio = false;

  for (const mensagem of mensagens) {
    let textoMensagem = obterTextoDaMensagem(mensagem.message);
    const mensagemNormalizada = normalizeMessageContent(mensagem.message);
    const mensagemTemAudio = Boolean(mensagemNormalizada?.audioMessage);
    recebeuAudio = recebeuAudio || mensagemTemAudio;

    if (mensagemTemAudio) {
      console.log("Audio recebido");
      try {
        textoMensagem = await transcreverAudio(mensagem);
        console.log("Transcricao:");
        console.log(textoMensagem);
      } catch (erroAudio) {
        console.log("Erro ao processar audio:", erroAudio);
        const sentMsg = await sock.sendMessage(numero, {
          text: "Desculpe, nao consegui entender esse audio. Pode enviar novamente ou escrever a mensagem?",
        });
        marcarComoEnviadoPeloBot(sentMsg);
        return;
      }
    }

    if (textoMensagem) textos.push(textoMensagem);
  }

  const textoUsuario = textos.join("\n");
  if (!textoUsuario) return;
  const texto = normalizarTexto(textoUsuario);

  if (texto.includes("pdf") || texto.includes("documento")) {
    if (fs.existsSync("./pdf/yan-automacoes.pdf")) {
      await enviarPDF(numero, "./pdf/yan-automacoes.pdf");
    } else {
      const sentMsg = await sock.sendMessage(numero, {
        text: "Desculpe, o PDF não está disponível no momento.",
      });
      marcarComoEnviadoPeloBot(sentMsg);
    }
    return;
  }

  if (
    texto.includes("endereco") ||
    texto.includes("localizacao") ||
    texto.includes("onde fica") ||
    texto.includes("localizar") ||
    texto.includes("locais")
  ) {
    await enviarLocalizacao(numero);
    return;
  }

  if (ehPedidoCatalogoImagens(texto)) {
    try {
      await enviarCatalogoImagens(numero);
    } catch (erroCatalogo) {
      console.log("❌ Erro ao processar pedido de catálogo:");
      console.log(erroCatalogo);
    }
    return;
  }

  try {
    const medidaInformada = extrairMedidaSofa(textoUsuario);
    if (medidaInformada !== null && medidaInformada > 0) {
      const respostaPreco = calcularPrecoSofa(medidaInformada);
      if (!conversas[numeroConversa]) conversas[numeroConversa] = [];
      conversas[numeroConversa].push({ role: "user", content: textoUsuario });
      conversas[numeroConversa].push({ role: "assistant", content: respostaPreco });
      conversas[numeroConversa] = conversas[numeroConversa].slice(-15);
      await enviarResposta(numero, respostaPreco, recebeuAudio);
      return;
    }
  } catch (erroMedida) {
    console.log("❌ Erro ao calcular medida do sofá:");
    console.log(erroMedida);
  }

  console.log("\n📩 Mensagem de:", numero);
  console.log(textoUsuario);
  if (!conversas[numeroConversa]) conversas[numeroConversa] = [];
  conversas[numeroConversa].push({ role: "user", content: textoUsuario });
  conversas[numeroConversa] = conversas[numeroConversa].slice(-15);

  const respostaIA = await openai.chat.completions.create({
    model: "gpt-5.6",
    messages: [
      { role: "system", content: PROMPT_SISTEMA },
      ...conversas[numeroConversa],
    ],
  });
  const resposta = respostaIA.choices[0].message.content;
  console.log("\n🤖 Resposta:");
  console.log(resposta);
  conversas[numeroConversa].push({ role: "assistant", content: resposta });
  await enviarResposta(numero, resposta, recebeuAudio);

  if (ehConfirmacaoProposta(resposta)) {
    await enviarPDFProposta(numero, conversas[numeroConversa], resposta);
  }
}

async function conectarMongoDB() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error("MONGODB_URI is not set");
  }

  const dbName = process.env.MONGODB_DB || "bot-anuncios";

  mongoClient = new MongoClient(uri);

  await mongoClient.connect();
  const db = mongoClient.db(dbName);
  authCollection = db.collection("auth_sessions");

  console.log("✅ Conectado ao MongoDB");
}

async function limparAuthMongo() {
  if (authCollection) {
    await authCollection.deleteMany({});
    console.log("🧹 Sessão de autenticação do WhatsApp resetada no MongoDB");
  }
}


/* ======================================================
   GERAR PDF DE PROPOSTA
====================================================== */

function gerarPDF(dadosAgendamento) {

  return new Promise((resolve, reject) => {

    try {

      if (!fs.existsSync(PASTA_PDFS_TEMPORARIOS)) {
        fs.mkdirSync(PASTA_PDFS_TEMPORARIOS, {
          recursive: true,
        });
      }

      const caminhoPDF =
        path.join(
          PASTA_PDFS_TEMPORARIOS,
          `proposta-yan-${Date.now()}.pdf`
        );

      const doc =
        new PDFDocument({
          margin: 50,
        });

      const stream =
        fs.createWriteStream(caminhoPDF);

      doc.pipe(stream);

      doc
        .fontSize(20)
        .text("Proposta de Automação - Yan", {
          align: "center",
        });

      doc.moveDown();

      doc
        .fontSize(12)
        .text("Yan Automações", {
          align: "center",
        });

      doc.moveDown(2);

      doc
        .fontSize(14)
        .text("Dados do Cliente", {
          underline: true,
        });

      doc.moveDown();

      doc.fontSize(12);
      doc.text(`Nome: ${dadosAgendamento.nome}`);
      doc.text(`Serviço: ${dadosAgendamento.servico}`);
      doc.text(`Data: ${dadosAgendamento.data}`);
      doc.text(`Horario: ${dadosAgendamento.horario}`);
      doc.text(`Localização: ${dadosAgendamento.localizacao}`);

      doc.moveDown(2);

      doc
        .fontSize(13)
        .text("Mensagem de confirmacao", {
          underline: true,
        });

      doc.moveDown();

      doc
        .fontSize(12)
        .text(dadosAgendamento.mensagem);

      doc.moveDown(2);

      doc
        .fontSize(10)
        .text(
          "Este documento foi gerado automaticamente pelo Consultor Virtual da Yan.",
          {
            align: "center",
          }
        );

      doc.end();

      stream.on("finish", () => {
        resolve(caminhoPDF);
      });

      stream.on("error", reject);

    } catch (erro) {

      reject(erro);

    }

  });
}

/* ======================================================
   ENVIAR PDF
====================================================== */

async function enviarPDF(numero, caminhoPDF, legenda) {
  try {
    const media = fs.readFileSync(caminhoPDF);
    const base64 = media.toString("base64");
    const mimeType = "application/pdf";

    const sentMsg = await sock.sendMessage(numero, {
      document: { url: caminhoPDF },
      fileName: path.basename(caminhoPDF),
      caption: legenda || "📄 Aqui está o documento solicitado.",
      mimetype: mimeType,
    });
    marcarComoEnviadoPeloBot(sentMsg);

    console.log("✅ PDF enviado!");

  } catch (erro) {
    console.log("❌ Erro ao enviar PDF:");
    console.log(erro);
  }
}

/* ======================================================
   LIMPAR PDF TEMPORARIO
====================================================== */

function limparPDFTemporario(caminhoPDF) {

  try {

    if (
      caminhoPDF &&
      caminhoPDF.startsWith(PASTA_PDFS_TEMPORARIOS) &&
      fs.existsSync(caminhoPDF)
    ) {

      fs.unlinkSync(caminhoPDF);

    }

  } catch (erro) {

    console.log("Nao foi possivel apagar PDF temporario:");
    console.log(erro);

  }
}

/* ======================================================
   AUDIO
====================================================== */

function garantirPastaTemporaria(pasta) {
  if (!fs.existsSync(pasta)) {
    fs.mkdirSync(pasta, {
      recursive: true,
    });
  }
}

function criarCaminhoAudioTemporario(extensao) {
  garantirPastaTemporaria(PASTA_AUDIOS_TEMPORARIOS);

  const nomeArquivo =
    `audio-${Date.now()}-${Math.random().toString(36).slice(2)}.${extensao}`;

  return path.join(PASTA_AUDIOS_TEMPORARIOS, nomeArquivo);
}

function limparArquivoTemporario(caminhoArquivo) {
  try {
    if (
      caminhoArquivo &&
      caminhoArquivo.startsWith(PASTA_AUDIOS_TEMPORARIOS) &&
      fs.existsSync(caminhoArquivo)
    ) {
      fs.unlinkSync(caminhoArquivo);
    }
  } catch (erro) {
    console.log("Nao foi possivel apagar arquivo temporario:");
    console.log(erro);
  }
}

async function transcreverAudio(message) {
  let caminhoAudio;

  try {
    const audioBuffer = await downloadMediaMessage(
      message,
      "buffer",
      {},
      {
        logger,
        reuploadRequest: sock.updateMediaMessage,
      }
    );
    caminhoAudio = criarCaminhoAudioTemporario("ogg");

    fs.writeFileSync(caminhoAudio, audioBuffer);

    const transcricao = await openai.audio.transcriptions.create({
      file: fs.createReadStream(caminhoAudio),
      model: MODELO_TRANSCRICAO_AUDIO,
      language: "pt",
    });

    return (transcricao.text || "").trim();
  } finally {
    limparArquivoTemporario(caminhoAudio);
  }
}

async function gerarAudioResposta(texto) {
  const fala = await openai.audio.speech.create({
    model: MODELO_VOZ_AUDIO,
    voice: VOZ_AUDIO,
    input: texto.slice(0, 4000),
    response_format: "opus",
  });

  return Buffer.from(await fala.arrayBuffer());
}

async function enviarResposta(numero, resposta, responderComAudio = false) {
  if (!responderComAudio) {
    const sentMsg = await sock.sendMessage(numero, {
      text: resposta,
    });
    marcarComoEnviadoPeloBot(sentMsg);
    return;
  }

  try {
    const audioBuffer = await gerarAudioResposta(resposta);

    const sentMsg = await sock.sendMessage(numero, {
      audio: audioBuffer,
      mimetype: "audio/ogg; codecs=opus",
      ptt: true,
    });
    marcarComoEnviadoPeloBot(sentMsg);
  } catch (erroAudio) {
    console.log("Erro ao gerar/enviar audio de resposta:");
    console.log(erroAudio);

    const sentMsg = await sock.sendMessage(numero, {
      text: resposta,
    });
    marcarComoEnviadoPeloBot(sentMsg);
  }
}

/* ======================================================
   UTILIDADES DE TEXTO
====================================================== */

function normalizarTexto(texto) {

  return (texto || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

}

function extrairServico(texto) {

  const servicos = [
    "Atendimento",
    "Vendas",
    "Leads",
    "Automacao",
    "CRM",
    "Agendamento",
  ];

  const textoNormalizado =
    normalizarTexto(texto);

  return (
    servicos.find((servico) =>
      textoNormalizado.includes(
        normalizarTexto(servico)
      )
    ) || "Automacao"
  );

}

function extrairData(texto) {

  const data =
    texto.match(/\b\d{1,2}[\/-]\d{1,2}(?:[\/-]\d{2,4})?\b/);

  return data ? data[0] : "Nao informada";

}

function extrairHorario(texto) {

  const horario =
    texto.match(/\b\d{1,2}[:h]\d{0,2}\b/i);

  return horario ? horario[0] : "Nao informado";

}

function extrairNome(texto) {

  const nome =
    texto.match(
      /(?:meu nome e|me chamo|sou|nome completo e)\s+([a-zA-ZÀ-ÿ\s]{3,80})/i
    );

  if (!nome) return "Cliente";

  return nome[1]
    .replace(/\s+/g, " ")
    .trim();

}

function montarDadosAgendamento(historico, resposta) {

  const textoCompleto =
    [
      ...historico.map((item) => item.content),
      resposta,
    ].join("\n");

  return {
    nome: extrairNome(textoCompleto),
    servico: extrairServico(textoCompleto),
    data: extrairData(textoCompleto),
    horario: extrairHorario(textoCompleto),
    localizacao: ENDERECO_YAN,
    mensagem:
      resposta ||
      "Sua proposta de automação foi confirmada com sucesso.",
  };

}

/* ======================================================
   CONFIRMACAO DE PROPOSTA
====================================================== */

function ehConfirmacaoProposta(resposta) {

  const texto =
    normalizarTexto(resposta);

  return (
    texto.includes("proposta confirmada") ||
    texto.includes("automacao confirmada") ||
    texto.includes("confirmo a proposta")
  );

}

async function enviarPDFProposta(numero, historico, resposta) {

  let caminhoPDF;

  try {

    const dadosAgendamento =
      montarDadosAgendamento(historico, resposta);

    caminhoPDF =
      await gerarPDF(dadosAgendamento);

    await enviarPDF(
      numero,
      caminhoPDF,
      "Aqui esta a confirmacao da sua proposta de automacao."
    );

  } catch (erro) {

    console.log("Erro ao gerar/enviar PDF de proposta:");
    console.log(erro);

  } finally {

    limparPDFTemporario(caminhoPDF);

  }
}

/* ======================================================
   ENVIAR LOCALIZAÇÃO
====================================================== */

async function enviarLocalizacao(numero) {
  try {
    // Coordenadas aproximadas do bairro Vila Nova, Porto Alegre - RS
    // (não é o número exato "922", ajustar se tiver a localização precisa).
    const sentMsg1 = await sock.sendMessage(numero, {
      location: {
        degreesLatitude: -30.1160030,
        degreesLongitude: -51.2075170,
      },
    });
    marcarComoEnviadoPeloBot(sentMsg1);

    // Também enviar mensagem com o endereço da loja
    const sentMsg2 = await sock.sendMessage(
      numero,
      {
        text: "📍 " + ENDERECO_LOJA,
      }
    );
    marcarComoEnviadoPeloBot(sentMsg2);

    console.log("✅ Localização enviada!");

  } catch (erro) {
    console.log("❌ Erro ao enviar localização:");
    console.log(erro);
  }
}

/* ======================================================
   CATÁLOGO DE IMAGENS (FOTOS DOS SOFÁS)
====================================================== */

// Verifica se o texto do cliente corresponde a um pedido de catálogo/fotos.
function ehPedidoCatalogoImagens(textoNormalizado) {
  return PALAVRAS_CATALOGO.some((palavra) =>
    textoNormalizado.includes(normalizarTexto(palavra))
  );
}

// Envia, uma a uma, todas as imagens encontradas na pasta do catálogo.
// Se uma imagem não existir ou falhar o envio, o erro é registrado e o
// bot continua para a próxima foto, sem interromper o atendimento.
async function enviarCatalogoImagens(numero) {
  try {
    // Lê a pasta de forma assíncrona (não bloqueia o restante do bot).
    const arquivos = await fs.promises.readdir(PASTA_IMAGENS_CATALOGO);

    const imagens = arquivos
      .filter((arquivo) => EXTENSOES_IMAGEM_VALIDAS.test(arquivo))
      .sort();

    if (imagens.length === 0) {
      const sentMsg = await sock.sendMessage(numero, {
        text: "Desculpe, não encontrei fotos disponíveis no catálogo agora.",
      });
      marcarComoEnviadoPeloBot(sentMsg);
      return;
    }

    for (const nomeArquivo of imagens) {
      try {
        const caminhoImagem = path.join(PASTA_IMAGENS_CATALOGO, nomeArquivo);

        // Confere se o arquivo ainda existe antes de tentar enviá-lo.
        if (!fs.existsSync(caminhoImagem)) {
          console.log(`⚠️ Imagem não encontrada, pulando: ${nomeArquivo}`);
          continue;
        }

        const sentMsg = await sock.sendMessage(numero, {
          image: { url: caminhoImagem },
        });
        marcarComoEnviadoPeloBot(sentMsg);
      } catch (erroImagem) {
        // Se uma imagem falhar, apenas loga e segue para a próxima.
        console.log(`❌ Erro ao enviar a imagem "${nomeArquivo}":`);
        console.log(erroImagem);
        continue;
      }
    }

    // Mensagem final, enviada depois de todas as fotos.
    const sentMsgFinal = await sock.sendMessage(numero, {
      text:
        "Esses são alguns dos nossos modelos disponíveis.\n\n" +
        "Qual deles você mais gostou?\n\n" +
        "Informe também a medida desejada para que eu possa calcular o valor.",
    });
    marcarComoEnviadoPeloBot(sentMsgFinal);

    console.log("✅ Catálogo de imagens enviado!");
  } catch (erro) {
    console.log("❌ Erro ao enviar catálogo de imagens:");
    console.log(erro);
  }
}

/* ======================================================
   CÁLCULO DO VALOR DO SOFÁ PELA MEDIDA
====================================================== */

// Extrai a medida (em metros) informada pelo cliente em textos como:
// "2 metros", "2m", "2,30", "2.30", "2,5", "2.50", "3 metros".
// Retorna um número (float) ou null se nenhuma medida for encontrada.
function extrairMedidaSofa(texto) {
  const textoNormalizado = normalizarTexto(texto);

  // 1) Número decimal (com vírgula ou ponto), com ou sem "m"/"metros" depois.
  //    Ex.: "2,30" | "2.5" | "2,50 metros" | "2.5m"
  const regexDecimal = /\b(\d{1,2}[,.]\d{1,2})\s*(?:m(?:etros)?)?\b/i;

  // 2) Número inteiro seguido obrigatoriamente de "m" ou "metros".
  //    Ex.: "2 metros" | "2m" | "3 metros"
  const regexInteiroComUnidade = /\b(\d{1,2})\s*m(?:etros)?\b/i;

  const matchDecimal = textoNormalizado.match(regexDecimal);
  const matchInteiro = textoNormalizado.match(regexInteiroComUnidade);

  let valorEncontrado = null;

  if (matchDecimal) {
    valorEncontrado = matchDecimal[1];
  } else if (matchInteiro) {
    valorEncontrado = matchInteiro[1];
  }

  if (!valorEncontrado) return null;

  // Converte vírgula decimal para ponto, para o parseFloat funcionar.
  const metros = parseFloat(valorEncontrado.replace(",", "."));

  return Number.isFinite(metros) ? metros : null;
}

// Calcula o valor aproximado do sofá (metros x preço por metro) e devolve
// a mensagem já formatada para envio ao cliente. Funciona para qualquer
// medida, sem usar valores fixos.
function calcularPrecoSofa(metros) {
  const valorTotal = metros * PRECO_POR_METRO;

  const metrosFormatados = metros.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  const valorFormatado = valorTotal.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  return `O valor aproximado para um sofá de ${metrosFormatados} metros é de R$ ${valorFormatado}.`;
}

/* ======================================================
   INICIALIZAR SOCKET
====================================================== */

async function inicializarSocket() {
  try {
    const phoneNumber = process.env.PHONE_NUMBER?.replace(/\D/g, "");
    const { state, saveCreds } = await useMongoAuthState(authCollection);

    sock = makeWASocket({
      auth: state,
      logger: logger,
      printQRInTerminal: false,
      browser: Browsers.ubuntu("Chrome"),
      connectTimeoutMs: 30000,
      defaultQueryTimeoutMs: 60000,
      keepAliveIntervalMs: 30000,
      syncFullState: true,
    });

    const sendMessageOriginal = sock.sendMessage.bind(sock);
    sock.sendMessage = async (numero, conteudo, opcoes) => {
      const chavePendente = registrarMensagemDoBotPendente(numero, conteudo);
      try {
        const sentMsg = await sendMessageOriginal(numero, conteudo, opcoes);
        marcarComoEnviadoPeloBot(sentMsg);
        return sentMsg;
      } finally {
        removerMensagemDoBotPendente(chavePendente);
      }
    };

    let shouldUsePairingCode = !state.creds.registered && Boolean(phoneNumber);
    pairingFlowActive = shouldUsePairingCode;

    if (!phoneNumber) {
      console.log("⚠️ PHONE_NUMBER no está definido. El bot está en modo Pairing Code, pero no se puede generar código sin el número.");
    }

    if (shouldUsePairingCode) {
      try {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        const pairingCode = await sock.requestPairingCode(phoneNumber);
        const formattedPairingCode = pairingCode.match(/.{1,4}/g).join("-");
        console.log("\n========================================");
        console.log("CÓDIGO DE VINCULACIÓN:");
        console.log(formattedPairingCode);
        console.log("========================================");
        console.log("INGRESE ESTE CÓDIGO EN WHATSAPP: Dispositivos vinculados > Vincular dispositivo > Vincular con número");
        console.log("========================================\n");
      } catch (error) {
        console.error("Error al solicitar el código de vinculación:", error);
        shouldUsePairingCode = false;
        latestQr = null;
        console.log("🔄 El flujo quedó forzado a Pairing Code y no se mostrará QR.");
      }
    }

    /* ======================================================
       EVENTOS
    ====================================================== */

    sock.ev.on("connection.update", async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr && !shouldUsePairingCode) {
        latestQr = null;
        connectionState = "qr";
        console.log("⚠️ QR deshabilitado en modo Pairing Code.");
      }

      if (connection === "open") { 
        connectionState = "open";
        latestQr = null;
        pairingFlowActive = false;
        console.log("✅ Bot conectado!");
      }

      if (connection === "close") {
        connectionState = "close";
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const errorMessage = lastDisconnect?.error?.message || "";
        const isAuthFailure = statusCode === DisconnectReason.loggedOut;
        const shouldReconnect = !isAuthFailure && !pairingFlowActive;

        console.log(
          "conexão fechada devido a ",
          lastDisconnect?.error,
          ", reconectando ",
          shouldReconnect
        );

        if (pairingFlowActive) {
          pairingFlowActive = false;
          setTimeout(inicializarSocket, 3000);
          return;
        }

        if (isAuthFailure) {
          if (authResetInProgress) {
            console.log("⚠️ Reinício de autenticação já em andamento. Aguarde...");
            return;
          }

          authResetInProgress = true;
          console.log("⚠️ Sessão inválida ou expirada em Baileys. Resetando autenticação...");
          await limparAuthMongo();
          setTimeout(() => {
            authResetInProgress = false;
            inicializarSocket();
          }, 3000);
          return;
        }

        if (shouldReconnect) {
          setTimeout(inicializarSocket, 3000);
        }
      }
    });

    sock.ev.on("creds.update", saveCreds);

    /* ======================================================
       MENSAGENS
    ====================================================== */

    sock.ev.on("messages.upsert", async (m) => {
      try {
        console.log("===== UPSERT RAW =====");
        console.log(JSON.stringify(m, null, 2));
        console.log("======================");

        if (!m.messages) return;

        for (const mensagem of m.messages) {
          const parametrosStub = mensagem?.messageStubParameters || [];
          const ehMensagemAusente = parametrosStub.includes(
            "Message absent from node"
          );
          const messageId = mensagem?.key?.id;

          if (!ehMensagemAusente || !messageId) continue;

          const tentativas = tentativasPlaceholderResend.get(messageId) || 0;
          if (tentativas >= 3) {
            console.log(
              "[messages.upsert] limite de reintentos alcanzado para mensaje ausente:",
              messageId
            );
            continue;
          }

          tentativasPlaceholderResend.set(messageId, tentativas + 1);
          console.log(
            `[messages.upsert] solicitando recuperación de mensaje ausente (intento ${tentativas + 1}/3):`,
            messageId
          );

          if (typeof sock.requestPlaceholderResend !== "function") {
            console.log(
              "[messages.upsert] requestPlaceholderResend no está disponible en este socket"
            );
            continue;
          }

          try {
            const requestId = await sock.requestPlaceholderResend(
              mensagem.key,
              mensagem
            );
            console.log(
              "[messages.upsert] solicitud de recuperación enviada:",
              requestId || "sin requestId"
            );
          } catch (erroRetry) {
            console.log(
              "[messages.upsert] error al solicitar recuperación del mensaje:",
              erroRetry
            );
          }
        }

        // Um mesmo evento pode trazer mais de uma mensagem. Registrar antes
        // as manuais evita que o bot responda se elas não forem a primeira.
        for (const mensagemManual of m.messages) {
          if (!mensagemManual.message || !mensagemManual.key.fromMe) continue;

          // Ignorar o eco das próprias respostas do bot: não é intervenção humana.
          if (idsMensagensDoBot.has(mensagemManual.key.id)) {
            idsMensagensDoBot.delete(mensagemManual.key.id);
            continue;
          }

          if (
            consumirMensagemDoBotPendente(
              mensagemManual.key.remoteJid,
              mensagemManual.message
            )
          ) {
            continue;
          }

          if (mensagemManual.key.remoteJid.includes("@g.us")) continue;
          if (isJidBroadcast(mensagemManual.key.remoteJid)) continue;

          const numeroManual = mensagemManual.key.remoteJid;
          let textoManual = mensagemManual.message.conversation || "";

          if (!textoManual && mensagemManual.message.extendedTextMessage) {
            textoManual = mensagemManual.message.extendedTextMessage.text;
          }

          // Ignorar eventos "fromMe" que não são texto real digitado pelo
          // usuário (reações, revogações, sincronizações, mídia sem legenda,
          // etc.), pois eles não representam uma intervenção humana.
          if (
            !mensagemManual.message.conversation &&
            !mensagemManual.message.extendedTextMessage
          ) {
            continue;
          }

          if (normalizarTexto(textoManual) === "#bot") {
            obterIdsDaConversa(mensagemManual).forEach((id) =>
              atendimentosHumanos.delete(id)
            );
            console.log("🤖 Bot reativado para:", numeroManual);
          } else {
            obterIdsDaConversa(mensagemManual).forEach((id) =>
              atendimentosHumanos.add(id)
            );
            console.log("👤 Atendimento humano ativado para:", numeroManual);
          }
        }

        console.log("[messages.upsert] total de mensagens:", m.messages.length);
        m.messages.forEach((candidate, index) => {
          const remoteJid = candidate?.key?.remoteJid;
          const messageValida = Boolean(
            candidate?.message &&
            !candidate.key?.fromMe &&
            remoteJid &&
            !remoteJid.includes("@g.us") &&
            !isJidBroadcast(remoteJid)
          );
          console.log(
            `[messages.upsert] mensagem ${index}: message=${Boolean(candidate?.message)}, valida=${messageValida}, fromMe=${Boolean(candidate?.key?.fromMe)}, remoteJid=${remoteJid || "indefinido"}`
          );
        });

        const mensagensValidas = m.messages.filter((candidate) => {
          const remoteJid = candidate?.key?.remoteJid;
          return Boolean(
            candidate?.message &&
            !candidate.key?.fromMe &&
            remoteJid &&
            !remoteJid.includes("@g.us") &&
            !isJidBroadcast(remoteJid)
          );
        });

        const gruposPorConversa = new Map();
        for (const mensagemValida of mensagensValidas) {
          const messageId = mensagemValida.key?.id;
          if (messageId && idsMensagensRecebidas.has(messageId)) continue;
          if (messageId) {
            idsMensagensRecebidas.add(messageId);
            tentativasPlaceholderResend.delete(messageId);
          }

          const numeroConversa = obterChaveAgrupamentoConversa(mensagemValida);
          const grupo = gruposPorConversa.get(numeroConversa) || [];
          grupo.push(mensagemValida);
          gruposPorConversa.set(numeroConversa, grupo);
        }

        for (const [numeroConversa, grupo] of gruposPorConversa) {
          enfileirarMensagens(numeroConversa, grupo);
        }

        if (mensagensValidas.length) return;

        const message = m.messages.find((candidate) => {
          const remoteJid = candidate?.key?.remoteJid;
          return Boolean(
            candidate?.message &&
            !candidate.key?.fromMe &&
            remoteJid &&
            !remoteJid.includes("@g.us") &&
            !isJidBroadcast(remoteJid)
          );
        });

        if (!message) {
          console.log("[messages.upsert] nenhuma mensagem válida de usuário para processar");
          return;
        }

        if (message.key?.id) {
          tentativasPlaceholderResend.delete(message.key.id);
        }

        console.log("[messages.upsert] processando mensagem válida de usuário:", message.key.remoteJid);
        console.log("[messages.upsert] type:", m.type);
        console.log("[messages.upsert] message:", message.message);

        // Ignorar grupos
        if (message.key.remoteJid.includes("@g.us")) return;

        // Ignorar broadcast
        if (isJidBroadcast(message.key.remoteJid)) return;

        const numero = message.key.remoteJid;

        // Mensagens próprias já foram registradas no modo humano acima.
        if (message.key.fromMe) return;

        // Chave estável do histórico dessa conversa (ver obterNumeroConversa).
        const numeroConversa = obterNumeroConversa(message);

        // Se a conversa ficou inativa por muito tempo, reinicia o histórico
        // para que o atendimento comece novamente com a saudação inicial.
        const agora = Date.now();
        const ultimaInteracao = ultimaInteracaoConversa[numeroConversa];
        if (!ultimaInteracao || agora - ultimaInteracao > LIMITE_INATIVIDADE_MS) {
          conversas[numeroConversa] = [];
        }
        ultimaInteracaoConversa[numeroConversa] = agora;

        // Não responder enquanto o atendimento estiver sendo feito por uma pessoa.
        if (obterIdsDaConversa(message).some((id) => atendimentosHumanos.has(id))) return;

        let textoUsuario = message.message.conversation || "";
        const recebeuAudio = Boolean(
          normalizeMessageContent(message.message)?.audioMessage
        );

        // Se não houver texto simples, tentar extrair de outras fontes
        if (!textoUsuario && message.message.extendedTextMessage) {
          textoUsuario = message.message.extendedTextMessage.text;
        }

        /* ======================================================
           PROCESSAR AUDIO
        ====================================================== */

        if (recebeuAudio) {
          console.log("Audio recebido");

          try {
            textoUsuario = await transcreverAudio(message);

            console.log("Transcricao:");
            console.log(textoUsuario);
          } catch (erroAudio) {
            console.log("Erro ao processar audio:", erroAudio);

            const sentMsg = await sock.sendMessage(numero, {
              text: "Desculpe, nao consegui entender esse audio. Pode enviar novamente ou escrever a mensagem?",
            });
            marcarComoEnviadoPeloBot(sentMsg);
            return;
          }
        }

        // Ignorar vazio
        if (!textoUsuario) return;

        const texto = normalizarTexto(textoUsuario);

        /* ======================================================
           PEDIR PDF
        ====================================================== */

        if (
          texto.includes("pdf") ||
          texto.includes("documento")
        ) {
          if (fs.existsSync("./pdf/yan-automacoes.pdf")) {
            await enviarPDF(numero, "./pdf/yan-automacoes.pdf");
          } else {
            const sentMsg = await sock.sendMessage(numero, {
              text: "Desculpe, o PDF não está disponível no momento.",
            });
            marcarComoEnviadoPeloBot(sentMsg);
          }
          return;
        }

        /* ======================================================
           PEDIR ENDEREÇO
        ====================================================== */

        if (
          texto.includes("endereco") ||
          texto.includes("localizacao") ||
          texto.includes("onde fica") ||
          texto.includes("localizar") ||
          texto.includes("locais")
        ) {
          await enviarLocalizacao(numero);
          return;
        }

        /* ======================================================
           PEDIR CATÁLOGO DE FOTOS (MODELOS DE SOFÁ)
        ====================================================== */

        if (ehPedidoCatalogoImagens(texto)) {
          try {
            await enviarCatalogoImagens(numero);
          } catch (erroCatalogo) {
            console.log("❌ Erro ao processar pedido de catálogo:");
            console.log(erroCatalogo);
          }
          return;
        }

        /* ======================================================
           CLIENTE INFORMOU A MEDIDA DO SOFÁ (CÁLCULO AUTOMÁTICO)
        ====================================================== */

        try {
          const medidaInformada = extrairMedidaSofa(textoUsuario);

          if (medidaInformada !== null && medidaInformada > 0) {
            const respostaPreco = calcularPrecoSofa(medidaInformada);

            // Registra a interação no histórico para manter a memória da conversa.
            if (!conversas[numeroConversa]) {
              conversas[numeroConversa] = [];
            }
            conversas[numeroConversa].push({ role: "user", content: textoUsuario });
            conversas[numeroConversa].push({ role: "assistant", content: respostaPreco });
            conversas[numeroConversa] = conversas[numeroConversa].slice(-15);

            await enviarResposta(numero, respostaPreco, recebeuAudio);
            return;
          }
        } catch (erroMedida) {
          console.log("❌ Erro ao calcular medida do sofá:");
          console.log(erroMedida);
          // Não interrompe o atendimento: segue o fluxo normal com a IA.
        }

        console.log("\n📩 Mensagem de:", numero);
        console.log(textoUsuario);

        /* ======================================================
           HISTÓRICO
        ====================================================== */

        if (!conversas[numeroConversa]) {
          conversas[numeroConversa] = [];
        }

        conversas[numeroConversa].push({
          role: "user",
          content: textoUsuario,
        });

        // Limitar memória
        conversas[numeroConversa] = conversas[numeroConversa].slice(-15);

        /* ======================================================
           OPENAI
        ====================================================== */

        const respostaIA = await openai.chat.completions.create({
          model: "gpt-5.6",
          messages: [
            {
              role: "system",
              content: PROMPT_SISTEMA,
            },
            ...conversas[numeroConversa],
          ],
        });

        const resposta = respostaIA.choices[0].message.content;

        console.log("\n🤖 Resposta:");
        console.log(resposta);

        /* ======================================================
           SALVAR RESPOSTA
        ====================================================== */

        conversas[numeroConversa].push({
          role: "assistant",
          content: resposta,
        });

        /* ======================================================
           ENVIAR RESPOSTA
        ====================================================== */

        await enviarResposta(numero, resposta, recebeuAudio);

        /* ======================================================
           ENVIAR PDF AUTOMÁTICO PROPOSTA
        ====================================================== */

        if (ehConfirmacaoProposta(resposta)) {
          await enviarPDFProposta(numero, conversas[numeroConversa], resposta);
        }

      } catch (erro) {
        console.log("❌ ERRO:");
        console.log(erro);

        try {
          const message = m.messages && m.messages[0];
          if (message?.key?.remoteJid) {
            const sentMsg = await sock.sendMessage(
              message.key.remoteJid,
              {
                text: "Desculpe, ocorreu um erro no atendimento.",
              }
            );
            marcarComoEnviadoPeloBot(sentMsg);
          }
        } catch (e) {
          console.log("Erro ao enviar mensagem de erro:", e);
        }
      }
    });

  } catch (erro) {
    console.log("Erro ao inicializar socket:", erro);
    setTimeout(inicializarSocket, 3000);
  }
}

/* ======================================================
   API
====================================================== */

app.get("/", (req, res) => {
  res.json({
    status: "online",
    bot: "Yan IA",
    auth_storage: "mongodb",
  });
});

app.get("/status", (req, res) => {
  res.json({
    status: connectionState,
    qr_available: Boolean(latestQr),
  });
});

app.get("/qr", async (req, res) => {
  if (!latestQr) {
    return res.status(404).send("QR code is not available right now.");
  }

  try {
    const qrDataUrl = await QRCode.toDataURL(latestQr);
    res.send(`
      <html>
        <body style="font-family: Arial, sans-serif; text-align: center; padding: 40px;">
          <h1>QR Code WhatsApp</h1>
          <p>Escanea este código con WhatsApp para conectar el bot.</p>
          <img src="${qrDataUrl}" alt="QR Code" />
          <p>El código expira cada pocos segundos. Refresca la página si no funciona.</p>
        </body>
      </html>
    `);
  } catch (erro) {
    console.error("Error generating QR image:", erro);
    res.status(500).send("Error generating QR image.");
  }
});

async function resetSession(req, res, redirect = false) {
  try {
    connectionState = "restarting";
    latestQr = null;

    if (sock && typeof sock.end === "function") {
      await sock.end();
    }

    if (authCollection) {
      await authCollection.deleteMany({});
    }

    setTimeout(() => {
      inicializarSocket();
    }, 1000);

    if (redirect) {
      return res.redirect("/qr");
    }

    res.json({
      status: "restarting",
      message: "Session reset started. Refresh /qr after a few seconds.",
    });
  } catch (erro) {
    console.error("Error resetting session:", erro);
    res.status(500).json({ error: "Unable to reset session." });
  }
}

app.get("/reset-session", async (req, res) => {
  return resetSession(req, res, true);
});

app.post("/reset-session", async (req, res) => {
  return resetSession(req, res);
});

/* ======================================================
   SERVIDOR
====================================================== */

const PORT = process.env.PORT || 3000;

app.listen(PORT, async () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);

  try {
    await conectarMongoDB();
    await inicializarSocket();
  } catch (erro) {
    console.error("Erro ao iniciar:", erro);
    process.exit(1);
  }
});