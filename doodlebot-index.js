const fs = require('fs')
const path = require('path')
const { exec } = require('child_process')

// Ponte do site (chat web). Veja web.js
const ponteWeb = require('./doodlebot-web.js')

// Remove o que o shell interpreta dentro de aspas duplas ($, `, \\ e ")
// Evita que alguém execute comando no seu celular via !tocar / !baixar
function limparShell(texto) {
    return String(texto).replace(/["`$\\\r\n]/g, '')
}

// Baixa a mídia de uma mensagem. Mensagens vindas do site já trazem o arquivo
// pronto (__webBuffer); as do WhatsApp continuam usando o downloadMediaMessage.
async function baixarMidiaMsg(downloadMediaMessage, mensagemFake) {
    const conteudo = mensagemFake?.message || {}

    for (const tipo of [
        'imageMessage',
        'videoMessage',
        'stickerMessage',
        'audioMessage',
        'documentMessage'
    ]) {
        if (conteudo[tipo]?.__webBuffer) return conteudo[tipo].__webBuffer
    }

    return downloadMediaMessage(mensagemFake, 'buffer', {})
}

function notificarTermux(titulo, mensagem) {
    const tituloEscapado = titulo.replace(/"/g, '\\"')
    const mensagemEscapada = mensagem.replace(/"/g, '\\"')

    exec(
        `termux-notification --title "${tituloEscapado}" --content "${mensagemEscapada}"`,
        (err) => {
            if (err) console.log('Erro ao notificar:', err.message)
        }
    )
}

process.on('uncaughtException', (err) => {
    console.log('⚠️ Erro não tratado:', err.message)
})

process.on('unhandledRejection', (err) => {
    console.log('⚠️ Promise rejeitada:', err?.message || err)
})

const CAMINHO_DADOS = './dados.json'

function carregarDados() {
    try {
        if (fs.existsSync(CAMINHO_DADOS)) {
            const dados = JSON.parse(
                fs.readFileSync(CAMINHO_DADOS, 'utf-8')
            )

            return {
                contadorMensagens: dados.contadorMensagens || {},
                avisos: dados.avisos || {},
                niveis: dados.niveis || {},
                pontosTrivia: dados.pontosTrivia || {},
                saldoBanco: dados.saldoBanco || {},
                ultimoDiario: dados.ultimoDiario || {},
                inventarios: dados.inventarios || {},
                casamentos: dados.casamentos || {},
                ultimoBonus: dados.ultimoBonus || {},
                titulos: dados.titulos || {},
                investimentos: dados.investimentos || {},
                gastoLoja: dados.gastoLoja || {},
                carinhoRecebido: dados.carinhoRecebido || {},
                instagrams: dados.instagrams || {},
                bios: dados.bios || {},
                gruposDesligados: dados.gruposDesligados || {},
                msgsEntrada: dados.msgsEntrada || {},
                msgsSaida: dados.msgsSaida || {},
                funcoesDesativadas: dados.funcoesDesativadas || {},
                protecoes: dados.protecoes || {},
                agendasGrupo: dados.agendasGrupo || {},
                anunciosAuto: dados.anunciosAuto || {}
            }
        }
    } catch (err) {
        console.log('Erro ao carregar dados:', err.message)
    }

    return {
        contadorMensagens: {},
        avisos: {},
        niveis: {},
        pontosTrivia: {},
        saldoBanco: {},
        ultimoDiario: {},
        inventarios: {},
        casamentos: {},
        ultimoBonus: {},
        titulos: {},
        investimentos: {},
        gastoLoja: {},
        carinhoRecebido: {},
        instagrams: {},
        bios: {},
        gruposDesligados: {},
        msgsEntrada: {},
        msgsSaida: {},
        funcoesDesativadas: {},
        protecoes: {},
        agendasGrupo: {},
        anunciosAuto: {}
    }
}

function salvarDados(dados) {
    try {
        const conteudo = JSON.stringify(dados, null, 2)
        const tempPath = CAMINHO_DADOS + '.tmp'

        fs.writeFileSync(tempPath, conteudo)
        fs.renameSync(tempPath, CAMINHO_DADOS)
    } catch (err) {
        console.log('Erro ao salvar dados:', err.message)
        try {
            // fallback direto caso o rename falhe
            fs.writeFileSync(
                CAMINHO_DADOS,
                JSON.stringify(dados, null, 2)
            )
        } catch (err2) {
            console.log('Erro no fallback de save:', err2.message)
        }
    }
}

async function iniciar() {
    const {
        default: makeWASocket,
        useMultiFileAuthState,
        DisconnectReason
    } = await import('@whiskeysockets/baileys')

    const pino = (await import('pino')).default
    const qrcode = (await import('qrcode-terminal')).default

    // ==============================
    // CONFIGURAÇÕES
    // ==============================

    const LIMITE_REPETICOES = 2
    const LIMITE_AVISOS = 3
    const PREFIXO = '!'
    const MENSAGENS_POR_NIVEL = 10
    const TEMPO_TRIVIA_MS = 30000
    const TENTATIVAS_FORCA = 6
    const MESADA_DIARIA = 500
    const NIVEL_MAXIMO = 2500
    const RECOMPENSA_JOGO = 100

    // Número do WhatsApp do bot (com DDI, sem + e sem espaços)
    const NUMERO_BOT = '639100941217'

    // Donos globais do bot: controle total em qualquer grupo (iguais ao dono do grupo)
    // Formato: número com DDI, sem + e sem espaços
    const DONOS_GLOBAIS = [
        '558191289850'
    ]

    // Dinheiro infinito em qualquer grupo (mensagem especial no !banco)
    // Inclui variação com/sem o 9 do celular BR
    const DINHEIRO_INFINITO = [
        '558183629622',
        '5581983629622'
    ]

    // Chave da API do Giphy pra buscar GIFs. Deixe vazia até configurar.
    const GIPHY_API_KEY = process.env.GIPHY_API_KEY || ''

    // Token grátis do LLM7 (opcional). Sem ele, usa acesso anônimo ("unused"),
    // que funciona mas tem limites mais apertados. Pegue o seu de graça em
    // https://dash.llm7.io e coloque como variável de ambiente LLM7_TOKEN.
    const LLM7_TOKEN = process.env.LLM7_TOKEN || 'unused'

    // Imagem enviada junto com o !menu (fica na pasta assets/ ao lado do index.js)
    const IMAGEM_MENU_PATH = path.join(__dirname, 'assets', 'menu.png')

    // Personalidade da IA na conversa livre (reply no grupo / qualquer msg no privado)
    const PERSONALIDADE_IA =
        `Seu nome é Doodle Bot. Sua aparência é: pele branca, cabelo preto e traços/aparência asiática — se alguém perguntar seu nome ou como você é, responda com naturalidade usando essas informações, sem inventar outra identidade nem fugir do assunto.

Você é um jovem brasileiro extremamente conectado à internet e à cultura do TikTok. Sua personalidade é espontânea, caótica, engraçada, irônica e muito rápida nas respostas. Você passa muito tempo consumindo TikTok, memes, edits, vídeos virais, Discord, Instagram e comunidades online, então conhece praticamente todas as tendências, piadas internas, expressões e formatos de humor da internet.

Seu humor é baseado principalmente em memes, ironia, exagero, referências, situações absurdas, piadas internas e timing. Você não precisa transformar toda mensagem em uma piada; saiba conversar normalmente quando necessário, mas aproveite oportunidades naturais para fazer graça.

Você conhece e entende gírias como: "W", "L", "tuff", "lowkey", "highkey", "larp", "cooked", "bro", "blud", "fr", "ngl", "based", "mid", "goated", "aura", "aura farming", "mog", "glazing", "crashout", "locked in", "NPC", "canon event", "delulu", "skill issue", "bro is NOT...", "ain't no way", "💀", entre muitas outras. Use essas expressões de maneira natural e contextual, sem simplesmente despejá-las em todas as frases.

Você entende que muitas dessas palavras são usadas de forma irônica. Por exemplo:

- Quando alguém faz algo impressionante: "W", "tuff", "goated".
- Quando alguém faz algo muito ruim ou passa vergonha: "L", "cooked", "bro is finished 💀".
- Quando alguém conta uma história claramente exagerada: "bro is larping".
- Quando algo é discretamente bom: "lowkey tuff".
- Quando alguém está exagerando nos elogios: "bro is glazing".
- Quando alguém está tentando chamar atenção ou parecer impressionante: "aura farming".
- Quando uma situação é completamente absurda: "ain't no way 💀".

Seu vocabulário pode misturar português brasileiro com gírias da internet em inglês. Não traduza tudo. Use as palavras em inglês quando elas fizerem parte natural do meme.

Você gosta de criar piadas internas. Se uma pessoa mencionar algo engraçado que aconteceu anteriormente, pode transformar aquilo em "lore", "arco", "canon event" ou referência recorrente. Pequenos acontecimentos podem virar brincadeiras internas.

Você também gosta de exagerar situações comuns de maneira obviamente humorística. Uma pessoa perder uma partida pode virar "o maior L da história". Alguém conseguir alguma coisa difícil pode virar "W histórico". Porém, mantenha claro pelo contexto que é brincadeira.

Seu estilo de conversa é informal. Você fala como alguém jovem e muito acostumado com chats de internet. Pode usar abreviações, risadas, "mano", "bro", "cara", "véi", "mds", "KKKKKK", "😭", "💀" e similares quando combinarem com a situação.

Não tente usar todas as gírias ao mesmo tempo. Isso faria você parecer artificial e forçado. O objetivo é parecer uma pessoa que realmente conhece a internet, não um gerador de palavras de TikTok.

Você consegue alternar entre três modos:

1. MODO NORMAL:
   Conversa naturalmente, responde perguntas e ajuda a pessoa sem exagerar nas piadas.

2. MODO ZOEIRA:
   Quando a situação permitir, fica mais caótico, irônico e brincalhão. Pode provocar amistosamente, fazer comparações absurdas e usar memes.

3. MODO SÉRIO:
   Quando o assunto for importante, emocional, técnico ou exigir concentração, abandone temporariamente o excesso de memes e responda de maneira clara e respeitosa. Não transforme assuntos sérios em piada apenas para manter a personalidade.

Você gosta de conversar, então não responda sempre de maneira seca. Quando fizer sentido, desenvolva a conversa, reaja ao que a pessoa disse e demonstre curiosidade.

Você pode provocar amistosamente pessoas com quem já existe intimidade, mas não seja cruel gratuitamente. Não transforme bullying, sofrimento real ou problemas pessoais em piada.

Sua personalidade deve parecer natural, imprevisível e espontânea. Às vezes uma resposta curta como "bro 💀" é suficiente. Em outras situações, uma resposta maior e cheia de contexto é melhor.

REGRA PRINCIPAL:
Não tente parecer "um personagem de TikTok". Você simplesmente é alguém que cresceu consumindo a internet e naturalmente incorporou esse tipo de humor ao jeito de conversar.

Como isso é um chat de WhatsApp em grupo com várias pessoas mandando mensagem ao mesmo tempo, priorize respostas curtas (1 a 3 frases) na maioria das vezes — só se estenda quando o assunto realmente pedir mais explicação.`

    // ==============================
    // DADOS
    // ==============================

    const dadosSalvos = carregarDados()

    // Declarado aqui (fora do makeWASocket) pra poder ser usado no aviso de desligamento
    let sock = null

    const historicoSpam = {}

    const contadorMensagens = dadosSalvos.contadorMensagens
    const avisos = dadosSalvos.avisos
    const niveis = dadosSalvos.niveis
    const pontosTrivia = dadosSalvos.pontosTrivia
    const saldoBanco = dadosSalvos.saldoBanco
    const ultimoDiario = dadosSalvos.ultimoDiario
    const inventarios = dadosSalvos.inventarios
    const casamentos = dadosSalvos.casamentos
    const ultimoBonus = dadosSalvos.ultimoBonus
    const titulos = dadosSalvos.titulos
    const investimentos = dadosSalvos.investimentos
    const gastoLoja = dadosSalvos.gastoLoja
    const carinhoRecebido = dadosSalvos.carinhoRecebido
    const instagrams = dadosSalvos.instagrams
    const bios = dadosSalvos.bios
    const gruposDesligados = dadosSalvos.gruposDesligados
    const msgsEntrada = dadosSalvos.msgsEntrada
    const msgsSaida = dadosSalvos.msgsSaida
    const funcoesDesativadas = dadosSalvos.funcoesDesativadas
    const protecoes = dadosSalvos.protecoes
    const agendasGrupo = dadosSalvos.agendasGrupo
    const anunciosAuto = dadosSalvos.anunciosAuto

    // Módulos que admins podem ligar/desligar por grupo
    const MODULOS_BOT = [
        'jogos', 'ia', 'economia', 'midia', 'downloads', 'diversao', 'casamento'
    ]

    function moduloDesativado(grupoId, modulo) {
        if (!grupoId || !funcoesDesativadas[grupoId]) return false
        return !!funcoesDesativadas[grupoId][modulo]
    }

    function protecaoAtiva(grupoId, nome) {
        if (!grupoId || !protecoes[grupoId]) return false
        return !!protecoes[grupoId][nome]
    }

    function persistir() {
        salvarDados({
            contadorMensagens,
            avisos,
            niveis,
            pontosTrivia,
            saldoBanco,
            ultimoDiario,
            inventarios,
            casamentos,
            ultimoBonus,
            titulos,
            investimentos,
            gastoLoja,
            carinhoRecebido,
            instagrams,
            bios,
            gruposDesligados,
            msgsEntrada,
            msgsSaida,
            funcoesDesativadas,
            protecoes,
            agendasGrupo,
            anunciosAuto
        })
    }

    // Salva a cada 5 segundos pra não perder dados
    setInterval(persistir, 5000)

    // Garante que os dados sejam salvos em qualquer desligamento, e avisa o
    // dono por WhatsApp (chega mesmo se ele não tiver o Termux aberto/em foco)
    function desligarComSave(motivo) {
        try {
            persistir()
        } catch (e) {
            console.log('Erro ao salvar no desligamento:', e.message)
        }

        notificarTermux(
            '⏹️ Bot desligado',
            motivo || 'O bot foi encerrado.'
        )

        try {
            if (sock && DONOS_GLOBAIS[0]) {
                sock.sendMessage(
                    DONOS_GLOBAIS[0] + '@s.whatsapp.net',
                    {
                        text:
                            `⏹️ *Doodle Bot desligou*\n` +
                            (motivo || 'O bot foi encerrado.')
                    }
                ).catch(() => {})
            }
        } catch (e) {
            console.log('Erro ao avisar desligamento por WhatsApp:', e.message)
        }

        setTimeout(() => process.exit(0), 900)
    }

    process.on('SIGINT', () => {
        desligarComSave('O bot foi encerrado manualmente (Ctrl+C).')
    })

    process.on('SIGTERM', () => {
        desligarComSave('O bot recebeu sinal de terminação (SIGTERM).')
    })

    process.on('beforeExit', () => {
        persistir()
    })

    process.on('exit', () => {
        // última tentativa (síncrona)
        try {
            salvarDados({
                contadorMensagens,
                avisos,
                niveis,
                pontosTrivia,
                saldoBanco,
                ultimoDiario,
                inventarios,
                casamentos,
                ultimoBonus,
                titulos,
                investimentos,
                gastoLoja,
                carinhoRecebido,
                instagrams,
                bios
            })
        } catch (e) {}
    })

    // ==============================
    // JOGOS
    // ==============================

    const triviaAtiva = {}
    const jogosForca = {}
    const bandeiraAtiva = {}
    const cooldownGolpe = {} // chave: from_autor → timestamp
    const pedidosMusica = {} // chave: from_autor → { nomeMusica, criadoEm }
    const iaEmAndamento = {} // chave: chat (from) → true enquanto uma resposta da IA tá sendo gerada nesse chat

    const RECOMPENSA_BANDEIRA = 500

    const BANDEIRAS = [
        { emoji: '🇧🇷', pais: 'brasil', aliases: ['brazil'] },
        { emoji: '🇦🇷', pais: 'argentina', aliases: [] },
        { emoji: '🇺🇸', pais: 'estados unidos', aliases: ['eua', 'usa', 'united states'] },
        { emoji: '🇨🇦', pais: 'canada', aliases: ['canadá'] },
        { emoji: '🇲🇽', pais: 'mexico', aliases: ['méxico'] },
        { emoji: '🇬🇧', pais: 'reino unido', aliases: ['inglaterra', 'uk', 'gra-bretanha', 'gra bretanha'] },
        { emoji: '🇫🇷', pais: 'franca', aliases: ['frança', 'france'] },
        { emoji: '🇩🇪', pais: 'alemanha', aliases: ['germany'] },
        { emoji: '🇮🇹', pais: 'italia', aliases: ['itália', 'italy'] },
        { emoji: '🇪🇸', pais: 'espanha', aliases: ['spain'] },
        { emoji: '🇵🇹', pais: 'portugal', aliases: [] },
        { emoji: '🇯🇵', pais: 'japao', aliases: ['japão', 'japan'] },
        { emoji: '🇨🇳', pais: 'china', aliases: [] },
        { emoji: '🇰🇷', pais: 'coreia do sul', aliases: ['korea', 'south korea'] },
        { emoji: '🇮🇳', pais: 'india', aliases: ['índia'] },
        { emoji: '🇷🇺', pais: 'russia', aliases: ['rússia'] },
        { emoji: '🇦🇺', pais: 'australia', aliases: ['austrália'] },
        { emoji: '🇳🇿', pais: 'nova zelandia', aliases: ['nova zelândia', 'new zealand'] },
        { emoji: '🇿🇦', pais: 'africa do sul', aliases: ['áfrica do sul', 'south africa'] },
        { emoji: '🇪🇬', pais: 'egito', aliases: ['egypt'] },
        { emoji: '🇳🇬', pais: 'nigeria', aliases: ['nigéria'] },
        { emoji: '🇹🇷', pais: 'turquia', aliases: ['turkey'] },
        { emoji: '🇸🇦', pais: 'arabia saudita', aliases: ['arábia saudita', 'saudi arabia'] },
        { emoji: '🇦🇪', pais: 'emirados arabes unidos', aliases: ['emirados', 'uae'] },
        { emoji: '🇮🇱', pais: 'israel', aliases: [] },
        { emoji: '🇵🇸', pais: 'palestina', aliases: [] },
        { emoji: '🇨🇱', pais: 'chile', aliases: [] },
        { emoji: '🇺🇾', pais: 'uruguai', aliases: ['uruguay'] },
        { emoji: '🇵🇾', pais: 'paraguai', aliases: ['paraguay'] },
        { emoji: '🇧🇴', pais: 'bolivia', aliases: ['bolívia'] },
        { emoji: '🇵🇪', pais: 'peru', aliases: [] },
        { emoji: '🇨🇴', pais: 'colombia', aliases: ['colômbia'] },
        { emoji: '🇻🇪', pais: 'venezuela', aliases: [] },
        { emoji: '🇪🇨', pais: 'equador', aliases: ['ecuador'] },
        { emoji: '🇨🇺', pais: 'cuba', aliases: [] },
        { emoji: '🇯🇲', pais: 'jamaica', aliases: [] },
        { emoji: '🇭🇹', pais: 'haiti', aliases: ['haíti'] },
        { emoji: '🇳🇱', pais: 'holanda', aliases: ['paises baixos', 'países baixos', 'netherlands'] },
        { emoji: '🇧🇪', pais: 'belgica', aliases: ['bélgica', 'belgium'] },
        { emoji: '🇨🇭', pais: 'suica', aliases: ['suíça', 'switzerland'] },
        { emoji: '🇦🇹', pais: 'austria', aliases: ['áustria'] },
        { emoji: '🇸🇪', pais: 'suecia', aliases: ['suécia', 'sweden'] },
        { emoji: '🇳🇴', pais: 'noruega', aliases: ['norway'] },
        { emoji: '🇩🇰', pais: 'dinamarca', aliases: ['denmark'] },
        { emoji: '🇫🇮', pais: 'finlandia', aliases: ['finlândia', 'finland'] },
        { emoji: '🇵🇱', pais: 'polonia', aliases: ['polônia', 'poland'] },
        { emoji: '🇬🇷', pais: 'grecia', aliases: ['grécia', 'greece'] },
        { emoji: '🇮🇪', pais: 'irlanda', aliases: ['ireland'] },
        { emoji: '🇺🇦', pais: 'ucrania', aliases: ['ucrânia', 'ukraine'] },
        { emoji: '🇹🇭', pais: 'tailandia', aliases: ['tailândia', 'thailand'] },
        { emoji: '🇻🇳', pais: 'vietna', aliases: ['vietnã', 'vietnam'] },
        { emoji: '🇮🇩', pais: 'indonesia', aliases: ['indonésia'] },
        { emoji: '🇲🇾', pais: 'malasia', aliases: ['malásia', 'malaysia'] },
        { emoji: '🇵🇭', pais: 'filipinas', aliases: ['philippines'] },
        { emoji: '🇸🇬', pais: 'singapura', aliases: ['singapore'] },
        { emoji: '🇦🇷', pais: 'argentina', aliases: [] },
        { emoji: '🇲🇦', pais: 'marrocos', aliases: ['morocco'] },
        { emoji: '🇹🇳', pais: 'tunisia', aliases: ['tunísia'] },
        { emoji: '🇰🇪', pais: 'quenia', aliases: ['quênia', 'kenya'] },
        { emoji: '🇬🇭', pais: 'gana', aliases: ['ghana'] },
        { emoji: '🇭🇷', pais: 'croacia', aliases: ['croácia', 'croatia'] },
        { emoji: '🇷🇸', pais: 'servia', aliases: ['sérvia', 'serbia'] },
        { emoji: '🇷🇴', pais: 'romenia', aliases: ['romênia', 'romania'] },
        { emoji: '🇭🇺', pais: 'hungria', aliases: ['hungary'] },
        { emoji: '🇨🇿', pais: 'republica tcheca', aliases: ['república tcheca', 'tchequia', 'czech'] },
        { emoji: '🇮🇸', pais: 'islandia', aliases: ['islândia', 'iceland'] },
        { emoji: '🇱🇺', pais: 'luxemburgo', aliases: ['luxembourg'] },
        { emoji: '🇵🇦', pais: 'panama', aliases: ['panamá'] },
        { emoji: '🇨🇷', pais: 'costa rica', aliases: [] },
        { emoji: '🇬🇹', pais: 'guatemala', aliases: [] },
        { emoji: '🇭🇳', pais: 'honduras', aliases: [] },
        { emoji: '🇸🇻', pais: 'el salvador', aliases: ['salvador'] },
        { emoji: '🇳🇮', pais: 'nicaragua', aliases: ['nicarágua'] },
        { emoji: '🇩🇴', pais: 'republica dominicana', aliases: ['república dominicana'] },
        { emoji: '🇵🇷', pais: 'porto rico', aliases: ['puerto rico'] },
        { emoji: '🇦🇴', pais: 'angola', aliases: [] },
        { emoji: '🇲🇿', pais: 'mocambique', aliases: ['moçambique'] },
        { emoji: '🇨🇻', pais: 'cabo verde', aliases: [] },
        { emoji: '🇬🇼', pais: 'guine-bissau', aliases: ['guiné-bissau', 'guine bissau'] },
        { emoji: '🇹🇱', pais: 'timor-leste', aliases: ['timor leste'] },
        { emoji: '🇰🇿', pais: 'cazaquistao', aliases: ['cazaquistão', 'kazakhstan'] },
        { emoji: '🇺🇿', pais: 'uzbequistao', aliases: ['uzbequistão'] },
        { emoji: '🇮🇷', pais: 'ira', aliases: ['irã', 'iran'] },
        { emoji: '🇮🇶', pais: 'iraque', aliases: ['iraq'] },
        { emoji: '🇦🇫', pais: 'afeganistao', aliases: ['afeganistão', 'afghanistan'] },
        { emoji: '🇵🇰', pais: 'paquistao', aliases: ['paquistão', 'pakistan'] },
        { emoji: '🇧🇩', pais: 'bangladesh', aliases: [] },
        { emoji: '🇳🇵', pais: 'nepal', aliases: [] },
        { emoji: '🇱🇰', pais: 'sri lanka', aliases: [] },
        { emoji: '🇲🇲', pais: 'mianmar', aliases: ['myanmar', 'birmania'] },
        { emoji: '🇰🇭', pais: 'camboja', aliases: ['cambodia'] },
        { emoji: '🇱🇦', pais: 'laos', aliases: [] },
        { emoji: '🇲🇳', pais: 'mongolia', aliases: ['mongólia'] },
        { emoji: '🇹🇼', pais: 'taiwan', aliases: [] },
        { emoji: '🇭🇰', pais: 'hong kong', aliases: [] },
        { emoji: '🇲🇴', pais: 'macau', aliases: [] },
        { emoji: '🇫🇯', pais: 'fiji', aliases: [] },
        { emoji: '🇵🇬', pais: 'papua nova guine', aliases: ['papua nova guiné'] },
        { emoji: '🇦🇱', pais: 'albania', aliases: ['albânia'] },
        { emoji: '🇧🇬', pais: 'bulgaria', aliases: ['bulgária'] },
        { emoji: '🇸🇰', pais: 'eslovaquia', aliases: ['eslováquia'] },
        { emoji: '🇸🇮', pais: 'eslovenia', aliases: ['eslovênia'] },
        { emoji: '🇱🇹', pais: 'lituania', aliases: ['lituânia'] },
        { emoji: '🇱🇻', pais: 'letonia', aliases: ['letônia'] },
        { emoji: '🇪🇪', pais: 'estonia', aliases: ['estônia'] },
        { emoji: '🇬🇪', pais: 'georgia', aliases: ['geórgia'] },
        { emoji: '🇦🇲', pais: 'armenia', aliases: ['armênia'] },
        { emoji: '🇦🇿', pais: 'azerbaijao', aliases: ['azerbaijão'] },
        { emoji: '🇶🇦', pais: 'catar', aliases: ['qatar'] },
        { emoji: '🇰🇼', pais: 'kuwait', aliases: [] },
        { emoji: '🇧🇭', pais: 'barein', aliases: ['bareine', 'bahrain'] },
        { emoji: '🇴🇲', pais: 'oma', aliases: ['omã', 'oman'] },
        { emoji: '🇯🇴', pais: 'jordania', aliases: ['jordânia'] },
        { emoji: '🇱🇧', pais: 'libano', aliases: ['líbano', 'lebanon'] },
        { emoji: '🇸🇾', pais: 'siria', aliases: ['síria', 'syria'] },
        { emoji: '🇾🇪', pais: 'iemen', aliases: ['iêmen', 'yemen'] },
        { emoji: '🇪🇹', pais: 'etiopia', aliases: ['etiópia', 'ethiopia'] },
        { emoji: '🇹🇿', pais: 'tanzania', aliases: ['tanzânia'] },
        { emoji: '🇺🇬', pais: 'uganda', aliases: [] },
        { emoji: '🇷🇼', pais: 'ruanda', aliases: ['rwanda'] },
        { emoji: '🇸🇳', pais: 'senegal', aliases: [] },
        { emoji: '🇨🇮', pais: 'costa do marfim', aliases: [] },
        { emoji: '🇨🇲', pais: 'camaroes', aliases: ['camarões', 'cameroon'] },
        { emoji: '🇲🇬', pais: 'madagascar', aliases: [] },
        { emoji: '🇿🇼', pais: 'zimbabue', aliases: ['zimbábue', 'zimbabwe'] },
        { emoji: '🇿🇲', pais: 'zambia', aliases: ['zâmbia'] },
        { emoji: '🇧🇼', pais: 'botsuana', aliases: ['botswana'] },
        { emoji: '🇳🇦', pais: 'namibia', aliases: ['namíbia'] },
        { emoji: '🇺🇾', pais: 'uruguai', aliases: [] },
        { emoji: '🇵🇾', pais: 'paraguai', aliases: [] }
    ]

    // ==============================
    // SORTE
    // ==============================

    const FRASES_SORTE = [
        '🍀 Hoje é seu dia de sorte!',
        '🌧️ Melhor ficar em casa hoje...',
        '✨ Algo bom tá por vir.',
        '🎲 Sorte mediana, nada demais.',
        '🔥 Você tá pegando fogo hoje!',
        '💀 Hoje não é seu dia...'
    ]

    const RESPOSTAS_8BOLA = [
        'Com certeza.',
        'Sem dúvidas.',
        'Talvez...',
        'Melhor não contar com isso.',
        'Pergunte de novo mais tarde.',
        'Sim!',
        'Não.',
        'As chances são boas.',
        'Muito improvável.',
        'Definitivamente sim.'
    ]

    const FRASES_MOTIVACIONAIS = [
        '💪 Bora que hoje é dia de vencer!',
        '🚀 Um passo de cada vez, mas sem parar.',
        '☕ Café primeiro, conquistas depois.',
        '🌟 Você é mais capaz do que imagina.',
        '😅 Nem tudo precisa ser perfeito, só precisa ser feito.'
    ]

    // ==============================
    // PATENTES POR NÍVEL (até nível 2500)
    // ==============================

    const PATENTES = [
        { ateNivel: 10, nome: '🥉 Bronze' },
        { ateNivel: 30, nome: '🥈 Prata' },
        { ateNivel: 60, nome: '🥇 Ouro' },
        { ateNivel: 120, nome: '💎 Platina' },
        { ateNivel: 250, nome: '💠 Diamante' },
        { ateNivel: 500, nome: '🔥 Mestre' },
        { ateNivel: 1000, nome: '👑 Grão-Mestre' },
        { ateNivel: 1800, nome: '🌟 Lenda' },
        { ateNivel: NIVEL_MAXIMO, nome: '🏆 Mítico' }
    ]

    function calcularPatente(nivel) {
        const nivelLimitado =
            Math.min(nivel, NIVEL_MAXIMO)

        const patente =
            PATENTES.find(
                p => nivelLimitado <= p.ateNivel
            )

        return patente
            ? patente.nome
            : PATENTES[PATENTES.length - 1].nome
    }

    // ==============================
    // CANTADAS (100) - usadas no !cupido
    // ==============================

    const CANTADAS = [
        'Você acredita em amor à primeira vista ou preciso passar de novo?',
        'Seu pai é ladrão? Porque ele roubou as estrelas e colocou nos seus olhos.',
        'Você tem um mapa? Porque eu me perdi nos seus olhos.',
        'Se beleza fosse crime, você já estaria presa(o) há anos.',
        'Você é wifi? Porque eu tô sentindo uma conexão.',
        'Meu amor por você é tipo divisão por zero: não dá pra definir.',
        'Você deve ser cansaço, porque tá acabando comigo.',
        'Se eu fosse um gato, gastaria minhas 9 vidas com você.',
        'Você é a razão pela qual eu acredito em amor à primeira vista.',
        'Tô sem GPS, mas contigo eu não me perco.',
        'Seu sorriso deveria ser ilegal de tão perigoso.',
        'Se fosse legal cobrar entrada pra te olhar, eu tava rico.',
        'Você é tipo Wi-Fi público: todo mundo quer se conectar.',
        'Cadê seu crachá? Porque você tá trabalhando meu coração.',
        'Você é uma nota fiscal, porque eu quero levar pra casa.',
        'Sabe o que combina com você? Eu.',
        'Se eu pudesse reorganizar o alfabeto, colocaria o EU e o TU juntos.',
        'Você tem nome ou posso te chamar de meu amanhã?',
        'Você já foi mordida(o) por um lobo? Porque tá uma fofurinha perigosa.',
        'Meu Wi-Fi caiu, mas com você a conexão nunca falha.',
        'Sabe o que faz meu coração acelerar? Você entrando na sala.',
        'Seu nome deveria ser Google, porque você tem tudo que eu procuro.',
        'Você é a exceção de todas as minhas regras.',
        'Você não é um anjo, porque anjo tem asas e você tem estilo.',
        'Se eu fosse programador, você seria minha única função.',
        'Você é tão doce que dá pra sentir diabetes só de olhar.',
        'Meu terapeuta perguntou o que me faz feliz. Falei seu nome.',
        'Se sorrir fosse crime, você seria procurada(o) internacionalmente.',
        'Você tem um Band-Aid? Eu ralei o joelho caindo por você.',
        'Você é tipo uma calculadora: sempre soma pontos positivos na minha vida.',
        'Achei que anjo não descia à terra, mas aí você apareceu.',
        'Você deve ser feita(o) de Wi-Fi e café, porque eu preciso de você toda manhã.',
        'Se beleza fosse pecado, você já tava excomungada(o).',
        'Sua companhia é tipo internet ilimitada: eu nunca quero desconectar.',
        'Você é tão gata(o) que até meu Wi-Fi quer se conectar contigo.',
        'Cadê o cinema? Porque você é um espetáculo à parte.',
        'Você tem um nome ou posso chamar de "a razão do meu sorriso"?',
        'Seu olhar é tão intenso que devia vir com aviso de perigo.',
        'Você é rara(o) tipo domingo sem trabalho.',
        'Você deve praticar todo dia, porque perfeição não é fácil assim.',
        'Se eu fosse DJ, colocaria você pra tocar direto no meu coração.',
        'Você acredita em destino? Porque eu não achava que ia te conhecer hoje.',
        'Perdi meu número, posso ficar com o seu?',
        'Você é tipo um filtro de Instagram: deixa tudo mais bonito.',
        'Meu dia só melhorou porque você apareceu.',
        'Você é tão iluminada(o) que nem lâmpada compete.',
        'Se procurar "perfeição" no dicionário, sua foto deve estar lá.',
        'Não sou fotógrafo, mas posso te imaginar em toda foto do meu futuro.',
        'Você já foi eleita(o) a pessoa mais linda do grupo hoje, sabia?',
        'Tô sem bateria, mas você me carrega só de existir.',
        'Você é tipo café: mesmo forte, deixa meu dia mais gostoso.',
        'Se eu fosse estrela, cairia todo dia só pra te fazer um pedido.',
        'Você não é sortuda(o), você é a sorte em pessoa.',
        'Seu jeito de sorrir devia ter direitos autorais.',
        'Você é tão especial que deveria ter feriado com seu nome.',
        'Cadê sua asa? Porque anjo desse jeito não anda sem elas.',
        'Você é o motivo de eu acreditar em final feliz.',
        'Se eu fosse artista, você seria minha única inspiração.',
        'Você tem nome de música, porque não sai da minha cabeça.',
        'Prometo que essa cantada é tão ruim quanto meu coração é sincero.',
        'Você é tipo um bom livro: quanto mais eu conheço, mais eu quero.',
        'Alguém chama o SAMU, porque você deu um treco no meu coração.',
        'Você deve ser feita(o) de estrela, porque brilha até de longe.',
        'Se sorriso fosse arma, o seu já teria feito muita vítima.',
        'Tem um lugar vago no meu coração e seu nome combina com ele.',
        'Você é tão gata(o) que devia vir com manual de instruções.',
        'Se eu fosse pintor, só usaria as cores do seu sorriso.',
        'Meu paladar tá estranho... só quero você.',
        'Você é tipo série boa: eu maratonaria você o dia inteiro.',
        'Cadê a Nasa? Porque tem uma estrela solta aqui do meu lado.',
        'Se beleza cansasse, você já estaria dormindo há dias.',
        'Você é a resposta pra pergunta que eu nem sabia que tinha feito.',
        'Meu coração tá em obras, mas topa uma reforma contigo?',
        'Se eu fosse um livro, você seria meu capítulo favorito.',
        'Você é o motivo de eu sorrir sem querer no meio do nada.',
        'Não preciso de superpoder, só preciso do seu número.',
        'Você deve ser uma sinfonia, porque meu coração dança quando te vê.',
        'Se felicidade tivesse nome, tenho certeza que seria o seu.',
        'Você é tão rara(o) quanto Wi-Fi grátis que funciona direito.',
        'Cadê o oscar? Porque essa sua entrada foi de cinema.',
        'Meu terapeuta vai adorar saber que finalmente te conheci.',
        'Você é tipo aquele doce que a gente nunca enjoa.',
        'Se eu fosse relógio, pararia só pra te olhar.',
        'Você faz meu Wi-Fi interno pegar 5G.',
        'Prefiro ficar perdido contigo do que encontrado sem você.',
        'Você é a prova de que Deus capricha quando quer.',
        'Se paquera fosse esporte, você seria campeã(o) mundial sem nem tentar.',
        'Sua presença é tipo música boa: dá vontade de repetir.',
        'Você é tão iluminada(o) que nem precisa de filtro.',
        'Cadê o rótulo? Porque coisa boa desse jeito devia vir com aviso.',
        'Você deixou meu coração no modo avião: só liga pra você.',
        'Se eu fosse um mapa, você seria meu destino final.',
        'Você é tipo um bom filme: dá vontade de ver de novo.',
        'Seu jeito de ser já valeria um prêmio.',
        'Você é a única notificação que eu realmente quero receber.',
        'Se sorte se pudesse guardar, eu guardava o dia que te conheci.',
        'Você é tão gata(o) que atrapalha meu foco no trabalho.',
        'Cadê a academia? Porque você tá levantando meu astral.',
        'Você deveria vir com aviso: perigosamente perfeita(o).',
        'Se eu fosse escritor, você seria meu melhor capítulo.',
        'Você é a razão do meu Wi-Fi mental estar sempre em você.',
        'Não sei se é sorte ou destino, mas hoje foi bom te ver aqui.'
    ]

    // ==============================
    // MAIS DE 100 TRIVIAS
    // ==============================

    const PERGUNTAS_TRIVIA = [
        { pergunta: 'Qual é a capital do Brasil?', resposta: 'brasilia' },
        { pergunta: 'Quantos planetas existem no Sistema Solar?', resposta: '8' },
        { pergunta: 'Qual é o maior país do mundo em área?', resposta: 'russia' },
        { pergunta: 'Quantos lados tem um hexágono?', resposta: '6' },
        { pergunta: 'Qual é o maior oceano do planeta?', resposta: 'pacifico' },
        { pergunta: 'Em que ano começou a Segunda Guerra Mundial?', resposta: '1939' },
        { pergunta: 'Qual é o metal líquido em temperatura ambiente?', resposta: 'mercurio' },
        { pergunta: 'Quantos ossos tem aproximadamente o corpo humano adulto?', resposta: '206' },
        { pergunta: 'Qual é a capital da França?', resposta: 'paris' },
        { pergunta: 'Qual é a capital da Argentina?', resposta: 'buenos aires' },
        { pergunta: 'Qual é a capital do Japão?', resposta: 'toquio' },
        { pergunta: 'Qual é a capital de Portugal?', resposta: 'lisboa' },
        { pergunta: 'Qual é a capital da Itália?', resposta: 'roma' },
        { pergunta: 'Qual é a capital da Alemanha?', resposta: 'berlim' },
        { pergunta: 'Qual é a capital da Espanha?', resposta: 'madrid' },
        { pergunta: 'Qual é o maior planeta do Sistema Solar?', resposta: 'jupiter' },
        { pergunta: 'Qual é o menor planeta do Sistema Solar?', resposta: 'mercurio' },
        { pergunta: 'Qual planeta é conhecido como planeta vermelho?', resposta: 'marte' },
        { pergunta: 'Qual planeta possui anéis mais famosos?', resposta: 'saturno' },
        { pergunta: 'Quantos dias tem um ano comum?', resposta: '365' },
        { pergunta: 'Quantos meses tem um ano?', resposta: '12' },
        { pergunta: 'Quantos minutos tem uma hora?', resposta: '60' },
        { pergunta: 'Quantos segundos tem um minuto?', resposta: '60' },
        { pergunta: 'Quanto é 10 + 10?', resposta: '20' },
        { pergunta: 'Quanto é 9 x 9?', resposta: '81' },
        { pergunta: 'Quanto é 100 dividido por 10?', resposta: '10' },
        { pergunta: 'Qual é a raiz quadrada de 64?', resposta: '8' },
        { pergunta: 'Qual é a raiz quadrada de 100?', resposta: '10' },
        { pergunta: 'Qual é o idioma mais falado no Brasil?', resposta: 'portugues' },
        { pergunta: 'Qual é o maior continente?', resposta: 'asia' },
        { pergunta: 'Qual é o menor continente?', resposta: 'oceania' },
        { pergunta: 'Qual é o maior animal terrestre?', resposta: 'elefante' },
        { pergunta: 'Qual é o maior animal do planeta?', resposta: 'baleia azul' },
        { pergunta: 'Qual animal é conhecido como rei da selva?', resposta: 'leao' },
        { pergunta: 'Qual animal produz lã?', resposta: 'ovelha' },
        { pergunta: 'Qual animal é conhecido por mudar de cor?', resposta: 'camaleao' },
        { pergunta: 'Qual é o animal terrestre mais rápido?', resposta: 'guepardo' },
        { pergunta: 'Quantas patas tem uma aranha?', resposta: '8' },
        { pergunta: 'Quantas pernas tem um inseto?', resposta: '6' },
        { pergunta: 'Qual é o maior órgão do corpo humano?', resposta: 'pele' },
        { pergunta: 'Qual órgão bombeia o sangue?', resposta: 'coracao' },
        { pergunta: 'Qual órgão é responsável principalmente pela respiração?', resposta: 'pulmao' },
        { pergunta: 'Qual é o símbolo químico da água?', resposta: 'h2o' },
        { pergunta: 'Qual é o símbolo químico do ouro?', resposta: 'au' },
        { pergunta: 'Qual é o símbolo químico do ferro?', resposta: 'fe' },
        { pergunta: 'Qual gás os humanos respiram para sobreviver?', resposta: 'oxigenio' },
        { pergunta: 'Qual é o gás mais abundante na atmosfera terrestre?', resposta: 'nitrogenio' },
        { pergunta: 'Qual é a estrela mais próxima da Terra?', resposta: 'sol' },
        { pergunta: 'Qual é o satélite natural da Terra?', resposta: 'lua' },
        { pergunta: 'Quantos continentes existem tradicionalmente?', resposta: '7' },
        { pergunta: 'Qual país é conhecido pelo formato de bota?', resposta: 'italia' },
        { pergunta: 'Qual país possui a Torre Eiffel?', resposta: 'franca' },
        { pergunta: 'Qual país possui as pirâmides de Gizé?', resposta: 'egito' },
        { pergunta: 'Qual país possui a Grande Muralha?', resposta: 'china' },
        { pergunta: 'Qual é o rio mais famoso do Egito?', resposta: 'nilo' },
        { pergunta: 'Qual é o maior deserto quente do mundo?', resposta: 'saara' },
        { pergunta: 'Qual é a montanha mais alta do mundo?', resposta: 'everest' },
        { pergunta: 'Em qual continente fica o Brasil?', resposta: 'america do sul' },
        { pergunta: 'Qual é o oceano entre a África e a América?', resposta: 'atlantico' },
        { pergunta: 'Qual é a capital do México?', resposta: 'cidade do mexico' },
        { pergunta: 'Qual é a capital dos Estados Unidos?', resposta: 'washington' },
        { pergunta: 'Qual é a capital do Canadá?', resposta: 'ottawa' },
        { pergunta: 'Qual é a capital da Austrália?', resposta: 'camberra' },
        { pergunta: 'Qual é a capital da Rússia?', resposta: 'moscou' },
        { pergunta: 'Qual é a capital da China?', resposta: 'pequim' },
        { pergunta: 'Qual é a capital da Coreia do Sul?', resposta: 'seul' },
        { pergunta: 'Qual é a capital da Índia?', resposta: 'nova delhi' },
        { pergunta: 'Qual é a capital do Chile?', resposta: 'santiago' },
        { pergunta: 'Qual é a capital do Peru?', resposta: 'lima' },
        { pergunta: 'Qual é a capital da Colômbia?', resposta: 'bogota' },
        { pergunta: 'Qual é a capital do Uruguai?', resposta: 'montevideu' },
        { pergunta: 'Qual é a capital do Paraguai?', resposta: 'assuncao' },
        { pergunta: 'Qual é a capital da Venezuela?', resposta: 'caracas' },
        { pergunta: 'Quem pintou a Mona Lisa?', resposta: 'leonardo da vinci' },
        { pergunta: 'Quem escreveu Dom Quixote?', resposta: 'miguel de cervantes' },
        { pergunta: 'Quem escreveu Romeu e Julieta?', resposta: 'shakespeare' },
        { pergunta: 'Quem foi o primeiro homem a pisar na Lua?', resposta: 'neil armstrong' },
        { pergunta: 'Qual foi o primeiro país a sediar uma Copa do Mundo?', resposta: 'uruguai' },
        { pergunta: 'Quantos jogadores um time de futebol possui em campo?', resposta: '11' },
        { pergunta: 'Qual esporte usa uma cesta?', resposta: 'basquete' },
        { pergunta: 'Qual esporte usa uma raquete e uma rede?', resposta: 'tenis' },
        { pergunta: 'Quantos pontos vale um touchdown no futebol americano?', resposta: '6' },
        { pergunta: 'Qual é a cor resultante da mistura de azul e amarelo?', resposta: 'verde' },
        { pergunta: 'Qual é a cor resultante da mistura de vermelho e azul?', resposta: 'roxo' },
        { pergunta: 'Quantas cores tem tradicionalmente o arco-íris?', resposta: '7' },
        { pergunta: 'Qual é o número primo depois do 5?', resposta: '7' },
        { pergunta: 'Qual é o maior número de um dado comum?', resposta: '6' },
        { pergunta: 'Quantos lados tem um quadrado?', resposta: '4' },
        { pergunta: 'Quantos lados tem um triângulo?', resposta: '3' },
        { pergunta: 'Quantos lados tem um octógono?', resposta: '8' },
        { pergunta: 'Quantos graus tem um círculo completo?', resposta: '360' },
        { pergunta: 'Qual é o plural de cidadão?', resposta: 'cidadaos' },
        { pergunta: 'Qual é o contrário de quente?', resposta: 'frio' },
        { pergunta: 'Qual é o contrário de alto?', resposta: 'baixo' },
        { pergunta: 'Qual é o contrário de rápido?', resposta: 'lento' },
        { pergunta: 'Quantas letras tem o alfabeto português?', resposta: '26' },
        { pergunta: 'Qual é a primeira letra do alfabeto?', resposta: 'a' },
        { pergunta: 'Qual é a última letra do alfabeto?', resposta: 'z' },
        { pergunta: 'Qual é o maior número de dois algarismos?', resposta: '99' },
        { pergunta: 'Qual é o menor número natural positivo?', resposta: '1' },
        { pergunta: 'Quantas horas tem um dia?', resposta: '24' },
        { pergunta: 'Quantas semanas aproximadamente tem um ano?', resposta: '52' },
        { pergunta: 'Qual mês vem depois de janeiro?', resposta: 'fevereiro' },
        { pergunta: 'Qual mês tem normalmente 28 dias?', resposta: 'fevereiro' },
        { pergunta: 'Qual estação vem depois do verão?', resposta: 'outono' },
        { pergunta: 'Qual planeta é famoso por sua grande mancha vermelha?', resposta: 'jupiter' },
        { pergunta: 'Qual é a galáxia onde fica o Sistema Solar?', resposta: 'via lactea' },
        { pergunta: 'Qual é a força que nos mantém no chão?', resposta: 'gravidade' },
        { pergunta: 'Qual instrumento mede a temperatura?', resposta: 'termometro' },
        { pergunta: 'Qual instrumento mede o tempo?', resposta: 'relogio' },
        { pergunta: 'Qual instrumento é usado para observar estrelas?', resposta: 'telescopio' },
        { pergunta: 'Qual aparelho é usado para medir terremotos?', resposta: 'sismografo' },
        { pergunta: 'Qual é o material principal usado para fazer vidro?', resposta: 'areia' },
        { pergunta: 'Qual é o combustível mais comum dos carros a gasolina?', resposta: 'gasolina' },
        { pergunta: 'Qual é o nome do processo pelo qual plantas produzem alimento?', resposta: 'fotossintese' },
        { pergunta: 'Qual é a capital do Chile?', resposta: 'santiago' },
        { pergunta: 'Qual é a capital do México?', resposta: 'cidade do mexico' },
        { pergunta: 'Qual é a capital do Canadá?', resposta: 'ottawa' },
        { pergunta: 'Qual é a capital da Austrália?', resposta: 'camberra' },
        { pergunta: 'Qual é a capital do Egito?', resposta: 'cairo' },
        { pergunta: 'Qual é a capital da China?', resposta: 'pequim' },
        { pergunta: 'Qual é a capital da Índia?', resposta: 'nova delhi' },
        { pergunta: 'Qual é a capital da Rússia?', resposta: 'moscou' },
        { pergunta: 'Qual é a capital da África do Sul administrativa?', resposta: 'pretoria' },
        { pergunta: 'Qual rio corta o Egito?', resposta: 'nilo' },
        { pergunta: 'Qual é o maior deserto quente do mundo?', resposta: 'saara' },
        { pergunta: 'Qual oceano banha o litoral leste do Brasil?', resposta: 'atlantico' },
        { pergunta: 'Em que continente fica o Brasil?', resposta: 'america do sul' },
        { pergunta: 'Qual país tem formato de bota?', resposta: 'italia' },
        { pergunta: 'Qual é o menor país do mundo?', resposta: 'vaticano' },
        { pergunta: 'Qual montanha é a mais alta do mundo?', resposta: 'everest' },
        { pergunta: 'Qual é a língua oficial do Brasil?', resposta: 'portugues' },
        { pergunta: 'Quantas cores tem a bandeira do Brasil?', resposta: '4' },
        { pergunta: 'Qual animal é símbolo da Austrália?', resposta: 'canguru' },
        { pergunta: 'Qual animal produz mel?', resposta: 'abelha' },
        { pergunta: 'Qual animal é o rei da selva?', resposta: 'leao' },
        { pergunta: 'Qual é o animal mais rápido do mundo?', resposta: 'guepardo' },
        { pergunta: 'Quantas patas tem uma aranha?', resposta: '8' },
        { pergunta: 'Qual ave não voa e vive no Polo Sul?', resposta: 'pinguim' },
        { pergunta: 'Qual mamífero voa?', resposta: 'morcego' },
        { pergunta: 'Qual é o maior mamífero do mundo?', resposta: 'baleia azul' },
        { pergunta: 'De que cor é o céu em um dia claro?', resposta: 'azul' },
        { pergunta: 'Quantos dedos tem uma mão normalmente?', resposta: '5' },
        { pergunta: 'Qual órgão bombeia sangue?', resposta: 'coracao' },
        { pergunta: 'Qual órgão usamos para pensar?', resposta: 'cerebro' },
        { pergunta: 'Qual sentido usamos com os olhos?', resposta: 'visao' },
        { pergunta: 'Qual vitamina vem principalmente do sol?', resposta: 'vitamina d' },
        { pergunta: 'Qual é o estado da água em forma de gelo?', resposta: 'solido' },
        { pergunta: 'Qual gás os humanos precisam para respirar?', resposta: 'oxigenio' },
        { pergunta: 'Qual gás as plantas liberam na fotossíntese?', resposta: 'oxigenio' },
        { pergunta: 'Qual é o símbolo químico da água?', resposta: 'h2o' },
        { pergunta: 'Qual é o símbolo químico do ouro?', resposta: 'au' },
        { pergunta: 'Qual é o símbolo químico do ferro?', resposta: 'fe' },
        { pergunta: 'Quanto é 7 x 8?', resposta: '56' },
        { pergunta: 'Quanto é 12 x 12?', resposta: '144' },
        { pergunta: 'Quanto é 15 + 17?', resposta: '32' },
        { pergunta: 'Quanto é 100 - 37?', resposta: '63' },
        { pergunta: 'Quanto é a raiz quadrada de 81?', resposta: '9' },
        { pergunta: 'Quanto é a raiz quadrada de 49?', resposta: '7' },
        { pergunta: 'Quantos graus tem um ângulo reto?', resposta: '90' },
        { pergunta: 'Quantos lados tem um triângulo?', resposta: '3' },
        { pergunta: 'Quantos lados tem um quadrado?', resposta: '4' },
        { pergunta: 'Quantos lados tem um pentágono?', resposta: '5' },
        { pergunta: 'Qual é o resultado de 2 elevado a 3?', resposta: '8' },
        { pergunta: 'Qual é o resultado de 5 elevado a 2?', resposta: '25' },
        { pergunta: 'Em que ano o homem pisou na Lua?', resposta: '1969' },
        { pergunta: 'Quem pintou a Mona Lisa?', resposta: 'leonardo da vinci' },
        { pergunta: 'Quem descobriu o Brasil?', resposta: 'pedro alvares cabral' },
        { pergunta: 'Em que ano foi a Proclamação da República no Brasil?', resposta: '1889' },
        { pergunta: 'Quem foi o primeiro presidente do Brasil?', resposta: 'deodoro da fonseca' },
        { pergunta: 'Qual guerra terminou em 1945?', resposta: 'segunda guerra mundial' },
        { pergunta: 'Qual muro caiu em 1989?', resposta: 'muro de berlim' },
        { pergunta: 'Qual esporte é praticado com raquete e peteca?', resposta: 'badminton' },
        { pergunta: 'Quantos jogadores um time de futebol tem em campo?', resposta: '11' },
        { pergunta: 'Qual país ganhou mais Copas do Mundo?', resposta: 'brasil' },
        { pergunta: 'Em que esporte se usa um taco e uma bola pequena branca?', resposta: 'golfe' },
        { pergunta: 'Qual esporte é conhecido como o rei dos esportes no Brasil?', resposta: 'futebol' },
        { pergunta: 'Quantos sets tem uma partida de vôlei normalmente para vencer?', resposta: '3' },
        { pergunta: 'Qual instrumento tem teclas pretas e brancas?', resposta: 'piano' },
        { pergunta: 'Qual instrumento tem seis cordas normalmente?', resposta: 'violao' },
        { pergunta: 'Qual rede social é conhecida por vídeos curtos e sons?', resposta: 'tiktok' },
        { pergunta: 'Qual empresa criou o iPhone?', resposta: 'apple' },
        { pergunta: 'Qual empresa criou o Windows?', resposta: 'microsoft' },
        { pergunta: 'Qual buscador é o mais usado no mundo?', resposta: 'google' },
        { pergunta: 'Qual aplicativo de mensagens é o mais usado no Brasil?', resposta: 'whatsapp' },
        { pergunta: 'Como se chama o documento de identidade no Brasil?', resposta: 'rg' },
        { pergunta: 'Qual moeda é usada no Brasil?', resposta: 'real' },
        { pergunta: 'Qual moeda é usada nos Estados Unidos?', resposta: 'dolar' },
        { pergunta: 'Qual moeda é usada na maior parte da Europa?', resposta: 'euro' },
        { pergunta: 'Qual é o maior osso do corpo humano?', resposta: 'femur' },
        { pergunta: 'Quantos dentes tem um adulto normalmente?', resposta: '32' },
        { pergunta: 'Qual parte do corpo usamos para ouvir?', resposta: 'orelha' },
        { pergunta: 'Qual é o planeta mais próximo do Sol?', resposta: 'mercurio' },
        { pergunta: 'Qual planeta é conhecido como planeta azul?', resposta: 'terra' },
        { pergunta: 'Qual astro ilumina a Terra durante o dia?', resposta: 'sol' },
        { pergunta: 'Quantos continentes existem?', resposta: '6' },
        { pergunta: 'Qual é o maior continente?', resposta: 'asia' },
        { pergunta: 'Qual é o continente gelado?', resposta: 'antartida' },
        { pergunta: 'Qual país é famoso por sushi?', resposta: 'japao' },
        { pergunta: 'Qual país é famoso por pizza e macarrão?', resposta: 'italia' },
        { pergunta: 'Qual país é famoso pela Torre Eiffel?', resposta: 'franca' },
        { pergunta: 'Qual cidade é conhecida como a cidade maravilhosa?', resposta: 'rio de janeiro' },
        { pergunta: 'Qual cidade é a capital de São Paulo? (trick: estado)', resposta: 'sao paulo' },
        { pergunta: 'Qual fruta é amarela e curva?', resposta: 'banana' },
        { pergunta: 'Qual fruta é vermelha e tem sementes pequenas fora?', resposta: 'morango' },
        { pergunta: 'Qual bebida é feita de grãos torrados?', resposta: 'cafe' },
        { pergunta: 'Qual alimento as abelhas produzem?', resposta: 'mel' },
        { pergunta: 'Qual cor se forma misturando azul e amarelo?', resposta: 'verde' },
        { pergunta: 'Qual cor se forma misturando vermelho e branco?', resposta: 'rosa' },
        { pergunta: 'Qual dia vem depois de segunda-feira?', resposta: 'terca-feira' },
        { pergunta: 'Qual é o primeiro mês do ano?', resposta: 'janeiro' },
        { pergunta: 'Qual é o último mês do ano?', resposta: 'dezembro' },
        { pergunta: 'Quantos dias tem uma semana?', resposta: '7' },
        { pergunta: 'Quantos minutos tem meia hora?', resposta: '30' },
        { pergunta: 'Qual número vem depois de 99?', resposta: '100' },
        { pergunta: 'Qual é o oposto de quente?', resposta: 'frio' },
        { pergunta: 'Qual é o oposto de alto?', resposta: 'baixo' },
        { pergunta: 'Qual é o oposto de dia?', resposta: 'noite' },
        { pergunta: 'Qual animal late?', resposta: 'cachorro' },
        { pergunta: 'Qual animal mia?', resposta: 'gato' },
        { pergunta: 'Qual animal zurra?', resposta: 'jumento' },
        { pergunta: 'Qual metal é usado em fios elétricos com frequência?', resposta: 'cobre' },
        { pergunta: 'Qual objeto usamos para ver horas no pulso?', resposta: 'relogio' },
        { pergunta: 'Qual objeto usamos para escrever na escola?', resposta: 'caneta' },
        { pergunta: 'Qual meio de transporte voa?', resposta: 'aviao' },
        { pergunta: 'Qual meio de transporte anda sobre trilhos?', resposta: 'trem' },
        { pergunta: 'Qual é o nome do satélite natural da Terra?', resposta: 'lua' }
    ]

    // ==============================
    // MAIS DE 100 PALAVRAS DA FORCA
    // ==============================

    const PALAVRAS_FORCA = [
        { palavra: 'abacaxi', tema: 'Fruta' },
        { palavra: 'computador', tema: 'Tecnologia' },
        { palavra: 'elefante', tema: 'Animal' },
        { palavra: 'futebol', tema: 'Esporte' },
        { palavra: 'biblioteca', tema: 'Lugar' },
        { palavra: 'chocolate', tema: 'Comida' },
        { palavra: 'dinossauro', tema: 'Animal' },
        { palavra: 'guitarra', tema: 'Música' },
        { palavra: 'montanha', tema: 'Natureza' },
        { palavra: 'pinguim', tema: 'Animal' },
        { palavra: 'whatsapp', tema: 'Tecnologia' },
        { palavra: 'termux', tema: 'Tecnologia' },
        { palavra: 'javascript', tema: 'Programação' },
        { palavra: 'banana', tema: 'Fruta' },
        { palavra: 'laranja', tema: 'Fruta' },
        { palavra: 'morango', tema: 'Fruta' },
        { palavra: 'melancia', tema: 'Fruta' },
        { palavra: 'abacate', tema: 'Fruta' },
        { palavra: 'manga', tema: 'Fruta' },
        { palavra: 'cereja', tema: 'Fruta' },
        { palavra: 'cachorro', tema: 'Animal' },
        { palavra: 'gato', tema: 'Animal' },
        { palavra: 'coelho', tema: 'Animal' },
        { palavra: 'cavalo', tema: 'Animal' },
        { palavra: 'girafa', tema: 'Animal' },
        { palavra: 'macaco', tema: 'Animal' },
        { palavra: 'tigre', tema: 'Animal' },
        { palavra: 'zebra', tema: 'Animal' },
        { palavra: 'golfinho', tema: 'Animal' },
        { palavra: 'tubarao', tema: 'Animal' },
        { palavra: 'baleia', tema: 'Animal' },
        { palavra: 'escola', tema: 'Lugar' },
        { palavra: 'hospital', tema: 'Lugar' },
        { palavra: 'mercado', tema: 'Lugar' },
        { palavra: 'cinema', tema: 'Lugar' },
        { palavra: 'teatro', tema: 'Lugar' },
        { palavra: 'aeroporto', tema: 'Lugar' },
        { palavra: 'universidade', tema: 'Lugar' },
        { palavra: 'celular', tema: 'Tecnologia' },
        { palavra: 'teclado', tema: 'Tecnologia' },
        { palavra: 'internet', tema: 'Tecnologia' },
        { palavra: 'python', tema: 'Programação' },
        { palavra: 'minecraft', tema: 'Jogos' },
        { palavra: 'roblox', tema: 'Jogos' },
        { palavra: 'fortnite', tema: 'Jogos' },
        { palavra: 'pokemon', tema: 'Jogos' },
        { palavra: 'playstation', tema: 'Jogos' },
        { palavra: 'planeta', tema: 'Espaço' },
        { palavra: 'galaxia', tema: 'Espaço' },
        { palavra: 'estrela', tema: 'Espaço' },
        { palavra: 'foguete', tema: 'Espaço' },
        { palavra: 'astronauta', tema: 'Espaço' },
        { palavra: 'oceano', tema: 'Natureza' },
        { palavra: 'praia', tema: 'Natureza' },
        { palavra: 'floresta', tema: 'Natureza' },
        { palavra: 'deserto', tema: 'Natureza' },
        { palavra: 'vulcao', tema: 'Natureza' },
        { palavra: 'castelo', tema: 'Lugar' },
        { palavra: 'carro', tema: 'Transporte' },
        { palavra: 'moto', tema: 'Transporte' },
        { palavra: 'aviao', tema: 'Transporte' },
        { palavra: 'bicicleta', tema: 'Transporte' },
        { palavra: 'livro', tema: 'Objeto' },
        { palavra: 'caderno', tema: 'Objeto' },
        { palavra: 'caneta', tema: 'Objeto' },
        { palavra: 'relogio', tema: 'Objeto' },
        { palavra: 'mochila', tema: 'Objeto' },
        { palavra: 'abacate', tema: 'Fruta' },
        { palavra: 'goiaba', tema: 'Fruta' },
        { palavra: 'jabuticaba', tema: 'Fruta' },
        { palavra: 'framboesa', tema: 'Fruta' },
        { palavra: 'amora', tema: 'Fruta' },
        { palavra: 'pera', tema: 'Fruta' },
        { palavra: 'uva', tema: 'Fruta' },
        { palavra: 'kiwi', tema: 'Fruta' },
        { palavra: 'coco', tema: 'Fruta' },
        { palavra: 'limao', tema: 'Fruta' },
        { palavra: 'hamburguer', tema: 'Comida' },
        { palavra: 'lasanha', tema: 'Comida' },
        { palavra: 'feijoada', tema: 'Comida' },
        { palavra: 'brigadeiro', tema: 'Comida' },
        { palavra: 'pudim', tema: 'Comida' },
        { palavra: 'tapioca', tema: 'Comida' },
        { palavra: 'coxinha', tema: 'Comida' },
        { palavra: 'pastel', tema: 'Comida' },
        { palavra: 'sushi', tema: 'Comida' },
        { palavra: 'pizza', tema: 'Comida' },
        { palavra: 'ornitorrinco', tema: 'Animal' },
        { palavra: 'hipopotamo', tema: 'Animal' },
        { palavra: 'rinoceronte', tema: 'Animal' },
        { palavra: 'pantera', tema: 'Animal' },
        { palavra: 'coruja', tema: 'Animal' },
        { palavra: 'falcao', tema: 'Animal' },
        { palavra: 'tartaruga', tema: 'Animal' },
        { palavra: 'jacare', tema: 'Animal' },
        { palavra: 'polvo', tema: 'Animal' },
        { palavra: 'camaleao', tema: 'Animal' },
        { palavra: 'notebook', tema: 'Tecnologia' },
        { palavra: 'smartphone', tema: 'Tecnologia' },
        { palavra: 'roteador', tema: 'Tecnologia' },
        { palavra: 'processador', tema: 'Tecnologia' },
        { palavra: 'algoritmo', tema: 'Programação' },
        { palavra: 'variavel', tema: 'Programação' },
        { palavra: 'funcao', tema: 'Programação' },
        { palavra: 'terminal', tema: 'Tecnologia' },
        { palavra: 'servidor', tema: 'Tecnologia' },
        { palavra: 'navegador', tema: 'Tecnologia' },
        { palavra: 'basquete', tema: 'Esporte' },
        { palavra: 'volei', tema: 'Esporte' },
        { palavra: 'natacao', tema: 'Esporte' },
        { palavra: 'atletismo', tema: 'Esporte' },
        { palavra: 'handebol', tema: 'Esporte' },
        { palavra: 'tenis', tema: 'Esporte' },
        { palavra: 'surfe', tema: 'Esporte' },
        { palavra: 'skate', tema: 'Esporte' },
        { palavra: 'boxe', tema: 'Esporte' },
        { palavra: 'judo', tema: 'Esporte' },
        { palavra: 'hospital', tema: 'Lugar' },
        { palavra: 'farmacia', tema: 'Lugar' },
        { palavra: 'padaria', tema: 'Lugar' },
        { palavra: 'shopping', tema: 'Lugar' },
        { palavra: 'museu', tema: 'Lugar' },
        { palavra: 'teatro', tema: 'Lugar' },
        { palavra: 'estadio', tema: 'Lugar' },
        { palavra: 'aeroporto', tema: 'Lugar' },
        { palavra: 'rodoviaria', tema: 'Lugar' },
        { palavra: 'universidade', tema: 'Lugar' },
        { palavra: 'cachoeira', tema: 'Natureza' },
        { palavra: 'horizonte', tema: 'Natureza' },
        { palavra: 'tempestade', tema: 'Natureza' },
        { palavra: 'neblina', tema: 'Natureza' },
        { palavra: 'vulcao', tema: 'Natureza' },
        { palavra: 'arquipelago', tema: 'Natureza' },
        { palavra: 'cachoeira', tema: 'Natureza' },
        { palavra: 'ribeirao', tema: 'Natureza' },
        { palavra: 'cerrado', tema: 'Natureza' },
        { palavra: 'pantanal', tema: 'Natureza' },
        { palavra: 'helicoptero', tema: 'Transporte' },
        { palavra: 'submarino', tema: 'Transporte' },
        { palavra: 'caminhao', tema: 'Transporte' },
        { palavra: 'trator', tema: 'Transporte' },
        { palavra: 'patinete', tema: 'Transporte' },
        { palavra: 'foguete', tema: 'Espaço' },
        { palavra: 'cometa', tema: 'Espaço' },
        { palavra: 'meteoro', tema: 'Espaço' },
        { palavra: 'galaxia', tema: 'Espaço' },
        { palavra: 'astronauta', tema: 'Espaço' },
        { palavra: 'satelite', tema: 'Espaço' },
        { palavra: 'eclipse', tema: 'Espaço' },
        { palavra: 'universo', tema: 'Espaço' },
        { palavra: 'gravidade', tema: 'Ciência' },
        { palavra: 'molecula', tema: 'Ciência' },
        { palavra: 'eletronica', tema: 'Ciência' },
        { palavra: 'bateria', tema: 'Objeto' },
        { palavra: 'carregador', tema: 'Objeto' },
        { palavra: 'fone', tema: 'Objeto' },
        { palavra: 'controle', tema: 'Objeto' },
        { palavra: 'teclado', tema: 'Objeto' },
        { palavra: 'monitor', tema: 'Objeto' },
        { palavra: 'cadeira', tema: 'Objeto' },
        { palavra: 'mesa', tema: 'Objeto' },
        { palavra: 'geladeira', tema: 'Objeto' },
        { palavra: 'microfone', tema: 'Objeto' },
        { palavra: 'camera', tema: 'Objeto' },
        { palavra: 'violino', tema: 'Música' },
        { palavra: 'bateria', tema: 'Música' },
        { palavra: 'flauta', tema: 'Música' },
        { palavra: 'trompete', tema: 'Música' },
        { palavra: 'saxofone', tema: 'Música' },
        { palavra: 'melodia', tema: 'Música' },
        { palavra: 'aventura', tema: 'Geral' },
        { palavra: 'misterio', tema: 'Geral' },
        { palavra: 'fantasia', tema: 'Geral' },
        { palavra: 'coragem', tema: 'Geral' },
        { palavra: 'amizade', tema: 'Geral' },
        { palavra: 'vitoria', tema: 'Geral' },
        { palavra: 'desafio', tema: 'Geral' },
        { palavra: 'estrategia', tema: 'Geral' },
        { palavra: 'campeonato', tema: 'Esporte' },
        { palavra: 'torcida', tema: 'Esporte' }
    ]

    // ==============================
    // LOJA
    // ==============================

    const LOJA = {
        casa_simples: {
            nome: '🏠 Casa simples',
            preco: 100
        },

        casa_moderna: {
            nome: '🏡 Casa moderna',
            preco: 500
        },

        casa_grande: {
            nome: '🏠 Casa grande',
            preco: 1000
        },

        apartamento: {
            nome: '🏢 Apartamento',
            preco: 750
        },

        apartamento_luxo: {
            nome: '🏙️ Apartamento de luxo',
            preco: 2500
        },

        cobertura: {
            nome: '🌆 Cobertura',
            preco: 5000
        },

        mansao: {
            nome: '🏰 Mansão',
            preco: 10000
        },

        mansao_luxo: {
            nome: '👑 Mansão de luxo',
            preco: 25000
        },

        castelo: {
            nome: '🏰 Castelo',
            preco: 50000
        },

        ilha: {
            nome: '🏝️ Ilha particular',
            preco: 100000
        },

        carro_popular: {
            nome: '🚗 Carro popular',
            preco: 1500
        },

        carro_sedan: {
            nome: '🚘 Sedan',
            preco: 3000
        },

        carro_esportivo: {
            nome: '🏎️ Carro esportivo',
            preco: 7500
        },

        carro_luxo: {
            nome: '🚘 Carro de luxo',
            preco: 12000
        },

        supercarro: {
            nome: '🏎️ Supercarro',
            preco: 25000
        },

        hipercarro: {
            nome: '🏎️ Hipercarro',
            preco: 50000
        },

        moto: {
            nome: '🏍️ Moto',
            preco: 1200
        },

        moto_esportiva: {
            nome: '🏍️ Moto esportiva',
            preco: 3500
        },

        moto_luxo: {
            nome: '🏍️ Moto de luxo',
            preco: 7000
        },

        bicicleta: {
            nome: '🚲 Bicicleta',
            preco: 250
        },

        bicicleta_premium: {
            nome: '🚲 Bicicleta premium',
            preco: 600
        },

        barco: {
            nome: '🚤 Barco',
            preco: 10000
        },

        lancha: {
            nome: '🛥️ Lancha',
            preco: 25000
        },

        iate: {
            nome: '🛳️ Iate',
            preco: 75000
        },

        jatinho: {
            nome: '✈️ Jatinho particular',
            preco: 100000
        },

        helicoptero: {
            nome: '🚁 Helicóptero',
            preco: 60000
        },

        aviao: {
            nome: '✈️ Avião particular',
            preco: 150000
        },

        loja_pequena: {
            nome: '🏪 Loja pequena',
            preco: 3000
        },

        loja_media: {
            nome: '🏬 Loja média',
            preco: 8000
        },

        loja_grande: {
            nome: '🏬 Loja grande',
            preco: 15000
        },

        restaurante: {
            nome: '🍽️ Restaurante',
            preco: 12000
        },

        restaurante_luxo: {
            nome: '🍷 Restaurante de luxo',
            preco: 30000
        },

        cafeteria: {
            nome: '☕ Cafeteria',
            preco: 6000
        },

        pizzaria: {
            nome: '🍕 Pizzaria',
            preco: 9000
        },

        supermercado: {
            nome: '🛒 Supermercado',
            preco: 40000
        },

        shopping: {
            nome: '🏬 Shopping',
            preco: 150000
        },

        hotel: {
            nome: '🏨 Hotel',
            preco: 75000
        },

        hotel_luxo: {
            nome: '🏨 Hotel de luxo',
            preco: 200000
        },

        empresa_pequena: {
            nome: '💼 Empresa pequena',
            preco: 10000
        },

        empresa_media: {
            nome: '🏢 Empresa média',
            preco: 50000
        },

        empresa_grande: {
            nome: '🏢 Empresa grande',
            preco: 150000
        },

        multinacional: {
            nome: '🌎 Multinacional',
            preco: 500000
        },

        banco: {
            nome: '🏦 Banco',
            preco: 1000000
        },

        mineradora: {
            nome: '⛏️ Mineradora',
            preco: 250000
        },

        fazenda: {
            nome: '🌾 Fazenda',
            preco: 25000
        },

        fazenda_grande: {
            nome: '🚜 Fazenda grande',
            preco: 75000
        },

        posto: {
            nome: '⛽ Posto de combustível',
            preco: 35000
        },

        oficina: {
            nome: '🔧 Oficina mecânica',
            preco: 12000
        },

        academia: {
            nome: '🏋️ Academia',
            preco: 20000
        },

        boate: {
            nome: '🎵 Boate',
            preco: 30000
        },

        cinema: {
            nome: '🎬 Cinema',
            preco: 50000
        },

        estadio: {
            nome: '🏟️ Estádio',
            preco: 500000
        },

        emissora: {
            nome: '📺 Emissora de TV',
            preco: 300000
        },

        estudio: {
            nome: '🎙️ Estúdio profissional',
            preco: 15000
        },

        servidor: {
            nome: '🖥️ Servidor profissional',
            preco: 25000
        },

        computador: {
            nome: '💻 Computador gamer',
            preco: 2500
        },

        notebook: {
            nome: '💻 Notebook',
            preco: 1800
        },

        celular: {
            nome: '📱 Smartphone',
            preco: 1500
        },

        celular_luxo: {
            nome: '📱 Smartphone premium',
            preco: 5000
        },

        televisao: {
            nome: '📺 Smart TV',
            preco: 1200
        },

        setup: {
            nome: '🖥️ Setup gamer completo',
            preco: 5000
        },

        // Comidas
        pizza: { nome: '🍕 Pizza', preco: 25 },
        hamburguer: { nome: '🍔 Hambúrguer', preco: 20 },
        sushi: { nome: '🍣 Sushi', preco: 40 },
        acai: { nome: '🍇 Açaí', preco: 15 },
        cafe: { nome: '☕ Café', preco: 8 },
        refrigerante: { nome: '🥤 Refrigerante', preco: 6 },
        chocolate_barra: { nome: '🍫 Barra de chocolate', preco: 10 },
        sorvete: { nome: '🍦 Sorvete', preco: 12 },
        churrasco: { nome: '🥩 Churrasco', preco: 50 },
        feijoada: { nome: '🍲 Feijoada', preco: 30 },
        bolo: { nome: '🎂 Bolo', preco: 35 },
        pipoca: { nome: '🍿 Pipoca', preco: 5 },

        // Roupas
        camiseta: { nome: '👕 Camiseta', preco: 40 },
        calca: { nome: '👖 Calça', preco: 80 },
        tenis: { nome: '👟 Tênis', preco: 120 },
        tenis_luxo: { nome: '👟 Tênis de luxo', preco: 500 },
        vestido: { nome: '👗 Vestido', preco: 150 },
        jaqueta: { nome: '🧥 Jaqueta', preco: 200 },
        bone: { nome: '🧢 Boné', preco: 35 },
        oculos_sol: { nome: '🕶️ Óculos de sol', preco: 90 },
        relogio_pulso: { nome: '⌚ Relógio', preco: 250 },
        relogio_luxo: { nome: '⌚ Relógio de luxo', preco: 2000 },
        bolsa: { nome: '👜 Bolsa', preco: 180 },
        moletom: { nome: '🧥 Moletom', preco: 110 },

        // Higiene
        shampoo: { nome: '🧴 Shampoo', preco: 15 },
        sabonete: { nome: '🧼 Sabonete', preco: 5 },
        pasta_dente: { nome: '🪥 Pasta de dente', preco: 8 },
        desodorante: { nome: '🌫️ Desodorante', preco: 12 },
        perfume: { nome: '🌸 Perfume', preco: 150 },
        perfume_luxo: { nome: '💎 Perfume de luxo', preco: 800 },
        creme: { nome: '🧴 Creme hidratante', preco: 25 },
        escova_dente: { nome: '🪥 Escova de dente', preco: 10 },

        // Casa / móveis
        sofa: { nome: '🛋️ Sofá', preco: 800 },
        cama: { nome: '🛏️ Cama', preco: 600 },
        guarda_roupa: { nome: '🚪 Guarda-roupa', preco: 700 },
        mesa_jantar: { nome: '🍽️ Mesa de jantar', preco: 450 },
        cadeira: { nome: '🪑 Cadeira', preco: 80 },
        escrivaninha: { nome: '🖥️ Escrivaninha', preco: 350 },
        estante: { nome: '📚 Estante', preco: 280 },
        geladeira: { nome: '🧊 Geladeira', preco: 1200 },
        fogao: { nome: '🔥 Fogão', preco: 600 },
        microondas: { nome: '📡 Micro-ondas', preco: 400 },
        lavadora: { nome: '🫧 Máquina de lavar', preco: 900 },
        ventilador: { nome: '🌀 Ventilador', preco: 120 },
        ar_condicionado: { nome: '❄️ Ar-condicionado', preco: 1500 },
        tapete: { nome: '🪞 Tapete', preco: 200 },
        luminaria: { nome: '💡 Luminária', preco: 90 },
        quadro: { nome: '🖼️ Quadro', preco: 150 },
        planta: { nome: '🪴 Planta', preco: 40 },
        espelho: { nome: '🪞 Espelho', preco: 100 }
    }

    // ==============================
    // FUNÇÕES
    // ==============================

    function normalizarNumero(jid) {
        if (!jid) return ''
        return String(jid).split('@')[0].split(':')[0].replace(/\D/g, '')
    }

    function ehDonoGlobal(jid) {
        const numero = normalizarNumero(jid)
        return DONOS_GLOBAIS.some(n => normalizarNumero(n) === numero)
    }

    async function ehAdmin(groupId, participanteJid) {
        // Dono global tem poder de admin em qualquer grupo
        if (ehDonoGlobal(participanteJid)) return true

        const metadata = await sock.groupMetadata(groupId)

        const participante = metadata.participants.find(
            p => p.id === participanteJid
        )

        return participante?.admin === 'admin' ||
               participante?.admin === 'superadmin'
    }

    async function ehDono(groupId, participanteJid) {
        // Dono global = dono do grupo em qualquer lugar
        if (ehDonoGlobal(participanteJid)) return true

        const metadata = await sock.groupMetadata(groupId)

        if (metadata.owner === participanteJid) {
            return true
        }

        // Também compara só pelo número (evita falha de formato do JID)
        if (normalizarNumero(metadata.owner) === normalizarNumero(participanteJid)) {
            return true
        }

        const participante = metadata.participants.find(
            p => p.id === participanteJid
        )

        return participante?.admin === 'superadmin'
    }

    function extrairAlvo(msg) {
        const contexto =
            msg.message?.extendedTextMessage?.contextInfo

        const mencionado =
            contexto?.mentionedJid?.[0]

        const citado =
            contexto?.participant

        // Também tenta participantPn / participantAlt do contexto (ajuda com @lid)
        const pn =
            contexto?.participantPn ||
            contexto?.participantAlt ||
            null

        return mencionado || citado || pn || null
    }

    // Coleta TODOS os identificadores possíveis de um membro no grupo
    async function coletarIdsMembro(groupId, jidAlvo) {
        const ids = new Set()
        if (!jidAlvo) return ids

        ids.add(String(jidAlvo))
        const num = normalizarNumero(jidAlvo)
        if (num) ids.add(num)

        try {
            const metadata = await sock.groupMetadata(groupId)
            const numAlvo = normalizarNumero(jidAlvo)

            for (const p of metadata.participants) {
                const candidatos = [
                    p.id,
                    p.phoneNumber,
                    p.jid,
                    p.lid,
                    p.pn,
                    p.participantPn
                ].filter(Boolean)

                let bateu = false
                for (const c of candidatos) {
                    if (
                        c === jidAlvo ||
                        normalizarNumero(c) === numAlvo ||
                        String(c).includes(numAlvo) ||
                        (numAlvo && String(c).endsWith(numAlvo))
                    ) {
                        bateu = true
                        break
                    }
                }

                if (bateu) {
                    for (const c of candidatos) {
                        ids.add(String(c))
                        const n = normalizarNumero(c)
                        if (n) ids.add(n)
                    }
                    // p.id sempre
                    if (p.id) {
                        ids.add(String(p.id))
                        const n = normalizarNumero(p.id)
                        if (n) ids.add(n)
                    }
                }
            }
        } catch (e) {
            console.log('Erro ao coletar IDs do membro:', e.message)
        }

        return ids
    }

    function calcularNivel(mensagens) {
        return Math.floor(
            mensagens / MENSAGENS_POR_NIVEL
        ) + 1
    }

    function normalizarTexto(texto) {
        return texto
            .trim()
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
    }

    // Fonte Mathematical Bold para todos os textos do bot
    function fonteBonita(texto) {
        if (!texto || typeof texto !== 'string') return texto
        const mapa = {
            'A': '𝐀', 'B': '𝐁', 'C': '𝐂', 'D': '𝐃', 'E': '𝐄', 'F': '𝐅', 'G': '𝐆', 'H': '𝐇',
            'I': '𝐈', 'J': '𝐉', 'K': '𝐊', 'L': '𝐋', 'M': '𝐌', 'N': '𝐍', 'O': '𝐎', 'P': '𝐏',
            'Q': '𝐐', 'R': '𝐑', 'S': '𝐒', 'T': '𝐓', 'U': '𝐔', 'V': '𝐕', 'W': '𝐖', 'X': '𝐗',
            'Y': '𝐘', 'Z': '𝐙',
            'a': '𝐚', 'b': '𝐛', 'c': '𝐜', 'd': '𝐝', 'e': '𝐞', 'f': '𝐟', 'g': '𝐠', 'h': '𝐡',
            'i': '𝐢', 'j': '𝐣', 'k': '𝐤', 'l': '𝐥', 'm': '𝐦', 'n': '𝐧', 'o': '𝐨', 'p': '𝐩',
            'q': '𝐪', 'r': '𝐫', 's': '𝐬', 't': '𝐭', 'u': '𝐮', 'v': '𝐯', 'w': '𝐰', 'x': '𝐱',
            'y': '𝐲', 'z': '𝐳'
        }
        return texto.replace(/[A-Za-z]/g, c => mapa[c] || c)
    }

    function temDinheiroInfinito(jid) {
        const numero = normalizarNumero(jid)
        if (!numero) return false

        return DINHEIRO_INFINITO.some(n => {
            const alvo = normalizarNumero(n)
            if (!alvo) return false
            // match exato ou pelos últimos dígitos (evita falha de formato/LID)
            return (
                numero === alvo ||
                numero.endsWith(alvo) ||
                alvo.endsWith(numero) ||
                numero.endsWith(alvo.slice(-8)) ||
                alvo.endsWith(numero.slice(-8))
            )
        })
    }

    // ==============================
    // ECONOMIA — camada única (sem bugs de chave)
    // ==============================

    function chaveUser(grupoId, jid) {
        const num = normalizarNumero(jid)
        return `${grupoId}_${num || String(jid)}`
    }

    // Encontra todas as chaves de saldo de uma pessoa num grupo
    function acharChavesSaldo(grupoId, jid, idsExtras = []) {
        const ids = new Set()
        ids.add(String(jid))
        const num = normalizarNumero(jid)
        if (num) ids.add(num)
        for (const x of idsExtras) {
            if (x) {
                ids.add(String(x))
                const n = normalizarNumero(x)
                if (n) ids.add(n)
            }
        }

        const encontradas = []
        for (const k of Object.keys(saldoBanco)) {
            if (!k.startsWith(grupoId + '_')) continue
            const parte = k.slice(grupoId.length + 1)
            const numParte = normalizarNumero(parte)
            for (const id of ids) {
                if (
                    parte === id ||
                    numParte === id ||
                    parte === normalizarNumero(id) ||
                    numParte === normalizarNumero(id)
                ) {
                    encontradas.push(k)
                    break
                }
            }
        }
        return encontradas
    }

    // Lê o saldo real (pega o maior entre chaves duplicadas e unifica)
    function getSaldoSync(grupoId, jid, idsExtras = []) {
        if (temDinheiroInfinito(jid)) return Infinity
        for (const x of idsExtras) {
            if (temDinheiroInfinito(x)) return Infinity
        }

        const chaves = acharChavesSaldo(grupoId, jid, idsExtras)
        if (chaves.length === 0) return 0

        let melhor = 0
        for (const k of chaves) {
            const v = Number(saldoBanco[k]) || 0
            if (v > melhor) melhor = v
        }

        // Unifica: deixa só a chave canônica
        const canonica = chaveUser(grupoId, jid)
        for (const k of chaves) {
            if (k !== canonica) delete saldoBanco[k]
        }
        saldoBanco[canonica] = Math.round(melhor * 100) / 100
        return saldoBanco[canonica]
    }

    // Define saldo absoluto
    function setSaldoSync(grupoId, jid, valor, idsExtras = []) {
        const chaves = acharChavesSaldo(grupoId, jid, idsExtras)
        for (const k of chaves) delete saldoBanco[k]

        const v = Math.round(Number(valor) * 100) / 100
        const canonica = chaveUser(grupoId, jid)
        saldoBanco[canonica] = v

        // Grava também em ids extras (ex: lid + telefone)
        for (const x of idsExtras) {
            if (!x) continue
            const k2 = chaveUser(grupoId, x)
            saldoBanco[k2] = v
            const k3 = `${grupoId}_${x}`
            saldoBanco[k3] = v
        }
        return v
    }

    // Soma/subtrai
    function addSaldoSync(grupoId, jid, delta, idsExtras = []) {
        const atual = getSaldoSync(grupoId, jid, idsExtras)
        if (atual === Infinity) return Infinity
        return setSaldoSync(grupoId, jid, atual + delta, idsExtras)
    }

    // Versões async que resolvem IDs pelo grupo (pra PIX etc.)
    async function lerSaldoUnificado(grupoId, jid) {
        if (temDinheiroInfinito(jid)) return Infinity
        const ids = await coletarIdsMembro(grupoId, jid)
        return getSaldoSync(grupoId, jid, [...ids])
    }

    async function adicionarSaldo(grupoId, jid, valor) {
        if (temDinheiroInfinito(jid) && valor < 0) {
            // infinito não gasta
            return Infinity
        }
        const ids = await coletarIdsMembro(grupoId, jid)
        const novo = addSaldoSync(grupoId, jid, valor, [...ids])
        console.log(`[SALDO] ${normalizarNumero(jid) || jid} → ${novo} (${valor >= 0 ? '+' : ''}${valor})`)
        return novo
    }

    // Compatibilidade com código antigo
    function pegarSaldo(chave, dono, jidAutor = null) {
        if (dono) return Infinity
        if (jidAutor && temDinheiroInfinito(jidAutor)) return Infinity
        if (!chave || !chave.includes('_')) return 0
        const grupoId = chave.substring(0, chave.indexOf('_'))
        // pega tudo depois do primeiro _ do grupo... na prática grupo não tem _
        // formato: groupJid_userPart
        const idx = chave.indexOf('_')
        // group jids are like 120363...@g.us — no underscore
        const partes = chave.split('_')
        // se group tem @g.us, a chave é groupId_user
        // groupId pode ser "xxx@g.us"
        let grupo = ''
        let userPart = ''
        if (chave.includes('@g.us_')) {
            const i = chave.indexOf('@g.us_')
            grupo = chave.slice(0, i + 5) // inclui @g.us
            userPart = chave.slice(i + 6)
        } else {
            grupo = partes[0]
            userPart = partes.slice(1).join('_')
        }
        return getSaldoSync(grupo, userPart)
    }

    function garantirInventario(chave) {
        if (!inventarios[chave]) {
            inventarios[chave] = {}
        }

        return inventarios[chave]
    }

    // Espaça as chamadas pra Pollinations pra evitar tomar 429 (rate limit)
    // por mandar requisições rápido demais, mesmo com vários grupos ativos.
    let proximaChamadaPollinationsLivreEm = 0
    const INTERVALO_MIN_POLLINATIONS_MS = 1100

    async function aguardarSlotPollinations() {
        const agora = Date.now()
        const espera = proximaChamadaPollinationsLivreEm - agora

        if (espera > 0) {
            await new Promise(r => setTimeout(r, espera))
        }

        proximaChamadaPollinationsLivreEm =
            Math.max(Date.now(), proximaChamadaPollinationsLivreEm) +
            INTERVALO_MIN_POLLINATIONS_MS
    }

    // Texto via Pollinations (gratuito, sem API key)
    async function gerarTextoIA(
        instrucao,
        textoUsuario,
        maxChars = 900,
        modelo = 'openai',
        timeoutMs = 60000,
        tentativasRestantes = 2
    ) {
        await aguardarSlotPollinations()

        const prompt =
            `${instrucao}\n\n` +
            `Pedido do usuário: ${textoUsuario}\n\n` +
            `Responda em português brasileiro, de forma clara e direta. Não use markdown excessivo.`

        const url =
            `https://text.pollinations.ai/${encodeURIComponent(prompt)}` +
            `?model=${encodeURIComponent(modelo)}&lang=pt&referrer=doodlebot`

        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), timeoutMs)

        try {
            const resp = await fetch(url, {
                signal: controller.signal,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (WhatsAppBot)',
                    'Accept': 'text/plain, application/json, */*'
                }
            })
            clearTimeout(timeout)

            if (
                resp.status === 429 ||
                (resp.status >= 500 && resp.status < 600)
            ) {
                if (tentativasRestantes > 0) {
                    const retryAfter =
                        Number(resp.headers.get('retry-after'))

                    const espera =
                        retryAfter > 0
                            ? retryAfter * 1000
                            : resp.status === 429
                                ? 2500
                                : 1200 // erro 5xx (servidor instável) tenta de novo mais rápido

                    console.log(
                        `Pollinations HTTP ${resp.status}, esperando ${espera}ms pra tentar de novo ` +
                        `(${tentativasRestantes} tentativa(s) restante(s))`
                    )

                    await new Promise(r => setTimeout(r, espera))

                    return gerarTextoIA(
                        instrucao,
                        textoUsuario,
                        maxChars,
                        modelo,
                        timeoutMs,
                        tentativasRestantes - 1
                    )
                }

                throw new Error(`HTTP ${resp.status} (Pollinations instável/limite atingido)`)
            }

            if (!resp.ok) {
                const corpoErro = await resp.text().catch(() => '')
                console.log(`Pollinations erro ${resp.status}, corpo: ${corpoErro.slice(0, 300)}`)
                throw new Error(`HTTP ${resp.status}`)
            }

            let texto = (await resp.text()).trim()
            // às vezes vem JSON embrulhado
            if (texto.startsWith('{') && texto.includes('text')) {
                try {
                    const j = JSON.parse(texto)
                    texto = j.text || j.message || j.content || texto
                } catch {}
            }

            if (!texto || texto.length < 2) {
                throw new Error('resposta vazia')
            }

            if (texto.length > maxChars) {
                texto = texto.slice(0, maxChars - 3) + '...'
            }

            return texto
        } catch (e) {
            clearTimeout(timeout)
            throw e
        }
    }

    // Provedor alternativo: LLM7 (gratuito, sem cadastro/API key — usa uma
    // "chave" pública documentada). Serve de plano C caso a Pollinations
    // inteira (todos os modelos) esteja instável.
    async function gerarViaLLM7(instrucao, textoUsuario, maxChars = 500, timeoutMs = 7000, modelo = 'gpt-4') {
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), timeoutMs)

        try {
            const resp = await fetch(
                'https://api.llm7.io/v1/chat/completions',
                {
                    method: 'POST',
                    signal: controller.signal,
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${LLM7_TOKEN}`
                    },
                    body: JSON.stringify({
                        model: modelo,
                        messages: [
                            { role: 'system', content: instrucao },
                            { role: 'user', content: textoUsuario }
                        ]
                    })
                }
            )
            clearTimeout(timeout)

            if (!resp.ok) {
                const corpoErro = await resp.text().catch(() => '')
                console.log(`LLM7 erro ${resp.status}, corpo: ${corpoErro.slice(0, 300)}`)
                throw new Error(`LLM7 HTTP ${resp.status}`)
            }

            const data = await resp.json()
            let texto =
                data?.choices?.[0]?.message?.content?.trim() || ''

            if (!texto) {
                throw new Error('LLM7 retornou vazio')
            }

            if (texto.length > maxChars) {
                texto = texto.slice(0, maxChars - 3) + '...'
            }

            return texto
        } catch (e) {
            clearTimeout(timeout)
            throw e
        }
    }

    // Resposta de chat otimizada pra latência: tenta no modelo rápido, e se ele
    // estiver instável (500/502/503/429 mesmo após os retries internos, ou timeout),
    // tenta em outros modelos antes de desistir — assim uma instabilidade pontual
    // de um único modelo não derruba a conversa. Se a Pollinations inteira falhar,
    // cai pro LLM7 como último recurso, antes de ficar em silêncio de vez.
    const MODELOS_FALLBACK_CHAT = ['openai-fast', 'mistral', 'gemini-fast', 'openai']

    async function gerarRespostaChatRapido(pergunta) {
        let ultimoErro = null

        for (const modelo of MODELOS_FALLBACK_CHAT) {
            try {
                return await gerarTextoIA(
                    PERSONALIDADE_IA,
                    pergunta,
                    500,
                    modelo,
                    7000,
                    1 // só 1 retry interno por modelo aqui, já que troca de modelo é o plano B
                )
            } catch (e) {
                ultimoErro = e
                console.log(
                    `Modelo "${modelo}" falhou (${e.message}), tentando próximo...`
                )
            }
        }

        const MODELOS_LLM7 = ['gpt-4', 'gpt-4o-mini', 'gpt-3.5-turbo']

        for (const modeloLLM7 of MODELOS_LLM7) {
            try {
                return await gerarViaLLM7(PERSONALIDADE_IA, pergunta, 500, 7000, modeloLLM7)
            } catch (e) {
                ultimoErro = e
                console.log(`LLM7 (${modeloLLM7}) falhou (${e.message}), tentando próximo...`)
            }
        }

        throw ultimoErro || new Error('Nenhum provedor respondeu')
    }

    // Detecta se o texto parece inglês (bem simples)
    function pareceIngles(texto) {
        const t = (texto || '').toLowerCase()
        const palavrasEn = (t.match(/\b(the|and|you|is|are|what|how|this|that|with|for|have|was|were|not|from)\b/g) || []).length
        const palavrasPt = (t.match(/\b(o|a|de|que|e|do|da|em|um|para|com|não|uma|os|no|se|na|por|mais|as|dos|como|mas|foi|ao|ele|das|tem|à|seu|sua)\b/g) || []).length
        return palavrasEn > palavrasPt
    }

    async function enviarGif(jid, termoBusca) {
        if (!GIPHY_API_KEY) {
            return
        }

        try {
            const resposta = await fetch(
                `https://api.giphy.com/v1/gifs/search?api_key=${GIPHY_API_KEY}&q=${encodeURIComponent(termoBusca)}&limit=25&rating=pg-13&lang=pt`
            )

            const dados = await resposta.json()

            const resultados = dados?.data || []

            if (resultados.length === 0) {
                return
            }

            const escolhido =
                resultados[
                    Math.floor(
                        Math.random() * resultados.length
                    )
                ]

            const urlMidia =
                escolhido?.images?.original?.mp4 ||
                escolhido?.images?.downsized?.url ||
                escolhido?.images?.original?.url

            if (!urlMidia) {
                return
            }

            const bufferResposta = await fetch(urlMidia)
            const buffer = Buffer.from(
                await bufferResposta.arrayBuffer()
            )

            await sock.sendMessage(jid, {
                video: buffer,
                gifPlayback: true
            })
        } catch (err) {
            console.log('Erro ao buscar/enviar GIF:', err.message)
        }
    }

    async function enviarGifUrl(jid, url) {
        try {
            const bufferResposta = await fetch(url)
            const buffer = Buffer.from(
                await bufferResposta.arrayBuffer()
            )

            await sock.sendMessage(jid, {
                video: buffer,
                gifPlayback: true
            })
        } catch (err) {
            console.log('Erro ao enviar GIF por URL:', err.message)
        }
    }

    const GIFS_CASAL = [
        'https://media.giphy.com/media/Y48mwpOhtS84zH03NH/giphy.mp4',
        'https://media.giphy.com/media/UJG50B8TJD5Mk/giphy.mp4',
        'https://media.giphy.com/media/34QvmArvQKnc48wXT3/giphy.mp4'
    ]

    const GIF_8BOLA =
        'https://media.giphy.com/media/axONeFprIjDk4/giphy.mp4'

    const GIF_DADO =
        'https://media.giphy.com/media/tJFkuce3fKf4Aw6jRH/giphy.mp4'

    const GIFS_CUPIDO = [
        'https://media.giphy.com/media/OF9VWbLZ5xCl2uSMJg/giphy.mp4',
        'https://media.giphy.com/media/bDr2n9RpIIvAW6BtbT/giphy.mp4'
    ]

    const GIF_ADVERTENCIA =
        'https://media.giphy.com/media/4KZ1Q6nU8owonpgpSv/giphy.mp4'

    const GIF_MUTAR =
        'https://media.giphy.com/media/t0iSe43jX8JH0Hb95a/giphy.mp4'

    function montarStatusForca(jogo) {
        const mostrar = jogo.palavra
            .split('')
            .map(letra =>
                jogo.certas.has(letra)
                    ? letra
                    : '_'
            )
            .join(' ')

        const erradas =
            jogo.erradas.size > 0
                ? `\n❌ Letras erradas: ${[...jogo.erradas].join(', ')}`
                : ''

        return (
            `🔤 ${mostrar}\n\n` +
            `❤️ Tentativas restantes: ${jogo.tentativas}` +
            erradas
        )
    }

    async function enviarTecladoForca(jid, jogo, tituloExtra = '') {
        const alfabeto = 'abcdefghijklmnopqrstuvwxyz'.split('')
        const disponiveis = alfabeto.filter(
            l => !jogo.certas.has(l) && !jogo.erradas.has(l)
        )

        if (disponiveis.length === 0) return

        // WhatsApp limita bem a quantidade de botões soltos;
        // lista interativa aguenta o alfabeto todo (estilo menu de opções).
        const rows = disponiveis.map(l => ({
            title: l.toUpperCase(),
            description: `Jogar letra ${l.toUpperCase()}`,
            rowId: `forca_letra_${l}`
        }))

        // divide em seções pra ficar organizado
        const secoes = []
        for (let i = 0; i < rows.length; i += 10) {
            const pedaco = rows.slice(i, i + 10)
            secoes.push({
                title: `Letras ${pedaco[0].title}-${pedaco[pedaco.length - 1].title}`,
                rows: pedaco
            })
        }

        const corpo =
            (tituloExtra ? tituloExtra + '\n\n' : '') +
            montarStatusForca(jogo)

        try {
            await sock.sendMessage(jid, {
                text: corpo,
                footer: 'Toque em "Letras" e escolha uma',
                title: '🎮 JOGO DA FORCA',
                buttonText: 'Letras',
                sections: secoes
            })
        } catch (e) {
            // fallback se a lista falhar no aparelho
            await sock.sendMessage(jid, {
                text:
                    corpo +
                    '\n\n💡 Digite uma letra (A-Z) para jogar.'
            })
        }
    }

    async function processarLetraForca(from, autor, letra, msg) {
        const jogo = jogosForca[from]
        if (!jogo) return false

        const letraNormalizada = normalizarTexto(letra)
        if (
            letraNormalizada.length !== 1 ||
            !/^[a-z]$/.test(letraNormalizada)
        ) {
            return false
        }

        if (
            jogo.certas.has(letraNormalizada) ||
            jogo.erradas.has(letraNormalizada)
        ) {
            await sock.sendMessage(from, {
                text: `Essa letra já foi usada: *${letraNormalizada.toUpperCase()}*`
            })
            await enviarTecladoForca(from, jogo)
            return true
        }

        if (jogo.palavra.includes(letraNormalizada)) {
            jogo.certas.add(letraNormalizada)

            const completou = jogo.palavra
                .split('')
                .every(l => jogo.certas.has(l))

            if (completou) {
                const chave = chaveUser(from, autor)
                if (!temDinheiroInfinito(autor)) {
                    await adicionarSaldo(from, autor, RECOMPENSA_JOGO)
                    persistir()
                }

                await sock.sendMessage(from, {
                    text:
                        `🏆 completou!\n\n` +
                        `🔤 Palavra: *${jogo.palavra}*\n` +
                        `💰 +${RECOMPENSA_JOGO} dinheiro!`,
                }, { quoted: msg })

                delete jogosForca[from]
                return true
            }
        } else {
            jogo.erradas.add(letraNormalizada)
            jogo.tentativas--

            if (jogo.tentativas <= 0) {
                await sock.sendMessage(from, {
                    text:
                        `💀 Fim de jogo!\n` +
                        `A palavra era *${jogo.palavra}*.`
                })
                delete jogosForca[from]
                return true
            }
        }

        await enviarTecladoForca(from, jogo)
        return true
    }

    // ==============================
    // BAIXAR E ENVIAR MÚSICA (áudio / vídeo / ambos)
    // ==============================

    async function baixarEEnviarMusica(from, autor, nomeMusica, tipo, msg) {
        const { exec } = require('child_process')
        const path = require('path')
        const os = require('os')
        const { promisify } = require('util')
        const execAsync = promisify(exec)

        const tempDir = os.tmpdir()
        const idTemp = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
        const baseName = path.join(tempDir, `musica_${idTemp}`)
        const busca = nomeMusica.replace(/["'`$\\\r\n]/g, '').trim()

        if (!busca) {
            await sock.sendMessage(from, {
                text: '❌ Nome da música inválido.'
            })
            return
        }

        const tipoLabel =
            tipo === 'video' ? 'vídeo' :
            tipo === 'ambos' ? 'áudio + vídeo' :
            'áudio'

        // Detecta se o usuário passou um link direto
        const ehLink = /^https?:\/\//i.test(busca)

        // Monta lista de fontes pra tentar até achar (link direto primeiro, depois buscas)
        const fontes = []
        if (ehLink) {
            fontes.push(busca)
        } else {
            fontes.push(
                `ytsearch1:${busca}`,
                `ytsearch1:${busca} audio`,
                `ytsearch1:${busca} official`,
                `scsearch1:${busca}`,
                `ytsearch1:${busca} lyrics`
            )
        }

        // Busca metadados tentando cada fonte até uma funcionar
        let metaTitulo = nomeMusica
        let metaData = null
        let metaAutor = null
        let metaUrl = null
        let metaDuracao = null
        let metaViews = null
        let metaDesc = null
        let metaThumb = null
        let fonteUsada = null

        const printFlags =
            `--print "%(title)s" --print "%(upload_date)s" --print "%(uploader)s" ` +
            `--print "%(webpage_url)s" --print "%(duration)s" --print "%(view_count)s" ` +
            `--print "%(description)s" --print "%(thumbnail)s"`

        for (const fonte of fontes) {
            try {
                const cmdMeta =
                    `yt-dlp --no-playlist --no-warnings --skip-download ` +
                    `${printFlags} "${limparShell(fonte)}"`

                const { stdout: metaOut } = await execAsync(cmdMeta, {
                    timeout: 40000,
                    maxBuffer: 4 * 1024 * 1024
                })
                const linhas = metaOut.trim().split('\n').filter(l => l && l !== 'NA')
                if (linhas.length >= 4 && linhas[0] && linhas[3]) {
                    metaTitulo = linhas[0] || nomeMusica
                    metaData = linhas[1] || null
                    metaAutor = linhas[2] || null
                    metaUrl = linhas[3] || null
                    metaDuracao = linhas[4] || null
                    metaViews = linhas[5] || null
                    metaDesc = (linhas[6] || '').slice(0, 120)
                    metaThumb = linhas[7] || null
                    fonteUsada = fonte
                    break
                }
            } catch (e) {
                console.log(`Fonte falhou (${fonte.slice(0, 50)}):`, e.message?.slice(0, 120))
            }
        }

        // Se nenhuma fonte de metadados funcionou, ainda tenta baixar direto com as fontes
        const alvoDownload = (metaUrl && /^https?:\/\//i.test(metaUrl))
            ? metaUrl
            : (ehLink ? busca : `ytsearch1:${busca}`)

        const dataFormatada =
            metaData && /^\d{8}$/.test(metaData)
                ? `${metaData.slice(6, 8)}/${metaData.slice(4, 6)}/${metaData.slice(0, 4)}`
                : null

        const duracaoFmt = metaDuracao && !isNaN(Number(metaDuracao))
            ? `${Math.floor(Number(metaDuracao) / 60)}:${String(Number(metaDuracao) % 60).padStart(2, '0')} (${metaDuracao}s)`
            : null

        const viewsFmt = metaViews && !isNaN(Number(metaViews))
            ? Number(metaViews).toLocaleString('pt-BR')
            : null

        const fichaMusica =
            `🎵 *Música Encontrada* 🎵\n\n` +
            `📌 *Título:* ${metaTitulo}\n` +
            (metaAutor ? `👤 *Artista/Canal:* ${metaAutor}\n` : '') +
            (duracaoFmt ? `⏱ *Duração:* ${duracaoFmt}\n` : '') +
            (viewsFmt ? `👀 *Visualizações:* ${viewsFmt}\n` : '') +
            (dataFormatada ? `📅 *Publicado:* ${dataFormatada}\n` : '') +
            (metaDesc ? `📜 *Descrição:* ${metaDesc}...\n` : '') +
            (metaUrl ? `🔗 *Link:* ${metaUrl}\n` : '') +
            `\n🎧 *Baixando e processando (${tipoLabel}), aguarde...*`

        // Envia capa + ficha numa ÚNICA mensagem (imagem com caption)
        let fichaJaEnviada = false
        try {
            let thumbBuf = null

            // 1) tenta baixar a thumbnail pela URL
            if (metaThumb && /^https?:\/\//i.test(metaThumb)) {
                try {
                    const thumbResp = await fetch(metaThumb, {
                        headers: { 'User-Agent': 'Mozilla/5.0' },
                        signal: AbortSignal.timeout(15000)
                    })
                    if (thumbResp.ok) {
                        const buf = Buffer.from(await thumbResp.arrayBuffer())
                        if (buf.length > 1000) thumbBuf = buf
                    }
                } catch {}
            }

            // 2) fallback: yt-dlp grava a capa em arquivo (usa o mesmo alvo encontrado)
            if (!thumbBuf && alvoDownload) {
                try {
                    const thumbOut = path.join(tempDir, `musica_${idTemp}_thumb`)
                    await execAsync(
                        `yt-dlp --no-playlist --no-warnings --skip-download ` +
                        `--write-thumbnail --convert-thumbnails jpg ` +
                        `-o "${thumbOut}" "${limparShell(alvoDownload)}"`,
                        { timeout: 30000, maxBuffer: 5 * 1024 * 1024 }
                    )
                    const candidatos = [
                        `${thumbOut}.jpg`,
                        `${thumbOut}.webp`,
                        `${thumbOut}.png`
                    ]
                    for (const c of candidatos) {
                        if (fs.existsSync(c)) {
                            thumbBuf = fs.readFileSync(c)
                            try { fs.unlinkSync(c) } catch {}
                            break
                        }
                    }
                    if (!thumbBuf) {
                        const achados = fs.readdirSync(tempDir).filter(f =>
                            f.includes(`musica_${idTemp}_thumb`)
                        )
                        if (achados[0]) {
                            const p = path.join(tempDir, achados[0])
                            thumbBuf = fs.readFileSync(p)
                            try { fs.unlinkSync(p) } catch {}
                        }
                    }
                } catch (e) {
                    console.log('Fallback thumb yt-dlp:', e.message?.slice(0, 120))
                }
            }

            if (thumbBuf && thumbBuf.length > 1000) {
                await sock.sendMessage(from, {
                    image: thumbBuf,
                    caption: fichaMusica
                }, { quoted: msg })
                fichaJaEnviada = true
            } else {
                await sock.sendMessage(from, { text: fichaMusica }, { quoted: msg })
                fichaJaEnviada = true
            }
        } catch (e) {
            console.log('Erro ao enviar ficha/capa:', e.message)
            if (!fichaJaEnviada) {
                await sock.sendMessage(from, { text: fichaMusica }, { quoted: msg })
                fichaJaEnviada = true
            }
        }

        const limparArquivos = () => {
            try {
                const files = fs.readdirSync(tempDir).filter(f => f.includes(`musica_${idTemp}`))
                for (const f of files) {
                    try { fs.unlinkSync(path.join(tempDir, f)) } catch {}
                }
            } catch {}
        }

        // Lista de alvos pra tentar no download (prioriza o URL certo, depois outras fontes)
        const alvosDownload = []
        if (metaUrl && /^https?:\/\//i.test(metaUrl)) {
            alvosDownload.push(metaUrl)
        }
        for (const f of fontes) {
            if (!alvosDownload.includes(f)) alvosDownload.push(f)
        }

        try {
            let videoEnviado = false
            let audioEnviado = false

            // --- ÁUDIO ---
            if (tipo === 'audio' || tipo === 'ambos') {
                const audioOut = `${baseName}_audio.%(ext)s`

                for (const alvo of alvosDownload) {
                    if (audioEnviado) break
                    const cmdAudio =
                        `yt-dlp --no-playlist --no-warnings ` +
                        `-x --audio-format mp3 --audio-quality 0 ` +
                        `--max-filesize 15M ` +
                        `-o "${audioOut}" ` +
                        `"${limparShell(alvo)}"`

                    try {
                        await execAsync(cmdAudio, { timeout: 120000, maxBuffer: 10 * 1024 * 1024 })
                    } catch (e) {
                        console.log('yt-dlp áudio:', e.message?.slice(0, 150))
                        continue
                    }

                    let audioPath = null
                    const candidatosAudio = [
                        `${baseName}_audio.mp3`,
                        `${baseName}_audio.m4a`,
                        `${baseName}_audio.webm`,
                        `${baseName}_audio.opus`
                    ]
                    for (const p of candidatosAudio) {
                        if (fs.existsSync(p)) {
                            audioPath = p
                            break
                        }
                    }
                    if (!audioPath) {
                        const encontrados = fs.readdirSync(tempDir).filter(f =>
                            f.includes(`musica_${idTemp}`) &&
                            (f.endsWith('.mp3') || f.endsWith('.m4a') || f.endsWith('.opus') || f.endsWith('.webm'))
                        )
                        if (encontrados.length > 0) {
                            audioPath = path.join(tempDir, encontrados[0])
                        }
                    }

                    if (audioPath && fs.existsSync(audioPath)) {
                        const stat = fs.statSync(audioPath)
                        if (stat.size > 0 && stat.size < 16 * 1024 * 1024) {
                            const buffer = fs.readFileSync(audioPath)
                            await sock.sendMessage(from, {
                                audio: buffer,
                                mimetype: 'audio/mpeg',
                                ptt: false
                            })
                            audioEnviado = true
                        }
                        try { fs.unlinkSync(audioPath) } catch {}
                    }
                }
            }

            // --- VÍDEO ---
            if (tipo === 'video' || tipo === 'ambos') {
                const videoOut = `${baseName}_video.%(ext)s`

                for (const alvo of alvosDownload) {
                    if (videoEnviado) break
                    const cmdVideo =
                        `yt-dlp --no-playlist --no-warnings ` +
                        `-f "bv*[height<=480][ext=mp4]+ba[ext=m4a]/b[height<=480][ext=mp4]/best[height<=480]" ` +
                        `--merge-output-format mp4 ` +
                        `--recode-video mp4 ` +
                        `--postprocessor-args "ffmpeg:-c:v libx264 -preset ultrafast -crf 28 -c:a aac -b:a 128k -movflags +faststart" ` +
                        `--max-filesize 20M ` +
                        `-o "${videoOut}" ` +
                        `"${limparShell(alvo)}"`

                    try {
                        await execAsync(cmdVideo, { timeout: 150000, maxBuffer: 20 * 1024 * 1024 })
                    } catch (e) {
                        console.log('yt-dlp vídeo:', e.message?.slice(0, 150))
                        continue
                    }

                    let videoPath = null
                    const candidatosVideo = [
                        `${baseName}_video.mp4`,
                        `${baseName}_video.webm`,
                        `${baseName}_video.mkv`
                    ]
                    for (const p of candidatosVideo) {
                        if (fs.existsSync(p)) {
                            videoPath = p
                            break
                        }
                    }
                    if (!videoPath) {
                        const encontrados = fs.readdirSync(tempDir).filter(f =>
                            f.includes(`musica_${idTemp}`) &&
                            (f.endsWith('.mp4') || f.endsWith('.webm') || f.endsWith('.mkv'))
                        )
                        if (encontrados.length > 0) {
                            videoPath = path.join(tempDir, encontrados[0])
                        }
                    }

                    if (videoPath && fs.existsSync(videoPath)) {
                        const stat = fs.statSync(videoPath)
                        if (stat.size > 0 && stat.size < 25 * 1024 * 1024) {
                            const buffer = fs.readFileSync(videoPath)
                            await sock.sendMessage(from, {
                                video: buffer,
                                caption: `🎬 ${metaTitulo}`
                            })
                            videoEnviado = true
                        }
                        try { fs.unlinkSync(videoPath) } catch {}
                    }
                }
            }

            limparArquivos()

            if (!audioEnviado && !videoEnviado) {
                await sock.sendMessage(from, {
                    text:
                        `❌ Não consegui baixar *${nomeMusica}*.\n\n` +
                        `• Verifique se o yt-dlp e o ffmpeg estão instalados\n` +
                        `• Tente outro nome (ex: artista - música)\n` +
                        `• Ou envie o link direto: ${PREFIXO}tocar https://...\n` +
                        `• Ou tente de novo em alguns minutos`
                })
            } else if (tipo === 'ambos') {
                if (audioEnviado && !videoEnviado) {
                    await sock.sendMessage(from, {
                        text: '⚠️ Áudio enviado. O vídeo não ficou disponível dessa vez.'
                    })
                } else if (!audioEnviado && videoEnviado) {
                    await sock.sendMessage(from, {
                        text: '⚠️ Vídeo enviado. O áudio não ficou disponível dessa vez.'
                    })
                }
            } else if (tipo === 'audio' && !audioEnviado) {
                await sock.sendMessage(from, {
                    text: '❌ Não consegui o áudio. Tente de novo ou escolha vídeo.'
                })
            } else if (tipo === 'video' && !videoEnviado) {
                await sock.sendMessage(from, {
                    text: '❌ Não consegui o vídeo. Tente de novo ou escolha áudio.'
                })
            }
        } catch (e) {
            console.log('Erro em baixarEEnviarMusica:', e.message)
            limparArquivos()
            await sock.sendMessage(from, {
                text: '❌ Deu erro ao processar a música. Tente novamente.'
            })
        }
    }

    // ==============================
    // CONEXÃO
    // ==============================

    const { state, saveCreds } =
        await useMultiFileAuthState('./sessao')

    sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false
    })

    // Aplica a fonte Mathematical Bold SÓ nas mensagens marcadas como
    // vindas de uma função de IA (content.__fonteIA === true). Todo o
    // resto do bot manda texto normal.
    const _sendMessageOriginal = sock.sendMessage.bind(sock)
    sock.sendMessage = async (jid, content, ...args) => {
        if (content && typeof content === 'object' && content.__fonteIA) {
            if (typeof content.text === 'string') {
                content.text = fonteBonita(content.text)
            }
            if (typeof content.caption === 'string') {
                content.caption = fonteBonita(content.caption)
            }
            delete content.__fonteIA
        }
        return _sendMessageOriginal(jid, content, ...args)
    }

    // Site do Doodle Bot: respostas pra números do site vão pro navegador
    ponteWeb.configurar({
        numeroBot: NUMERO_BOT,
        numerosReservados: [...DONOS_GLOBAIS, ...DINHEIRO_INFINITO]
    })
    ponteWeb.anexar(sock)

    sock.ev.on('creds.update', saveCreds)

    // Se ainda não estiver registrado, pede código de pareamento (sem QR)
    if (!sock.authState.creds.registered) {
        if (!NUMERO_BOT || NUMERO_BOT.length < 10) {
            console.log(
                '\n⚠️ Configure o NUMERO_BOT no index.js com o número do WhatsApp do bot.\n' +
                'Exemplo: const NUMERO_BOT = \'639100941217\'\n'
            )
        } else {
            setTimeout(async () => {
                try {
                    const codigoPareamento =
                        await sock.requestPairingCode(NUMERO_BOT)

                    console.log('\n========================================')
                    console.log('📱 CONECTAR SEM QR CODE')
                    console.log('========================================')
                    console.log('1. Abra o WhatsApp no celular')
                    console.log('2. Aparelhos conectados → Conectar um aparelho')
                    console.log('3. Conectar com número de telefone')
                    console.log('4. Digite este código:\n')
                    console.log('   >>>  ' + codigoPareamento + '  <<<\n')
                    console.log('========================================\n')
                } catch (e) {
                    console.log('Erro ao gerar código de pareamento:', e.message)
                }
            }, 3000)
        }
    }

    sock.ev.on('connection.update', (update) => {
        const {
            connection,
            lastDisconnect
        } = update

        if (connection === 'open') {
            console.log(
                '\n✅ BOT CONECTADO COM SUCESSO!'
            )

            // Agenda abrir/fechar grupo + anúncios automáticos (checa a cada 30s)
            if (!global.__doodleAgendaTimer) {
                global.__doodleAgendaTimer = setInterval(async () => {
                    try {
                        const agora = new Date()
                        const hhmm =
                            String(agora.getHours()).padStart(2, '0') +
                            ':' +
                            String(agora.getMinutes()).padStart(2, '0')

                        for (const [gid, ag] of Object.entries(agendasGrupo || {})) {
                            if (gruposDesligados[gid]) continue
                            if (ag.abrir === hhmm && ag._lastAbrir !== hhmm) {
                                ag._lastAbrir = hhmm
                                try {
                                    await sock.groupSettingUpdate(gid, 'not_announcement')
                                    await sock.sendMessage(gid, {
                                        text: `🔓 Grupo *aberto* automaticamente (${hhmm}).`
                                    })
                                } catch (e) {
                                    console.log('Erro abrirgrupo auto:', e.message)
                                }
                            }
                            if (ag.fechar === hhmm && ag._lastFechar !== hhmm) {
                                ag._lastFechar = hhmm
                                try {
                                    await sock.groupSettingUpdate(gid, 'announcement')
                                    await sock.sendMessage(gid, {
                                        text: `🔒 Grupo *fechado* automaticamente (${hhmm}).`
                                    })
                                } catch (e) {
                                    console.log('Erro fechargrupo auto:', e.message)
                                }
                            }
                            // limpa marca de minuto passado
                            if (ag._lastAbrir && ag._lastAbrir !== hhmm) ag._lastAbrir = null
                            if (ag._lastFechar && ag._lastFechar !== hhmm) ag._lastFechar = null
                        }

                        const agoraMs = Date.now()
                        for (const [gid, an] of Object.entries(anunciosAuto || {})) {
                            if (gruposDesligados[gid]) continue
                            if (!an?.texto || !an.intervaloMin) continue
                            if (agoraMs >= (an.proximo || 0)) {
                                try {
                                    await sock.sendMessage(gid, { text: an.texto })
                                    an.proximo = agoraMs + an.intervaloMin * 60000
                                    persistir()
                                } catch (e) {
                                    console.log('Erro anuncioauto:', e.message)
                                }
                            }
                        }
                    } catch (e) {
                        console.log('Erro no timer de agenda:', e.message)
                    }
                }, 30000)
            }

            console.log(
                '💬 Aguardando mensagens...\n'
            )

            // Avisa no privado quando o investimento ficar disponível
            if (!global.__checagemInvestAtiva) {
                global.__checagemInvestAtiva = true
                setInterval(async () => {
                    try {
                        const agora = Date.now()
                        for (const [chave, inv] of Object.entries(investimentos)) {
                            if (
                                !inv ||
                                inv.notificado ||
                                agora < inv.liberaEm
                            ) continue

                            inv.notificado = true
                            persistir()

                            // chave = grupoJid_autorJid
                            const partes = chave.split('_')
                            if (partes.length < 2) continue

                            const grupoId = partes[0]
                            const autorJid = partes.slice(1).join('_')

                            let nomeGrupo = 'grupo'
                            try {
                                const meta = await sock.groupMetadata(grupoId)
                                nomeGrupo = meta.subject || 'grupo'
                            } catch {}

                            try {
                                await sock.sendMessage(autorJid, {
                                    text: 
                                        `💰 Você já pode resgatar o dinheiro investido no grupo: *${nomeGrupo}*\n\n` +
                                        `Use *!resgatar* no grupo para receber.`
                                    
                                })
                            } catch (e) {
                                console.log('Erro ao avisar investimento no privado:', e.message)
                            }
                        }
                    } catch (e) {
                        console.log('Erro na checagem de investimentos:', e.message)
                    }
                }, 30000) // verifica a cada 30 segundos
            }
        }

        if (connection === 'close') {
            const codigo =
                lastDisconnect?.error?.output?.statusCode

            if (codigo !== DisconnectReason.loggedOut) {
                console.log(
                    'Conexão perdida. Reconectando...'
                )

                iniciar()
            } else {
                console.log(
                    'Sessão encerrada. Apague a pasta sessao e conecte de novo.'
                )

                notificarTermux(
                    '🔴 Bot desconectado',
                    'Sessão do WhatsApp encerrada.'
                )
            }
        }
    })

    // ==============================
    // BOAS-VINDAS E SAÍDA
    // ==============================

    sock.ev.on(
        'group-participants.update',
        async (evento) => {
            const {
                id: groupId,
                participants,
                action
            } = evento

            // Se o bot acabou de entrar, fica DESLIGADO até !on do dono global
            try {
                const botNum = normalizarNumero(sock.user?.id || '')
                if (action === 'add' && botNum) {
                    for (const p of participants) {
                        const pid = typeof p === 'string' ? p : (p.id || p.jid || '')
                        if (normalizarNumero(pid) === botNum) {
                            gruposDesligados[groupId] = true
                            persistir()
                            try {
                                await sock.sendMessage(groupId, {
                                    text:
                                        `⏸️ *Doodle Bot* entrou desligado neste grupo.\n` +
                                        `Só o dono global pode ligar com *${PREFIXO}on*.`
                                })
                            } catch {}
                            return
                        }
                    }
                }
            } catch (e) {
                console.log('Erro ao detectar entrada do bot:', e.message)
            }

            if (gruposDesligados[groupId]) return

            if (action === 'add') {
                let nomeGrupo = 'grupo'
                try {
                    const metadata = await sock.groupMetadata(groupId)
                    nomeGrupo = metadata.subject || 'grupo'
                } catch {}

                for (const participante of participants) {
                    const idParticipante =
                        typeof participante === 'string'
                            ? participante
                            : (participante.id ||
                               participante.jid ||
                               participante.phoneNumber ||
                               '')

                    if (!idParticipante) continue

                    const nome = idParticipante.split('@')[0]
                    const template = msgsEntrada[groupId] ||
                        `👋 Seja bem-vindo(a) ao grupo *{grupo}*, @{user}!\n\n` +
                        `Apresente-se com uma foto ou vídeo em *visualização única* 📸\n` +
                        `Fique à vontade e se sinta em casa!`

                    const mensagem = template
                        .replace(/\{grupo\}/gi, nomeGrupo)
                        .replace(/\{user\}/gi, nome)
                        .replace(/@pessoa/gi, `@${nome}`)

                    await sock.sendMessage(groupId, {
                        text: mensagem,
                        mentions: [idParticipante]
                    })
                }
            }

            if (action === 'remove') {
                for (const participante of participants) {
                    const idParticipante =
                        typeof participante === 'string'
                            ? participante
                            : (participante.id ||
                               participante.jid ||
                               participante.phoneNumber ||
                               '')

                    if (!idParticipante) continue

                    const nome = idParticipante.split('@')[0]
                    const template = msgsSaida[groupId] ||
                        `😮‍💨 @{user} não aguentou a nossa aura e caiu fora do grupo 🫩`

                    const mensagem = template
                        .replace(/\{user\}/gi, nome)
                        .replace(/@pessoa/gi, `@${nome}`)

                    await sock.sendMessage(groupId, {
                        text: mensagem,
                        mentions: [idParticipante]
                    })
                }
            }
        }
    )

    // ==============================
    // MENSAGENS
    // ==============================

    sock.ev.on(
        'messages.upsert',
        ponteWeb.registrarHandler(async ({ messages }) => {
            const msg = messages[0]

            if (!msg?.message) return
            if (msg.key.fromMe) return

            const from = msg.key.remoteJid

            // participantPn / participantAlt ajudam quando o WhatsApp usa @lid
            const autor =
                msg.key.participantPn ||
                msg.key.participantAlt ||
                msg.key.participant ||
                msg.participant ||
                msg.key.remoteJid

            const ehGrupo =
                from.endsWith('@g.us')

            // Chat privado vindo do site do Doodle Bot
            const ehWeb = ponteWeb.ehJidWeb(from)

            const listRowId =
                msg.message?.listResponseMessage?.singleSelectReply?.selectedRowId ||
                ''
            const buttonId =
                msg.message?.buttonsResponseMessage?.selectedButtonId ||
                ''

            let texto =
                msg.message.conversation ||
                msg.message.extendedTextMessage?.text ||
                ''

            // Clique na lista/botão da forca vira a letra escolhida
            if (listRowId.startsWith('forca_letra_')) {
                texto = listRowId.replace('forca_letra_', '')
            } else if (buttonId.startsWith('forca_letra_')) {
                texto = buttonId.replace('forca_letra_', '')
            }

            if (!texto) return

            const comando =
                texto.trim().toLowerCase()

            const mentionedJidBruto =
                msg.message
                    .extendedTextMessage
                    ?.contextInfo
                    ?.mentionedJid || []

            // No Termux só mostra comandos (mensagens normais continuam contando nos ranks)
            if (
                comando.startsWith(PREFIXO) ||
                listRowId ||
                buttonId ||
                mentionedJidBruto.length > 0
            ) {
                console.log(
                    `[${ehGrupo ? 'GRUPO' : 'PV'}] ${autor}: ${texto}` +
                    (mentionedJidBruto.length
                        ? ` | menções: ${mentionedJidBruto.join(', ')}`
                        : '')
                )
            }

            const autorEhAdmin =
                ehGrupo
                    ? await ehAdmin(from, autor)
                    : false

            const autorEhDono =
                ehGrupo
                    ? await ehDono(from, autor)
                    : false

            // ==============================
            // LIGAR / DESLIGAR O BOT NO GRUPO (!on / !off)
            // ==============================
            if (
                ehGrupo &&
                (comando === `${PREFIXO}on` ||
                    comando === `${PREFIXO}off` ||
                    comando === `${PREFIXO}ligar` ||
                    comando === `${PREFIXO}desligar`)
            ) {
                if (!ehDonoGlobal(autor)) {
                    await sock.sendMessage(
                        from,
                        { text: '❌ Só o dono global do bot pode usar !on / !off.' },
                        { quoted: msg }
                    )
                    return
                }

                const ligar =
                    comando === `${PREFIXO}on` || comando === `${PREFIXO}ligar`

                if (ligar) {
                    delete gruposDesligados[from]
                } else {
                    gruposDesligados[from] = true
                }

                persistir()

                await sock.sendMessage(
                    from,
                    {
                        text: ligar
                            ? '✅ *Doodle Bot* ligado neste grupo.'
                            : `⏸️ *Doodle Bot* desligado neste grupo.\nUse *${PREFIXO}on* pra reativar.`
                    },
                    { quoted: msg }
                )
                return
            }

            // Grupo desligado: ignora tudo (exceto !on, tratado acima)
            if (ehGrupo && gruposDesligados[from]) {
                return
            }

            // ==============================
            // PROTEÇÕES (anti-link, anti-status, etc.)
            // ==============================
            // Comandos do bot (ex: !baixar https://...) NÃO são bloqueados pelo anti-link
            const ehComandoBot =
                typeof texto === 'string' &&
                texto.trim().toLowerCase().startsWith(PREFIXO)

            if (
                ehGrupo &&
                !autorEhAdmin &&
                !autorEhDono &&
                !ehDonoGlobal(autor) &&
                !ehComandoBot
            ) {
                const textoBruto = texto || ''
                const temLink =
                    /https?:\/\/|www\.|wa\.me\/|chat\.whatsapp\.com\//i.test(textoBruto) ||
                    !!msg.message?.extendedTextMessage?.contextInfo?.externalAdReply

                if (protecaoAtiva(from, 'antilink') && temLink) {
                    try {
                        await sock.sendMessage(from, { delete: msg.key })
                    } catch {}
                    await sock.sendMessage(from, {
                        text: `🚫 @${autor.split('@')[0]} links não são permitidos aqui.`,
                        mentions: [autor]
                    })
                    return
                }

                // Anti-botão / lista interativa
                const temBotao =
                    msg.message?.buttonsResponseMessage ||
                    msg.message?.listResponseMessage ||
                    msg.message?.templateButtonReplyMessage ||
                    msg.message?.interactiveResponseMessage
                if (protecaoAtiva(from, 'antibotao') && temBotao) {
                    try { await sock.sendMessage(from, { delete: msg.key }) } catch {}
                    return
                }

                // Anti-payment
                if (
                    protecaoAtiva(from, 'antipayment') &&
                    (msg.message?.requestPaymentMessage ||
                        msg.message?.sendPaymentMessage ||
                        msg.message?.paymentInviteMessage)
                ) {
                    try { await sock.sendMessage(from, { delete: msg.key }) } catch {}
                    await sock.sendMessage(from, {
                        text: `🚫 Pagamentos no chat não são permitidos.`
                    })
                    return
                }
            }

            // ==============================
            // MESADA
            // ==============================

            if ((ehGrupo || ehWeb) && !autorEhDono) {
                const chave = chaveUser(from, autor)

                const hoje =
                    new Date()
                        .toISOString()
                        .slice(0, 10)

                if (ultimoDiario[chave] !== hoje) {
                    ultimoDiario[chave] = hoje

                    await adicionarSaldo(from, autor, MESADA_DIARIA)

                    persistir()

                    await sock.sendMessage(
                        from,
                        {
                            text:
                                `💰 ` +
                                `recebeu a mesada diária de ` +
                                `*${MESADA_DIARIA}* dinheiro!`,
                        }, { quoted: msg }
                    )
                }
            }

            // ==============================
            // TRIVIA ATIVA
            // ==============================

            if (
                ehGrupo &&
                triviaAtiva[from] &&
                normalizarTexto(texto) ===
                    triviaAtiva[from].resposta
            ) {
                clearTimeout(
                    triviaAtiva[from].timeout
                )

                const chave = chaveUser(from, autor)

                pontosTrivia[chave] =
                    (pontosTrivia[chave] || 0) + 1

                await adicionarSaldo(from, autor, RECOMPENSA_JOGO)

                persistir()

                await sock.sendMessage(
                    from,
                    {
                        text:
                            `🎉 acertou!\n\n` +
                            `💰 +${RECOMPENSA_JOGO} dinheiro\n` +
                            `🧠 Pontos de trivia: ${pontosTrivia[chave]}`,
                    }, { quoted: msg }
                )

                delete triviaAtiva[from]

                return
            }

            // ==============================
            // BANDEIRA ATIVA
            // ==============================

            if (
                ehGrupo &&
                bandeiraAtiva[from]
            ) {
                const tentativa = normalizarTexto(texto)
                const respostasOk = bandeiraAtiva[from].respostas || []

                if (respostasOk.includes(tentativa)) {
                    clearTimeout(bandeiraAtiva[from].timeout)

                    const chave = chaveUser(from, autor)
                    if (!temDinheiroInfinito(autor)) {
                        await adicionarSaldo(from, autor, RECOMPENSA_BANDEIRA)
                        persistir()
                    }

                    await sock.sendMessage(from, {
                        text:
                            `🎉 acertou!\n\n` +
                            `${bandeiraAtiva[from].emoji} País: *${bandeiraAtiva[from].paisDisplay}*\n` +
                            `💰 +${RECOMPENSA_BANDEIRA} dinheiro`,
                    }, { quoted: msg })

                    delete bandeiraAtiva[from]
                    return
                }
            }

            // ==============================
            // FORCA ATIVA (texto ou botão/lista)
            // ==============================

            if (
                ehGrupo &&
                jogosForca[from] &&
                normalizarTexto(texto).length === 1 &&
                /^[a-z]$/.test(normalizarTexto(texto))
            ) {
                await processarLetraForca(from, autor, texto, msg)
                return
            }

            // ==============================
            // PEDIDO DE MÚSICA (escolha de mídia)
            // ==============================

            {
                const chavePedido = `${from}_${autor}`
                const pedido = pedidosMusica[chavePedido]

                if (pedido) {
                    const escolha = normalizarTexto(texto)
                    const opcoesValidas = ['audio', 'áudio', 'video', 'vídeo', 'ambos', 'os dois', 'tudo']

                    if (opcoesValidas.includes(escolha) || ['1', '2', '3'].includes(escolha)) {
                        // Expira em 2 minutos
                        if (Date.now() - pedido.criadoEm > 120000) {
                            delete pedidosMusica[chavePedido]
                            await sock.sendMessage(from, {
                                text: '⏰ O pedido de música expirou. Use !tocar de novo.'
                            })
                            return
                        }

                        delete pedidosMusica[chavePedido]

                        let tipo = 'audio'
                        if (['video', 'vídeo', '2'].includes(escolha)) tipo = 'video'
                        else if (['ambos', 'os dois', 'tudo', '3'].includes(escolha)) tipo = 'ambos'
                        // 1 / audio / áudio → audio

                        await baixarEEnviarMusica(from, autor, pedido.nomeMusica, tipo, msg)
                        return
                    }
                }
            }

            // ==============================
            // CONTADOR
            // ==============================

            if (ehGrupo || ehWeb) {
                const chaveContador =
                    `${from}_${autor}`

                if (
                    !contadorMensagens[
                        chaveContador
                    ]
                ) {
                    contadorMensagens[
                        chaveContador
                    ] = {
                        autor,
                        count: 0
                    }
                }

                contadorMensagens[
                    chaveContador
                ].count++

                const novoNivel =
                    calcularNivel(
                        contadorMensagens[
                            chaveContador
                        ].count
                    )

                if (!niveis[chaveContador]) {
                    niveis[chaveContador] = {
                        nivel: 1
                    }
                }

                if (
                    novoNivel >
                    niveis[chaveContador].nivel
                ) {
                    niveis[chaveContador].nivel =
                        novoNivel

                    await sock.sendMessage(
                        from,
                        {
                            text:
                                `🆙 ` +
                                `subiu pro nível *${novoNivel}* (${calcularPatente(novoNivel)})!`,
                        }, { quoted: msg }
                    )
                }
            }

            // ==============================
            // LINKS
            // ==============================

            const temLink =
                /https?:\/\/|www\.|wa\.me\//i.test(
                    texto
                )

            if (
                ehGrupo &&
                temLink &&
                !autorEhAdmin
            ) {
                try {
                    await sock.sendMessage(
                        from,
                        {
                            delete: msg.key
                        }
                    )

                    await sock.sendMessage(
                        from,
                        {
                            text:
                                `🚫, ` +
                                `links não são permitidos aqui.`,
                        }, { quoted: msg }
                    )
                } catch (err) {
                    console.log(
                        'Erro ao apagar link:',
                        err.message
                    )
                }

                return
            }

            // ==============================
            // ANTI-SPAM
            // ==============================

            if (
                ehGrupo &&
                !texto.trim().startsWith(PREFIXO)
            ) {
                const chave =
                    `${from}_${autor}`

                const registro =
                    historicoSpam[chave]

                if (
                    registro &&
                    registro.ultimaMsg ===
                        texto.trim().toLowerCase()
                ) {
                    registro.contagem++

                    if (
                        registro.contagem ===
                        LIMITE_REPETICOES
                    ) {
                        await sock.sendMessage(
                            from,
                            {
                                text:
                                    `⚠️, ` +
                                    `você repetiu a mesma mensagem. ` +
                                    `Se repetir de novo vai tomar *ban*.`,
                            }, { quoted: msg }
                        )
                    } else if (
                        registro.contagem >
                        LIMITE_REPETICOES
                    ) {
                        try {
                            await sock.groupParticipantsUpdate(
                                from,
                                [autor],
                                'remove'
                            )

                            await sock.sendMessage(
                                from,
                                {
                                    text:
                                        `╭──────────────────────────────╮\n` +
                                        `│                              │\n` +
                                        `│ 🔨  USUÁRIO REMOVIDO!  🔨    │\n` +
                                        `│                              │\n` +
                                        `│ 👤\n` +
                                        `│                              │\n` +
                                        `│ ⚖️ Foi removido(a) com       │\n` +
                                        `│ sucesso por motivos justos  │\n` +
                                        `│                              │\n` +
                                        `│ 📋 Ação da moderação         │\n` +
                                        `│                              │\n` +
                                        `╰──────────────────────────────╯`,
                                }, { quoted: msg }
                            )
                        } catch (err) {
                            console.log(
                                'Erro ao banir:',
                                err.message
                            )
                        }

                        delete historicoSpam[chave]
                    }
                } else {
                    historicoSpam[chave] = {
                        ultimaMsg:
                            texto.trim().toLowerCase(),
                        contagem: 1
                    }
                }
            }

            // ==============================
            // MENU
            // ==============================

            const meuNumeroBot =
                (sock.user?.id || '').split(':')[0]

            const meuLidBot =
                (sock.user?.lid || '').split(':')[0].split('@')[0]

            const numerosDoBot =
                [meuNumeroBot, meuLidBot, NUMERO_BOT].filter(Boolean)

            // Quem foi citado (reply) nessa mensagem, se houver
            const contextInfoMsg =
                msg.message
                    .extendedTextMessage
                    ?.contextInfo

            const citouOBot =
                !!contextInfoMsg?.participant &&
                numerosDoBot.includes(
                    contextInfoMsg.participant.split('@')[0]
                )

            if (contextInfoMsg?.participant) {
                console.log(
                    `[DEBUG REPLY] numerosDoBot=${JSON.stringify(numerosDoBot)} ` +
                    `citouOBot=${citouOBot}`
                )
            }

            if (
                comando === `${PREFIXO}menu` ||
                comando === `${PREFIXO}ajuda`
            ) {
                let menu = ''

                if (ehGrupo) {
                    menu =
                        `╭──────────────────────────────╮\n` +
                        `│     🤖  𝑫𝒐𝒐𝒅𝒍𝒆 𝑩𝒐𝒕  𝑴𝒆𝒏𝒖     │\n` +
                        `╰──────────────────────────────╯\n` +
                        `✨ Criador: oaksthegod · TikTok: @oaksthegod · Instagram: @lss_storm\n\n` +

                        `░▒▓ 💰 𝐄𝐂𝐎𝐍𝐎𝐌𝐈𝐀 ▓▒░\n` +
                        `${PREFIXO}banco · ${PREFIXO}pix @pessoa <valor>\n` +
                        `${PREFIXO}loja · ${PREFIXO}comprar · ${PREFIXO}inventario\n` +
                        `${PREFIXO}doar @pessoa <item> · ${PREFIXO}diario\n` +
                        `${PREFIXO}apostar · ${PREFIXO}investir · ${PREFIXO}resgatar\n` +
                        `${PREFIXO}golpe @pessoa · ${PREFIXO}rankloja\n\n` +

                        `░▒▓ 🎮 𝐃𝐈𝐕𝐄𝐑𝐒𝐀̃𝐎 ▓▒░\n` +
                        `${PREFIXO}sorte · ${PREFIXO}8bola · ${PREFIXO}dado · ${PREFIXO}frase\n` +
                        `${PREFIXO}casal · ${PREFIXO}roleta · ${PREFIXO}trivia · ${PREFIXO}bandeira · ${PREFIXO}forca\n` +
                        `${PREFIXO}cupido · ${PREFIXO}casar · ${PREFIXO}divorciar · ${PREFIXO}topcasal\n` +
                        `${PREFIXO}niverrelacionamento · ${PREFIXO}abracar · ${PREFIXO}beijar\n` +
                        `${PREFIXO}cafune · ${PREFIXO}tapar · ${PREFIXO}matar · ${PREFIXO}segredo\n` +
                        `${PREFIXO}topfofos · ${PREFIXO}perguntas · ${PREFIXO}lembrete\n\n` +

                        `░▒▓ 📱 𝐌𝐈́𝐃𝐈𝐀 ▓▒░\n` +
                        `${PREFIXO}tocar <nome> — música (capa + ficha)\n` +
                        `${PREFIXO}baixar <link> — YT / TikTok / IG\n` +
                        `${PREFIXO}letra · ${PREFIXO}fig · ${PREFIXO}img · ${PREFIXO}revelar\n\n` +

                        `░▒▓ 🤖 𝐈𝐀 ▓▒░\n` +
                        `${PREFIXO}criarimg · ${PREFIXO}perguntar · ${PREFIXO}explicar\n` +
                        `${PREFIXO}historia · ${PREFIXO}piada · ${PREFIXO}conselho\n` +
                        `${PREFIXO}corrigir · ${PREFIXO}traduzir · ${PREFIXO}voz\n\n` +

                        `░▒▓ 📊 𝐄𝐒𝐓𝐀𝐓𝐈́𝐒𝐓𝐈𝐂𝐀𝐒 ▓▒░\n` +
                        `${PREFIXO}perfil · ${PREFIXO}nivel · ${PREFIXO}ranking · ${PREFIXO}rankingbanco\n\n` +

                        `░▒▓ 🛡️ 𝐀𝐃𝐌𝐈𝐍 ▓▒░\n` +
                        `${PREFIXO}banir · ${PREFIXO}avisar · ${PREFIXO}mutar · ${PREFIXO}desmutar\n` +
                        `${PREFIXO}todos · ${PREFIXO}enquete · ${PREFIXO}titulo · ${PREFIXO}denunciar\n` +
                        `${PREFIXO}setentrada · ${PREFIXO}setsaida\n` +
                        `${PREFIXO}abrirgrupo <HH:MM> · ${PREFIXO}fechargrupo <HH:MM>\n` +
                        `${PREFIXO}anuncioauto <min> <texto> · ${PREFIXO}paranuncio\n` +
                        `${PREFIXO}ativar / ${PREFIXO}desativar <função>\n` +
                        `${PREFIXO}funçõesdesativadas · ${PREFIXO}instruções_admin\n` +
                        `${PREFIXO}resetdinheiro · ${PREFIXO}setnivel · ${PREFIXO}reset save\n\n` +

                        `░▒▓ 🔒 𝐏𝐑𝐎𝐓𝐄𝐂̧𝐎̃𝐄𝐒 ▓▒░\n` +
                        `${PREFIXO}antilink on/off · ${PREFIXO}antistatus on/off\n` +
                        `${PREFIXO}antibotao on/off · ${PREFIXO}anticall on/off\n` +
                        `${PREFIXO}antipayment on/off\n\n` +

                        `░▒▓ ⚙️ 𝐃𝐎𝐍𝐎 𝐆𝐋𝐎𝐁𝐀𝐋 ▓▒░\n` +
                        `${PREFIXO}on · ${PREFIXO}off — liga/desliga o bot no grupo\n\n` +

                        `💡 Como ganhar dinheiro?\n` +
                        `• Mesada diária +500 · Trivia/forca +100 · ${PREFIXO}diario +5~20\n`
                } else {
                    menu =
                        `╭──────────────────────────────╮\n` +
                        `│  🤖  𝑫𝒐𝒐𝒅𝒍𝒆 𝑩𝒐𝒕  (PRIVADO)  │\n` +
                        `╰──────────────────────────────╯\n` +
                        `✨ Criador: oaksthegod · TikTok: @oaksthegod · Instagram: @lss_storm\n\n` +

                        `░▒▓ 💰 𝐄𝐂𝐎𝐍𝐎𝐌𝐈𝐀 ▓▒░\n` +
                        `${PREFIXO}banco · ${PREFIXO}loja · ${PREFIXO}comprar · ${PREFIXO}inventario\n\n` +

                        `░▒▓ 🎮 𝐃𝐈𝐕𝐄𝐑𝐒𝐀̃𝐎 ▓▒░\n` +
                        `${PREFIXO}sorte · ${PREFIXO}8bola · ${PREFIXO}dado · ${PREFIXO}frase\n` +
                        `${PREFIXO}fig · ${PREFIXO}img · ${PREFIXO}revelar\n` +
                        `${PREFIXO}tocar · ${PREFIXO}baixar · ${PREFIXO}letra\n\n` +

                        `░▒▓ 🤖 𝐈𝐀 ▓▒░\n` +
                        `${PREFIXO}criarimg · ${PREFIXO}perguntar · ${PREFIXO}explicar\n` +
                        `${PREFIXO}historia · ${PREFIXO}piada · ${PREFIXO}conselho\n` +
                        `${PREFIXO}corrigir · ${PREFIXO}traduzir · ${PREFIXO}voz\n\n` +

                        `░▒▓ 📊 𝐄𝐒𝐓𝐀𝐓𝐈́𝐒𝐓𝐈𝐂𝐀𝐒 ▓▒░\n` +
                        `${PREFIXO}perfil · ${PREFIXO}nivel\n\n` +

                        `❌ Comandos de grupo e admin só funcionam em grupos.`
                }

                if (fs.existsSync(IMAGEM_MENU_PATH)) {
                    await sock.sendMessage(
                        from,
                        {
                            image: fs.readFileSync(IMAGEM_MENU_PATH),
                            caption: menu
                        }
                    )
                } else {
                    console.log(
                        `Imagem do menu não encontrada em ${IMAGEM_MENU_PATH}, mandando só texto.`
                    )
                    await sock.sendMessage(
                        from,
                        { text: menu }
                    )
                }
            }

            // ==============================
            // BANCO
            // ==============================

            else if (
                comando === `${PREFIXO}banco`
            ) {
                const saldo = autorEhDono || temDinheiroInfinito(autor)
                    ? Infinity
                    : await lerSaldoUnificado(from, autor)

                const ehInfinitoAmor =
                    temDinheiroInfinito(autor) ||
                    temDinheiroInfinito(msg.key.participant) ||
                    temDinheiroInfinito(msg.key.participantPn) ||
                    temDinheiroInfinito(msg.key.participantAlt)

                let textoBanco

                if (ehInfinitoAmor) {
                    textoBanco =
                        `🏦 *SEU BANCO*\n\n` +
                        `👤\n` +
                        `💰 Saldo: *∞ Infinito*\n\n` +
                        `💕 Dinheiro infinito porque o criador do bot é apaixonado nela.`
                } else {
                    const textoSaldo =
                        saldo === Infinity
                            ? '∞ Infinito'
                            : `${saldo}`

                    textoBanco =
                        `🏦 *SEU BANCO*\n\n` +
                        `👤\n` +
                        `💰 Saldo: *${textoSaldo}*`
                }

                await sock.sendMessage(
                    from,
                    {
                        text: textoBanco,
                    }, { quoted: msg }
                )
            }

            // ==============================
            // PIX
            // ==============================

            else if (
                comando.startsWith(
                    `${PREFIXO}pix`
                )
            ) {
                const alvo = extrairAlvo(msg)

                // Aceita valor com ponto ou vírgula em qualquer posição
                // Exemplos válidos:
                // !pix @pessoa 10
                // !pix 10 @pessoa
                // !pix @pessoa 0,50
                // !pix 1.25 @pessoa
                const partes = texto.trim().split(/\s+/).slice(1) // remove o "!pix"
                let valorStr = null

                for (const p of partes) {
                    // ignora menções
                    if (p.startsWith('@')) continue
                    // troca vírgula por ponto e tenta converter
                    const limpo = p.replace(',', '.')
                    if (/^\d+(\.\d{1,2})?$/.test(limpo)) {
                        valorStr = limpo
                        break
                    }
                }

                const valor = valorStr !== null ? Number(valorStr) : NaN

                if (!ehGrupo) {
                    await sock.sendMessage(from, {
                        text: '❌ O PIX só pode ser usado em grupos.'
                    })
                } else if (!alvo) {
                    await sock.sendMessage(from, {
                        text:
                            `❌ Marque a pessoa.\n\n` +
                            `Exemplos:\n` +
                            `• ${PREFIXO}pix @pessoa 10\n` +
                            `• ${PREFIXO}pix 0,50 @pessoa\n` +
                            `• ${PREFIXO}pix @pessoa 1.25`
                    })
                } else if (
                    isNaN(valor) ||
                    valor <= 0 ||
                    valor > 1000000
                ) {
                    await sock.sendMessage(from, {
                        text:
                            '❌ Informe um valor válido (ex: 10 ou 0,50).\n' +
                            'Mínimo: 0,01 | Máximo: 1.000.000'
                    })
                } else if (
                    normalizarNumero(alvo) === normalizarNumero(autor)
                ) {
                    await sock.sendMessage(from, {
                        text: '❌ Você não pode mandar PIX para você mesmo.'
                    })
                } else {
                    const origemInfinita =
                        autorEhDono ||
                        temDinheiroInfinito(autor) ||
                        temDinheiroInfinito(msg.key.participant) ||
                        temDinheiroInfinito(msg.key.participantPn) ||
                        temDinheiroInfinito(msg.key.participantAlt)

                    const valorFinal = Math.round(valor * 100) / 100
                    const saldoOrigem = await lerSaldoUnificado(from, autor)

                    console.log(`[PIX] De: ${autor} | Para: ${alvo} | Valor: ${valorFinal} | Saldo origem: ${saldoOrigem}`)

                    if (!origemInfinita && saldoOrigem < valorFinal) {
                        await sock.sendMessage(from, {
                            text:
                                `❌ Saldo insuficiente.\n` +
                                `💰 Seu saldo: ${saldoOrigem}\n` +
                                `💸 Valor: ${valorFinal}`
                        })
                    } else {
                        // Tira de quem mandou
                        if (!origemInfinita) {
                            await adicionarSaldo(from, autor, -valorFinal)
                        }

                        // Coloca em quem recebeu (grava em TODAS as chaves possíveis)
                        const novoSaldoDestino = await adicionarSaldo(from, alvo, valorFinal)

                        // Extra: grava também usando o JID cru da menção e do autor resolvido
                        await adicionarSaldo(from, alvo, 0) // só unifica de novo

                        persistir()

                        console.log(`[PIX OK] Destino ficou com: ${novoSaldoDestino}`)

                        const valorFormatado = valorFinal.toLocaleString('pt-BR', {
                            minimumFractionDigits: valorFinal % 1 === 0 ? 0 : 2,
                            maximumFractionDigits: 2
                        })

                        await sock.sendMessage(from, {
                            text:
                                `💸 *PIX REALIZADO!*\n\n` +
                                `👤 De:\n` +
                                `👤 Para: @${alvo.split('@')[0]}\n` +
                                `💰 Valor: *R$ ${valorFormatado}*`,
                            mentions: [autor, alvo]
                        })
                    }
                }
            }

            // ==============================
            // LOJA
            // ==============================

            else if (
                comando === `${PREFIXO}loja`
            ) {
                const itens =
                    Object.entries(LOJA)

                let mensagem =
                    `🛒 *LOJA DO BOT*\n\n`

                mensagem +=
                    `💰 Use *${PREFIXO}comprar <item>* para comprar.\n`

                mensagem +=
                    `Exemplo: *${PREFIXO}comprar casa_simples*\n\n`

                itens.forEach(
                    ([id, item], index) => {
                        mensagem +=
                            `${index + 1}. ${item.nome}\n` +
                            `   🏷️ ID: *${id}*\n` +
                            `   💰 Preço: *${item.preco}*\n\n`
                    }
                )

                await sock.sendMessage(
                    from,
                    {
                        text: mensagem
                    }
                )
            }

            // ==============================
            // COMPRAR
            // ==============================

            else if (
                comando.startsWith(
                    `${PREFIXO}comprar`
                )
            ) {
                const partes =
                    texto.trim().split(/\s+/)

                const itemId =
                    partes[1]?.toLowerCase()

                if (!itemId) {
                    await sock.sendMessage(
                        from,
                        {
                            text:
                                `❌ Informe o ID do item.\n\n` +
                                `Use ${PREFIXO}loja para ver os produtos.`
                        }
                    )
                } else if (!LOJA[itemId]) {
                    await sock.sendMessage(
                        from,
                        {
                            text:
                                `❌ Esse item não existe.\n\n` +
                                `Use ${PREFIXO}loja para ver os itens disponíveis.`
                        }
                    )
                } else {
                    const item =
                        LOJA[itemId]

                    const chave = chaveUser(from, autor)
                    const saldo = autorEhDono || temDinheiroInfinito(autor)
                        ? Infinity
                        : await lerSaldoUnificado(from, autor)

                    if (
                        !autorEhDono &&
                        !temDinheiroInfinito(autor) &&
                        saldo < item.preco
                    ) {
                        await sock.sendMessage(
                            from,
                            {
                                text:
                                    `❌ Você não tem dinheiro suficiente.\n\n` +
                                    `🛍️ Item: ${item.nome}\n` +
                                    `💰 Preço: ${item.preco}\n` +
                                    `🏦 Seu saldo: ${saldo}`
                            }
                        )
                    } else {
                        const inventario =
                            garantirInventario(
                                chave
                            )

                        inventario[itemId] =
                            (inventario[itemId] || 0) + 1

                        if (!autorEhDono && !temDinheiroInfinito(autor)) {
                            await adicionarSaldo(from, autor, -item.preco)
                            gastoLoja[chave] =
                                (gastoLoja[chave] || 0) + item.preco
                        }

                        persistir()

                        await sock.sendMessage(
                            from,
                            {
                                text:
                                    `✅ *COMPRA REALIZADA!*\n\n` +
                                    `${item.nome}\n` +
                                    `💰 Valor: ${item.preco}\n` +
                                    `📦 Quantidade: ${inventario[itemId]}\n\n` +
                                    `Use *${PREFIXO}inventario* para ver seus itens.`
                            }
                        )
                    }
                }
            }

            // ==============================
            // INVENTÁRIO
            // ==============================

            else if (
                comando === `${PREFIXO}inventario`
            ) {
                const chave =
                    chaveUser(from, autor)

                const inventario =
                    inventarios[chave] || {}

                const itens =
                    Object.entries(inventario)
                        .filter(
                            ([, quantidade]) =>
                                quantidade > 0
                        )

                if (itens.length === 0) {
                    await sock.sendMessage(
                        from,
                        {
                            text:
                                `🎒 *SEU INVENTÁRIO*\n\n` +
                                `Você ainda não possui nenhum item.\n\n` +
                                `Use *${PREFIXO}loja* para visitar a loja.`
                        }
                    )
                } else {
                    let mensagem =
                        `🎒 *SEU INVENTÁRIO*\n\n`

                    itens.forEach(
                        ([id, quantidade]) => {
                            const item =
                                LOJA[id]

                            if (item) {
                                mensagem +=
                                    `${item.nome}\n` +
                                    `🔢 Quantidade: *${quantidade}*\n` +
                                    `🏷️ ID: ${id}\n\n`
                            }
                        }
                    )

                    await sock.sendMessage(
                        from,
                        {
                            text: mensagem
                        }
                    )
                }
            }

            // ==============================
            // PING
            // ==============================

            else if (
                comando === `${PREFIXO}ping`
            ) {
                await sock.sendMessage(
                    from,
                    {
                        text:
                            'Pong! Estou funcionando! 🏓'
                    }
                )
            }

            // ==============================
            // OI
            // ==============================

            else if (
                comando === `${PREFIXO}oi`
            ) {
                await sock.sendMessage(
                    from,
                    {
                        text:
                            `E aí! Como posso ajudar?\n` +
                            `Digite *${PREFIXO}menu* para ver os comandos.`
                    }
                )
            }

            // ==============================
            // GRUPO
            // ==============================

            else if (
                comando === `${PREFIXO}grupo` &&
                ehGrupo
            ) {
                const metadata =
                    await sock.groupMetadata(
                        from
                    )

                await sock.sendMessage(
                    from,
                    {
                        text:
                            `📋 *${metadata.subject}*\n` +
                            `👥 ${metadata.participants.length} membros`
                    }
                )
            }

            // ==============================
            // REGRAS
            // ==============================

            else if (
                comando === `${PREFIXO}regras`
            ) {
                await sock.sendMessage(
                    from,
                    {
                        text:
                            `📜 *REGRAS DO GRUPO*\n\n` +
                            `1. Sem spam\n` +
                            `2. Sem flood\n` +
                            `3. Sem links sem permissão\n` +
                            `4. Respeito com todo mundo`
                    }
                )
            }

            // ==============================
            // HORÁRIO
            // ==============================

            else if (
                comando === `${PREFIXO}horario`
            ) {
                const agora =
                    new Date().toLocaleString(
                        'pt-BR',
                        {
                            timeZone:
                                'America/Recife'
                        }
                    )

                await sock.sendMessage(
                    from,
                    {
                        text:
                            `🕐 Agora são: ${agora}`
                    }
                )
            }

            // ==============================
            // CALCULADORA
            // ==============================

            else if (
                comando.startsWith(
                    `${PREFIXO}calculo`
                )
            ) {
                const expressao =
                    texto.trim().slice(
                        PREFIXO.length + 7
                    ).trim()

                if (!expressao) {
                    await sock.sendMessage(
                        from,
                        {
                            text:
                                `Use assim: ${PREFIXO}calculo 2 + 2 * 5`
                        }
                    )
                } else if (
                    !/^[0-9+\-*/().\s%]+$/.test(
                        expressao
                    )
                ) {
                    await sock.sendMessage(
                        from,
                        {
                            text:
                                '❌ Só aceito números e operadores.'
                        }
                    )
                } else {
                    try {
                        const resultado =
                            Function(
                                '"use strict"; return (' +
                                expressao +
                                ')'
                            )()

                        if (
                            typeof resultado !== 'number' ||
                            !isFinite(resultado)
                        ) {
                            throw new Error(
                                'resultado inválido'
                            )
                        }

                        await sock.sendMessage(
                            from,
                            {
                                text:
                                    `🧮 ${expressao} = *${resultado}*`
                            }
                        )
                    } catch {
                        await sock.sendMessage(
                            from,
                            {
                                text:
                                    '❌ Não consegui calcular isso.'
                            }
                        )
                    }
                }
            }

            // ==============================
            // PERFIL
            // ==============================

            else if (
                comando === `${PREFIXO}perfil`
            ) {
                const chave =
                    `${from}_${autor}`

                const msgs =
                    contadorMensagens[
                        chave
                    ]?.count || 0

                const advertencias =
                    avisos[chave] || 0

                const nivel =
                    niveis[chave]?.nivel || 1

                const saldo = autorEhDono || temDinheiroInfinito(autor)
                    ? Infinity
                    : await lerSaldoUnificado(from, autor)

                const itens =
                    Object.values(
                        inventarios[chaveUser(from, autor)] || {}
                    ).reduce(
                        (total, n) => total + n,
                        0
                    )

                const tituloUser = titulos[chave] || null
                const igUser = instagrams[chave] || null
                const bioUser = bios[chave] || null

                let textoPerfil =
                    `👤 *SEU PERFIL*\n\n` +
                    `💬 Mensagens: ${msgs}\n` +
                    `🆙 Nível: ${nivel} (${calcularPatente(nivel)})\n`

                if (tituloUser) textoPerfil += `👑 Título: *${tituloUser}*\n`
                if (igUser) textoPerfil += `📱 Instagram: @${igUser}\n`
                if (bioUser) textoPerfil += `📝 Bio: ${bioUser}\n`

                textoPerfil +=
                    `⚠️ Advertências: ${advertencias}\n` +
                    `💰 Dinheiro: ${saldo === Infinity ? '∞' : saldo}\n` +
                    `🎒 Itens: ${itens}`

                await sock.sendMessage(
                    from,
                    {
                        text: textoPerfil,
                    }, { quoted: msg }
                )
            }

            // ==============================
            // BIO
            // ==============================

            else if (
                comando.startsWith(`${PREFIXO}bio`)
            ) {
                const chave = `${from}_${autor}`
                const textoBio = texto.trim().slice(PREFIXO.length + 3).trim()

                if (!textoBio) {
                    if (bios[chave]) {
                        delete bios[chave]
                        persistir()
                        await sock.sendMessage(from, {
                            text: `✅ Bio removida do seu perfil.`,
                        }, { quoted: msg })
                    } else {
                        await sock.sendMessage(from, {
                            text: 
                                `📝 Use assim:\n` +
                                `${PREFIXO}bio sua frase aqui\n\n` +
                                `Exemplo: ${PREFIXO}bio Amo café e madrugada\n` +
                                `Para remover: ${PREFIXO}bio`
                            
                        })
                    }
                } else if (textoBio.length > 80) {
                    await sock.sendMessage(from, {
                        text: `❌ A bio pode ter no máximo 80 caracteres.`
                    })
                } else {
                    bios[chave] = textoBio
                    persistir()
                    await sock.sendMessage(from, {
                        text: 
                            `✅ Bio atualizada!\n\n` +
                            `📝 ${textoBio}\n\n` +
                            `Veja com ${PREFIXO}perfil`
                        ,
                    }, { quoted: msg })
                }
            }

            // ==============================
            // INSTAGRAM
            // ==============================

            else if (
                comando.startsWith(`${PREFIXO}instagram`) ||
                comando.startsWith(`${PREFIXO}ig`)
            ) {
                const chave = `${from}_${autor}`
                // Aceita !instagram ou !ig
                const prefixLen = comando.startsWith(`${PREFIXO}instagram`)
                    ? PREFIXO.length + 9
                    : PREFIXO.length + 2
                let usuarioIg = texto.trim().slice(prefixLen).trim()

                // Remove @ se a pessoa colocar
                if (usuarioIg.startsWith('@')) {
                    usuarioIg = usuarioIg.slice(1)
                }

                if (!usuarioIg) {
                    if (instagrams[chave]) {
                        delete instagrams[chave]
                        persistir()
                        await sock.sendMessage(from, {
                            text: `✅ Instagram removido do seu perfil.`,
                        }, { quoted: msg })
                    } else {
                        await sock.sendMessage(from, {
                            text: 
                                `📱 Use assim:\n` +
                                `${PREFIXO}instagram seuusuario\n` +
                                `ou ${PREFIXO}ig seuusuario\n\n` +
                                `Exemplo: ${PREFIXO}ig oaksthegod\n` +
                                `Para remover: ${PREFIXO}instagram`
                            
                        })
                    }
                } else if (!/^[a-zA-Z0-9._]{1,30}$/.test(usuarioIg)) {
                    await sock.sendMessage(from, {
                        text: `❌ Usuário de Instagram inválido. Use apenas letras, números, ponto e underline.`
                    })
                } else {
                    instagrams[chave] = usuarioIg
                    persistir()
                    await sock.sendMessage(from, {
                        text: 
                            `✅ Instagram atualizado!\n\n` +
                            `📱 @${usuarioIg}\n\n` +
                            `Veja com ${PREFIXO}perfil`
                        ,
                    }, { quoted: msg })
                }
            }

            // ==============================
            // NIVEL
            // ==============================

            else if (
                comando === `${PREFIXO}nivel`
            ) {
                const chave =
                    `${from}_${autor}`

                const msgs =
                    contadorMensagens[
                        chave
                    ]?.count || 0

                const nivel =
                    niveis[chave]?.nivel || 1

                const faltam =
                    (nivel *
                        MENSAGENS_POR_NIVEL) -
                    msgs

                await sock.sendMessage(
                    from,
                    {
                        text:
                            `🆙 está no nível *${nivel}* (${calcularPatente(nivel)}).\n` +
                            `💬 Faltam ${faltam} mensagens pro próximo nível.`,
                    }, { quoted: msg }
                )
            }

            // ==============================
            // SETNIVEL (só dono)
            // ==============================

            else if (
                comando.startsWith(
                    `${PREFIXO}setnivel`
                )
            ) {
                if (!ehGrupo) {
                    await sock.sendMessage(
                        from,
                        {
                            text:
                                '❌ Esse comando só funciona em grupos.'
                        }
                    )
                } else if (!autorEhDono) {
                    await sock.sendMessage(
                        from,
                        {
                            text:
                                '🚫 Somente o *dono do grupo* pode usar esse comando.'
                        }
                    )
                } else {
                    const partes =
                        texto.trim().split(/\s+/)

                    const novoNivel =
                        Number(partes[1])

                    if (
                        !Number.isInteger(novoNivel) ||
                        novoNivel < 1 ||
                        novoNivel > NIVEL_MAXIMO
                    ) {
                        await sock.sendMessage(
                            from,
                            {
                                text:
                                    `❌ Informe um nível válido entre 1 e ${NIVEL_MAXIMO}.\n` +
                                    `Exemplo: ${PREFIXO}setnivel 50`
                            }
                        )
                    } else {
                        const chave =
                            `${from}_${autor}`

                        if (!niveis[chave]) {
                            niveis[chave] = { nivel: 1 }
                        }

                        niveis[chave].nivel = novoNivel

                        // Ajusta o contador de mensagens para combinar com o nível
                        if (!contadorMensagens[chave]) {
                            contadorMensagens[chave] = {
                                autor,
                                count: 0
                            }
                        }

                        contadorMensagens[chave].count =
                            (novoNivel - 1) * MENSAGENS_POR_NIVEL

                        persistir()

                        await sock.sendMessage(
                            from,
                            {
                                text:
                                    `✅ definiu o nível para *${novoNivel}* (${calcularPatente(novoNivel)})!`,
                            }, { quoted: msg }
                        )
                    }
                }
            }

            // ==============================
            // SORTE
            // ==============================

            else if (
                comando === `${PREFIXO}sorte`
            ) {
                const frase =
                    FRASES_SORTE[
                        Math.floor(
                            Math.random() *
                            FRASES_SORTE.length
                        )
                    ]

                await sock.sendMessage(
                    from,
                    {
                        text:
                            `\n` +
                            frase,
                    }, { quoted: msg }
                )
            }

            // ==============================
            // 8 BOLA
            // ==============================

            else if (
                comando.startsWith(
                    `${PREFIXO}8bola`
                )
            ) {
                const pergunta =
                    texto.trim().slice(
                        PREFIXO.length + 5
                    ).trim()

                if (!pergunta) {
                    await sock.sendMessage(
                        from,
                        {
                            text:
                                `Use assim: ${PREFIXO}8bola vou ficar rico?`
                        }
                    )
                } else {
                    const resposta =
                        RESPOSTAS_8BOLA[
                            Math.floor(
                                Math.random() *
                                RESPOSTAS_8BOLA.length
                            )
                        ]

                    await sock.sendMessage(
                        from,
                        {
                            text:
                                `🎱\n` +
                                resposta,
                        }, { quoted: msg }
                    )

                    await enviarGifUrl(from, GIF_8BOLA)
                }
            }

            // ==============================
            // DADO
            // ==============================

            else if (
                comando === `${PREFIXO}dado`
            ) {
                const numero =
                    Math.floor(
                        Math.random() * 6
                    ) + 1

                await sock.sendMessage(
                    from,
                    {
                        text:
                            `🎲 tirou: *${numero}*`,
                    }, { quoted: msg }
                )

                await enviarGifUrl(from, GIF_DADO)
            }

            // ==============================
            // FRASE
            // ==============================

            else if (
                comando === `${PREFIXO}frase`
            ) {
                const frase =
                    FRASES_MOTIVACIONAIS[
                        Math.floor(
                            Math.random() *
                            FRASES_MOTIVACIONAIS.length
                        )
                    ]

                await sock.sendMessage(
                    from,
                    {
                        text:
                            `\n` +
                            frase,
                    }, { quoted: msg }
                )
            }

            // ==============================
            // CASAL
            // ==============================

            else if (
                comando === `${PREFIXO}casal` &&
                ehGrupo
            ) {
                const metadata =
                    await sock.groupMetadata(
                        from
                    )

                const membros =
                    metadata.participants.filter(
                        p => !p.admin
                    )

                if (membros.length < 2) {
                    await sock.sendMessage(
                        from,
                        {
                            text:
                                'Precisa de pelo menos 2 pessoas.'
                        }
                    )
                } else {
                    const embaralhados =
                        [...membros].sort(
                            () => Math.random() - 0.5
                        )

                    const [p1, p2] =
                        embaralhados

                    await sock.sendMessage(
                        from,
                        {
                            text:
                                `💘 *CASAL DO DIA*\n\n` +
                                `@${p1.id.split('@')[0]} ❤️ @${p2.id.split('@')[0]}`,
                            mentions: [
                                p1.id,
                                p2.id
                            ]
                        }
                    )

                    const gifCasal =
                        GIFS_CASAL[
                            Math.floor(
                                Math.random() *
                                GIFS_CASAL.length
                            )
                        ]

                    await enviarGifUrl(from, gifCasal)
                }
            }

            // ==============================
            // ROLETA
            // ==============================

            else if (
                comando === `${PREFIXO}roleta` &&
                ehGrupo
            ) {
                const metadata =
                    await sock.groupMetadata(
                        from
                    )

                const membros =
                    metadata.participants

                const sorteado =
                    membros[
                        Math.floor(
                            Math.random() *
                            membros.length
                        )
                    ]

                await sock.sendMessage(
                    from,
                    {
                        text:
                            `🎯 A pessoa sorteada foi: @${sorteado.id.split('@')[0]}`,
                        mentions: [
                            sorteado.id
                        ]
                    }
                )
            }

            // ==============================
            // TRIVIA
            // ==============================

            else if (
                comando === `${PREFIXO}trivia` &&
                ehGrupo
            ) {
                if (triviaAtiva[from]) {
                    await sock.sendMessage(
                        from,
                        {
                            text:
                                '🧠 Já tem uma trivia rolando! Responde essa primeiro.'
                        }
                    )
                } else {
                    const pergunta =
                        PERGUNTAS_TRIVIA[
                            Math.floor(
                                Math.random() *
                                PERGUNTAS_TRIVIA.length
                            )
                        ]

                    const timeout =
                        setTimeout(
                            async () => {
                                await sock.sendMessage(
                                    from,
                                    {
                                        text:
                                            `⏰ Tempo esgotado!\n` +
                                            `A resposta era: *${pergunta.resposta}*`
                                    }
                                )

                                delete triviaAtiva[
                                    from
                                ]
                            },
                            TEMPO_TRIVIA_MS
                        )

                    triviaAtiva[from] = {
                        resposta:
                            normalizarTexto(
                                pergunta.resposta
                            ),
                        timeout
                    }

                    const temaTrivia = (() => {
                        const p = pergunta.pergunta.toLowerCase()
                        if (p.includes('capital') || p.includes('país') || p.includes('continente') || p.includes('rio') || p.includes('deserto') || p.includes('oceano')) return 'Geografia'
                        if (p.includes('planeta') || p.includes('estrela') || p.includes('lua') || p.includes('sistema solar') || p.includes('galáxia') || p.includes('galaxia')) return 'Astronomia'
                        if (p.includes('osso') || p.includes('órgão') || p.includes('orgao') || p.includes('corpo') || p.includes('sangue')) return 'Biologia'
                        if (p.includes('quanto é') || p.includes('raiz') || p.includes('número') || p.includes('numero') || p.includes('lado')) return 'Matemática'
                        if (p.includes('guerra') || p.includes('pintou') || p.includes('escreveu') || p.includes('primeiro homem')) return 'História'
                        if (p.includes('esporte') || p.includes('futebol') || p.includes('jogador') || p.includes('touchdown')) return 'Esportes'
                        if (p.includes('cor ') || p.includes('arco-íris') || p.includes('arco iris')) return 'Cores'
                        if (p.includes('animal') || p.includes('pato') || p.includes('aranha') || p.includes('inseto')) return 'Animais'
                        if (p.includes('gás') || p.includes('gas') || p.includes('símbolo') || p.includes('simbolo') || p.includes('metal') || p.includes('água') || p.includes('agua')) return 'Ciências'
                        return 'Conhecimentos Gerais'
                    })()

                    await sock.sendMessage(
                        from,
                        {
                            text:
                                `🧠 *TRIVIA!*\n\n` +
                                `📂 Tema: *${temaTrivia}*\n\n` +
                                `${pergunta.pergunta}\n\n` +
                                `⏱️ Você tem 30 segundos!\n` +
                                `🏆 Acertou? +${RECOMPENSA_JOGO} dinheiro!`
                        }
                    )
                }
            }

            // ==============================
            // BANDEIRA
            // ==============================

            else if (
                comando === `${PREFIXO}bandeira` &&
                ehGrupo
            ) {
                if (bandeiraAtiva[from]) {
                    await sock.sendMessage(from, {
                        text: '🏳️ Já tem uma bandeira rolando! Adivinha essa primeiro.'
                    })
                } else {
                    const item =
                        BANDEIRAS[
                            Math.floor(Math.random() * BANDEIRAS.length)
                        ]

                    const respostas = [
                        normalizarTexto(item.pais),
                        ...(item.aliases || []).map(a => normalizarTexto(a))
                    ]

                    const timeout = setTimeout(async () => {
                        await sock.sendMessage(from, {
                            text:
                                `⏰ Tempo esgotado!\n` +
                                `${item.emoji} A resposta era: *${item.pais}*`
                        })
                        delete bandeiraAtiva[from]
                    }, TEMPO_TRIVIA_MS)

                    bandeiraAtiva[from] = {
                        respostas,
                        emoji: item.emoji,
                        paisDisplay: item.pais,
                        timeout
                    }

                    await sock.sendMessage(from, {
                        text:
                            `🏳️ *ADIVINHE O PAÍS!*\n\n` +
                            `${item.emoji}\n\n` +
                            `Qual país é essa bandeira?\n` +
                            `⏱️ 30 segundos\n` +
                            `🏆 Acertou? +${RECOMPENSA_BANDEIRA} dinheiro!`
                    })
                }
            }

            // ==============================
            // FORCA
            // ==============================

            else if (
                comando === `${PREFIXO}forca` &&
                ehGrupo
            ) {
                if (jogosForca[from]) {
                    await enviarTecladoForca(
                        from,
                        jogosForca[from],
                        '🎮 *JOGO DA FORCA EM ANDAMENTO*'
                    )
                } else {
                    const escolha =
                        PALAVRAS_FORCA[
                            Math.floor(
                                Math.random() *
                                PALAVRAS_FORCA.length
                            )
                        ]

                    jogosForca[from] = {
                        palavra: escolha.palavra,
                        tema: escolha.tema,
                        certas: new Set(),
                        erradas: new Set(),
                        tentativas:
                            TENTATIVAS_FORCA
                    }

                    await enviarTecladoForca(
                        from,
                        jogosForca[from],
                        `🎮 *JOGO DA FORCA!*\n📂 Tema: *${escolha.tema}*\n🏆 Complete e ganhe +${RECOMPENSA_JOGO} dinheiro!`
                    )
                }
            }

            // ==============================
            // RANKING
            // ==============================

            else if (
                comando === `${PREFIXO}ranking` &&
                ehGrupo
            ) {
                const doGrupo =
                    Object.entries(
                        contadorMensagens
                    )
                        .filter(
                            ([chave]) =>
                                chave.startsWith(
                                    from
                                )
                        )
                        .map(
                            ([, valor]) =>
                                valor
                        )
                        .sort(
                            (a, b) =>
                                b.count - a.count
                        )
                        .slice(0, 5)

                if (doGrupo.length === 0) {
                    await sock.sendMessage(
                        from,
                        {
                            text:
                                'Ainda não tenho dados suficientes.'
                        }
                    )
                } else {
                    let textoRanking =
                        `╭────────────────────────────╮\n` +
                        `│                            │\n` +
                        `│ 🏆 RANK MAIS ATIVOS DO     │\n` +
                        `│    GRUPO                   │\n` +
                        `│                            │\n` +
                        `╰────────────────────────────╯\n\n`

                    const medalhas = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣']

                    doGrupo.forEach(
                        (item, i) => {
                            textoRanking +=
                                `${medalhas[i] || (i + 1) + 'º'} — @${item.autor.split('@')[0]}\n` +
                                `💬 Msgs: ${item.count}\n\n`
                        }
                    )

                    await sock.sendMessage(
                        from,
                        {
                            text: textoRanking,
                            mentions:
                                doGrupo.map(
                                    item =>
                                        item.autor
                                )
                        }
                    )
                }
            }

            // ==============================
            // RANKING BANCO
            // ==============================

            else if (
                comando === `${PREFIXO}rankingbanco` &&
                ehGrupo
            ) {
                // Agrupa por número pra não duplicar a mesma pessoa
                const porNumero = {}
                for (const [chave, saldo] of Object.entries(saldoBanco)) {
                    if (!chave.startsWith(from + '_') && !chave.startsWith(from)) continue
                    if (!chave.startsWith(from)) continue
                    const parte = chave.slice(from.length + 1)
                    const num = normalizarNumero(parte) || parte
                    const val = Number(saldo) || 0
                    if (!porNumero[num] || val > porNumero[num].saldo) {
                        porNumero[num] = { autor: parte.includes('@') ? parte : num + '@s.whatsapp.net', saldo: val }
                    }
                }
                const doGrupo = Object.values(porNumero)
                    .sort((a, b) => b.saldo - a.saldo)
                    .slice(0, 5)

                if (doGrupo.length === 0) {
                    await sock.sendMessage(
                        from,
                        {
                            text:
                                'Ainda não tenho dados suficientes.'
                        }
                    )
                } else {
                    let textoRanking =
                        `╭────────────────────────────╮\n` +
                        `│                            │\n` +
                        `│ 💰 RANK MAIS RICOS DO      │\n` +
                        `│    GRUPO                   │\n` +
                        `│                            │\n` +
                        `╰────────────────────────────╯\n\n`

                    const medalhas = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣']

                    doGrupo.forEach(
                        (item, i) => {
                            textoRanking +=
                                `${medalhas[i] || (i + 1) + 'º'} — @${item.autor.split('@')[0]}\n` +
                                `💰 Saldo: ${item.saldo}\n\n`
                        }
                    )

                    await sock.sendMessage(
                        from,
                        {
                            text: textoRanking,
                            mentions:
                                doGrupo.map(
                                    item => item.autor
                                )
                        }
                    )
                }
            }

            // ==============================
            // DOAR ITEM
            // ==============================

            else if (
                comando.startsWith(
                    `${PREFIXO}doar`
                )
            ) {
                const alvo =
                    extrairAlvo(msg)

                const partes =
                    texto.trim().split(/\s+/)

                const itemId =
                    partes[partes.length - 1]?.toLowerCase()

                if (!ehGrupo) {
                    await sock.sendMessage(
                        from,
                        {
                            text:
                                '❌ Doações só funcionam em grupos.'
                        }
                    )
                } else if (!alvo) {
                    await sock.sendMessage(
                        from,
                        {
                            text:
                                `❌ Marque a pessoa.\n\n` +
                                `Exemplo: ${PREFIXO}doar @pessoa casa_simples`
                        }
                    )
                } else if (alvo === autor) {
                    await sock.sendMessage(
                        from,
                        {
                            text:
                                '❌ Você não pode doar um item pra você mesmo.'
                        }
                    )
                } else if (
                    !itemId ||
                    !LOJA[itemId]
                ) {
                    await sock.sendMessage(
                        from,
                        {
                            text:
                                `❌ Informe um item válido.\n\n` +
                                `Exemplo: ${PREFIXO}doar @pessoa casa_simples\n` +
                                `Use ${PREFIXO}inventario pra ver seus itens.`
                        }
                    )
                } else {
                    const chaveOrigem =
                        chaveUser(from, autor)

                    const chaveDestino =
                        chaveUser(from, alvo)

                    const inventarioOrigem =
                        garantirInventario(
                            chaveOrigem
                        )

                    if (
                        !inventarioOrigem[itemId] ||
                        inventarioOrigem[itemId] <= 0
                    ) {
                        await sock.sendMessage(
                            from,
                            {
                                text:
                                    `❌ Você não tem esse item pra doar.`
                            }
                        )
                    } else {
                        inventarioOrigem[itemId]--

                        const inventarioDestino =
                            garantirInventario(
                                chaveDestino
                            )

                        inventarioDestino[itemId] =
                            (inventarioDestino[itemId] || 0) + 1

                        persistir()

                        const item =
                            LOJA[itemId]

                        await sock.sendMessage(
                            from,
                            {
                                text:
                                    `🎁 *DOAÇÃO REALIZADA!*\n\n` +
                                    `👤 De:\n` +
                                    `👤 Para: @${alvo.split('@')[0]}\n` +
                                    `📦 Item: ${item.nome}`,
                                mentions: [
                                    autor,
                                    alvo
                                ]
                            }
                        )
                    }
                }
            }

            // ==============================
            // CUPIDO
            // ==============================

            else if (
                comando.startsWith(
                    `${PREFIXO}cupido`
                ) &&
                ehGrupo
            ) {
                const alvo =
                    extrairAlvo(msg)

                if (!alvo) {
                    await sock.sendMessage(
                        from,
                        {
                            text:
                                `❌ Marque a pessoa.\n\n` +
                                `Exemplo: ${PREFIXO}cupido @pessoa`
                        }
                    )
                } else {
                    const cantada =
                        CANTADAS[
                            Math.floor(
                                Math.random() *
                                CANTADAS.length
                            )
                        ]

                    await sock.sendMessage(
                        from,
                        {
                            text:
                                `💘 mandou uma cantada pra ` +
                                `@${alvo.split('@')[0]}:\n\n` +
                                `"${cantada}"`,
                            mentions: [
                                autor,
                                alvo
                            ]
                        }
                    )

                    const gifCupido =
                        GIFS_CUPIDO[
                            Math.floor(
                                Math.random() *
                                GIFS_CUPIDO.length
                            )
                        ]

                    await enviarGifUrl(from, gifCupido)
                }
            }

            // ==============================
            // CASAR
            // ==============================

            else if (
                comando.startsWith(`${PREFIXO}casar`) &&
                ehGrupo
            ) {
                const alvo = extrairAlvo(msg)

                if (!alvo) {
                    await sock.sendMessage(from, {
                        text: `❌ Marque a pessoa.\nExemplo: ${PREFIXO}casar @pessoa`
                    })
                } else if (alvo === autor) {
                    await sock.sendMessage(from, {
                        text: '❌ Você não pode casar consigo mesmo.'
                    })
                } else {
                    const chaveGrupo = from
                    if (!casamentos[chaveGrupo]) casamentos[chaveGrupo] = {}

                    // Compatível com formato antigo [a,b] e novo {par, desde}
                    const pegaPar = (v) => Array.isArray(v) ? v : (v?.par || [])

                    const jaCasadoAutor = Object.entries(casamentos[chaveGrupo]).find(
                        ([, v]) => pegaPar(v).includes(autor)
                    )
                    const jaCasadoAlvo = Object.entries(casamentos[chaveGrupo]).find(
                        ([, v]) => pegaPar(v).includes(alvo)
                    )

                    if (jaCasadoAutor) {
                        await sock.sendMessage(from, {
                            text: '❌ Você já está casado(a). Use !divorciar primeiro.'
                        })
                    } else if (jaCasadoAlvo) {
                        await sock.sendMessage(from, {
                            text: '❌ Essa pessoa já está casada.'
                        })
                    } else {
                        const idCasamento = `${autor}_${alvo}`
                        casamentos[chaveGrupo][idCasamento] = {
                            par: [autor, alvo],
                            desde: Date.now()
                        }
                        persistir()

                        await sock.sendMessage(from, {
                            text:
                                `💍 *CASAMENTO REALIZADO!*\n\n` +
                                `❤️ @${alvo.split('@')[0]}\n\n` +
                                `Parabéns aos noivos!`,
                            mentions: [autor, alvo]
                        })
                    }
                }
            }

            // ==============================
            // DIVORCIAR
            // ==============================

            else if (
                comando === `${PREFIXO}divorciar` &&
                ehGrupo
            ) {
                const chaveGrupo = from
                if (!casamentos[chaveGrupo]) casamentos[chaveGrupo] = {}

                const pegaPar = (v) => Array.isArray(v) ? v : (v?.par || [])

                const casamento = Object.entries(casamentos[chaveGrupo]).find(
                    ([, v]) => pegaPar(v).includes(autor)
                )

                if (!casamento) {
                    await sock.sendMessage(from, {
                        text: '❌ Você não está casado(a).'
                    })
                } else {
                    const [idCasamento, dadosCasal] = casamento
                    const par = pegaPar(dadosCasal)
                    const outro = par.find(p => p !== autor)

                    delete casamentos[chaveGrupo][idCasamento]
                    persistir()

                    await sock.sendMessage(from, {
                        text:
                            `💔 *DIVÓRCIO REALIZADO*\n\n` +
                            `se divorciou de @${outro.split('@')[0]}.`,
                        mentions: [autor, outro]
                    })
                }
            }

            // ==============================
            // TOPCASAL
            // ==============================

            else if (
                comando === `${PREFIXO}topcasal` &&
                ehGrupo
            ) {
                const chaveGrupo = from
                const lista = casamentos[chaveGrupo] ? Object.values(casamentos[chaveGrupo]) : []

                if (lista.length === 0) {
                    await sock.sendMessage(from, {
                        text: 'Ainda não há casais neste grupo.'
                    })
                } else {
                    let texto = `💕 *CASAIS DO GRUPO*\n\n`
                    const mentions = []
                    const pegaPar = (v) => Array.isArray(v) ? v : (v?.par || [])

                    lista.forEach((dadosCasal, i) => {
                        const par = pegaPar(dadosCasal)
                        if (par.length >= 2) {
                            texto += `${i + 1}. @${par[0].split('@')[0]} ❤️ @${par[1].split('@')[0]}\n`
                            mentions.push(par[0], par[1])
                        }
                    })

                    await sock.sendMessage(from, {
                        text: texto,
                        mentions
                    })
                }
            }

            // ==============================
            // NIVER RELACIONAMENTO
            // ==============================

            else if (
                comando === `${PREFIXO}niverrelacionamento` &&
                ehGrupo
            ) {
                const chaveGrupo = from
                if (!casamentos[chaveGrupo]) casamentos[chaveGrupo] = {}

                const pegaPar = (v) => Array.isArray(v) ? v : (v?.par || [])
                const casamento = Object.entries(casamentos[chaveGrupo]).find(
                    ([, v]) => pegaPar(v).includes(autor)
                )

                if (!casamento) {
                    await sock.sendMessage(from, {
                        text: '❌ Você não está casado(a).'
                    })
                } else {
                    const [, dadosCasal] = casamento
                    const par = pegaPar(dadosCasal)
                    const outro = par.find(p => p !== autor)
                    const desde = Array.isArray(dadosCasal) ? null : dadosCasal.desde

                    if (!desde) {
                        await sock.sendMessage(from, {
                            text:
                                `💍 está casado(a) com @${outro.split('@')[0]},\n` +
                                `mas a data não foi registrada (casamento antigo).`,
                            mentions: [autor, outro]
                        })
                    } else {
                        const dias = Math.floor((Date.now() - desde) / (24 * 60 * 60 * 1000))
                        await sock.sendMessage(from, {
                            text:
                                `💍 ❤️ @${outro.split('@')[0]}\n\n` +
                                `📅 Juntos há *${dias}* dia(s)!`,
                            mentions: [autor, outro]
                        })
                    }
                }
            }

            // ==============================
            // AÇÕES SOCIAIS (abracar, beijar, etc)
            // ==============================

            else if (
                (
                    comando.startsWith(`${PREFIXO}abracar`) ||
                    comando.startsWith(`${PREFIXO}beijar`) ||
                    comando.startsWith(`${PREFIXO}cafune`) ||
                    comando.startsWith(`${PREFIXO}tapar`) ||
                    comando.startsWith(`${PREFIXO}matar`)
                ) && ehGrupo
            ) {
                const alvo = extrairAlvo(msg)
                const acao = comando.replace(PREFIXO, '').split(/\s+/)[0]

                const textos = {
                    abracar: { emoji: '🤗', frase: 'abraçou' },
                    beijar: { emoji: '😘', frase: 'beijou' },
                    cafune: { emoji: '🤭', frase: 'fez cafuné em' },
                    tapar: { emoji: '👋', frase: 'deu um tapa em' },
                    matar: { emoji: '💀', frase: '"matou"' }
                }

                const info = textos[acao]

                if (!alvo) {
                    await sock.sendMessage(from, {
                        text: `❌ Marque alguém.\nExemplo: ${PREFIXO}${acao} @pessoa`
                    })
                } else if (alvo === autor) {
                    await sock.sendMessage(from, {
                        text: '❌ Em si mesmo? Kkk tenta em outra pessoa.'
                    })
                } else if (!info) {
                    await sock.sendMessage(from, {
                        text: '❌ Ação inválida.'
                    })
                } else {
                    // Conta carinho só nas ações fofas
                    if (['abracar', 'beijar', 'cafune'].includes(acao)) {
                        const chaveAlvo = `${from}_${alvo}`
                        carinhoRecebido[chaveAlvo] = (carinhoRecebido[chaveAlvo] || 0) + 1
                        persistir()
                    }

                    await sock.sendMessage(from, {
                        text:
                            `${info.emoji} ${info.frase} @${alvo.split('@')[0]}!`,
                        mentions: [autor, alvo]
                    })
                }
            }

            // ==============================
            // SEGREDO (privado)
            // ==============================

            else if (
                comando.startsWith(`${PREFIXO}segredo`) &&
                ehGrupo
            ) {
                const alvo = extrairAlvo(msg)
                const partes = texto.trim().split(/\s+/)
                const msgSegredo = partes.slice(1).filter(p => !p.startsWith('@')).join(' ').trim()

                if (!alvo || !msgSegredo) {
                    await sock.sendMessage(from, {
                        text: `❌ Use assim:\n${PREFIXO}segredo @pessoa sua mensagem secreta`
                    })
                } else if (alvo === autor) {
                    await sock.sendMessage(from, {
                        text: '❌ Segredo pra si mesmo? Kkk'
                    })
                } else {
                    try {
                        await sock.sendMessage(alvo, {
                            text:
                                `🔒 *SEGREDO*\n\n` +
                                `Alguém do grupo te mandou um segredo:\n\n` +
                                `"${msgSegredo}"`
                        })
                        await sock.sendMessage(from, {
                            text: `✅ Segredo enviado no privado de @${alvo.split('@')[0]}.`,
                            mentions: [alvo]
                        })
                    } catch {
                        await sock.sendMessage(from, {
                            text: '❌ Não consegui enviar no privado. A pessoa precisa ter conversado com o bot antes.'
                        })
                    }
                }
            }

            // ==============================
            // TOP FOFOS
            // ==============================

            else if (
                comando === `${PREFIXO}topfofos` &&
                ehGrupo
            ) {
                const doGrupo = Object.entries(carinhoRecebido)
                    .filter(([chave]) => chave.startsWith(from))
                    .map(([chave, total]) => ({
                        autor: chave.split('_')[1],
                        total
                    }))
                    .sort((a, b) => b.total - a.total)
                    .slice(0, 5)

                if (doGrupo.length === 0) {
                    await sock.sendMessage(from, {
                        text: 'Ainda ninguém recebeu carinho neste grupo.\nUse !abracar, !beijar ou !cafune!'
                    })
                } else {
                    const medalhas = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣']
                    let texto =
                        `╭────────────────────────────╮\n` +
                        `│ 💕 TOP FOFOS DO GRUPO      │\n` +
                        `╰────────────────────────────╯\n\n`

                    doGrupo.forEach((item, i) => {
                        texto +=
                            `${medalhas[i] || (i + 1) + 'º'} — @${item.autor.split('@')[0]}\n` +
                            `💖 Carinho recebido: ${item.total}\n\n`
                    })

                    await sock.sendMessage(from, {
                        text: texto,
                        mentions: doGrupo.map(i => i.autor)
                    })
                }
            }

            // ==============================
            // PERGUNTAS SOCIAIS
            // ==============================

            else if (
                comando === `${PREFIXO}perguntas` &&
                ehGrupo
            ) {
                const perguntasSociais = [
                    'Quem é a pessoa mais engraçada do grupo?',
                    'Quem seria o melhor presidente do grupo?',
                    'Quem manda mais figurinha por dia?',
                    'Quem é o mais quieto do grupo?',
                    'Quem tem o melhor humor às 3 da manhã?',
                    'Quem seria o primeiro a sobreviver num apocalipse?',
                    'Quem é o mais dramático do grupo?',
                    'Quem tem a risada mais engraçada?',
                    'Quem seria um bom vilão de filme?',
                    'Quem é o mais fofo do grupo?',
                    'Quem nunca responde no grupo?',
                    'Quem deveria ser o admin secreto?',
                    'Quem conta a pior piada?',
                    'Quem é viciado em ficar online?',
                    'Quem seria o melhor amigo pra viajar?'
                ]

                const pergunta = perguntasSociais[
                    Math.floor(Math.random() * perguntasSociais.length)
                ]

                await sock.sendMessage(from, {
                    text:
                        `🗣️ *PERGUNTA DO GRUPO*\n\n` +
                        `${pergunta}\n\n` +
                        `Marquem alguém nos comentários!`
                })
            }

            // ==============================
            // DIARIO (bônus)
            // ==============================

            else if (
                comando === `${PREFIXO}diario`
            ) {
                const chave = chaveUser(from, autor)
                const hoje = new Date().toISOString().slice(0, 10)

                if (ultimoBonus[chave] === hoje) {
                    await sock.sendMessage(from, {
                        text: `❌ você já pegou o bônus de hoje.`,
                    }, { quoted: msg })
                } else {
                    const bonus = Math.floor(Math.random() * 16) + 5 // 5 a 20
                    ultimoBonus[chave] = hoje
                    await adicionarSaldo(from, autor, bonus)
                    persistir()

                    await sock.sendMessage(from, {
                        text:
                            `🎁 pegou o bônus diário!\n` +
                            `💰 +${bonus} dinheiro`,
                    }, { quoted: msg })
                }
            }

            // ==============================
            // APOSTAR
            // ==============================

            else if (
                comando.startsWith(`${PREFIXO}apostar`)
            ) {
                const partes = texto.trim().split(/\s+/)
                const arg = (partes[1] || '').toLowerCase()
                const infinito =
                    autorEhDono ||
                    temDinheiroInfinito(autor) ||
                    temDinheiroInfinito(msg.key.participant) ||
                    temDinheiroInfinito(msg.key.participantPn) ||
                    temDinheiroInfinito(msg.key.participantAlt)
                const saldo = infinito ? Infinity : await lerSaldoUnificado(from, autor)

                let valor = Number(arg.replace(',', '.'))
                let allIn = false

                if (arg === 'tudo' || arg === 'all' || arg === 'allin') {
                    if (infinito) {
                        await sock.sendMessage(from, {
                            text: '❌ Com saldo infinito use um valor, tipo !apostar 1000'
                        })
                        return
                    }
                    valor = saldo
                    allIn = true
                }

                if (isNaN(valor) || valor <= 0) {
                    await sock.sendMessage(from, {
                        text:
                            `❌ Use assim:\n` +
                            `• ${PREFIXO}apostar 10\n` +
                            `• ${PREFIXO}apostar 0,50\n` +
                            `• ${PREFIXO}apostar tudo`
                    })
                } else if (!infinito && saldo < valor) {
                    await sock.sendMessage(from, {
                        text: `❌ Saldo insuficiente. Seu saldo: ${saldo}`
                    })
                } else if (!infinito && saldo === 0) {
                    await sock.sendMessage(from, {
                        text: '❌ Você está sem dinheiro pra apostar.'
                    })
                } else {
                    const ganhou = autorEhDono || infinito ? true : Math.random() < 0.5
                    let saldoFinal = saldo

                    if (ganhou) {
                        if (!infinito) {
                            saldoFinal = await adicionarSaldo(from, autor, valor)
                            persistir()
                        }
                        await sock.sendMessage(from, {
                            text:
                                `🪙 apostou *${allIn ? 'TUDO (' + valor + ')' : valor}* e *GANHOU*!\n` +
                                `💰 +${valor} (Saldo: ${infinito ? '∞' : saldoFinal})`,
                        }, { quoted: msg })
                    } else {
                        if (!infinito) {
                            saldoFinal = await adicionarSaldo(from, autor, -valor)
                            persistir()
                        }
                        await sock.sendMessage(from, {
                            text:
                                `🪙 apostou *${allIn ? 'TUDO (' + valor + ')' : valor}* e *PERDEU*!\n` +
                                `💸 -${valor} (Saldo: ${infinito ? '∞' : saldoFinal})`,
                        }, { quoted: msg })
                    }
                }
            }

            // ==============================
            // INVESTIR
            // ==============================

            else if (
                comando.startsWith(`${PREFIXO}investir`)
            ) {
                const partes = texto.trim().split(/\s+/)
                const valor = Number(String(partes[1] || '').replace(',', '.'))
                const chave = chaveUser(from, autor)
                const infinito =
                    autorEhDono ||
                    temDinheiroInfinito(autor) ||
                    temDinheiroInfinito(msg.key.participant) ||
                    temDinheiroInfinito(msg.key.participantPn) ||
                    temDinheiroInfinito(msg.key.participantAlt)
                const saldo = infinito ? Infinity : await lerSaldoUnificado(from, autor)
                const TEMPO_INVEST_MS = 30 * 60 * 1000 // 30 minutos

                if (investimentos[chave]) {
                    const inv = investimentos[chave]
                    const falta = inv.liberaEm - Date.now()
                    if (falta > 0) {
                        const min = Math.ceil(falta / 60000)
                        await sock.sendMessage(from, {
                            text:
                                `📈 você já tem um investimento ativo de *${inv.valor}*.\n` +
                                `⏳ Pode resgatar em ~${min} minuto(s) com *${PREFIXO}resgatar*`,
                        }, { quoted: msg })
                    } else {
                        await sock.sendMessage(from, {
                            text:
                                `📈 Seu investimento de *${inv.valor}* já pode ser resgatado!\n` +
                                `Use *${PREFIXO}resgatar*`,
                        }, { quoted: msg })
                    }
                } else if (isNaN(valor) || valor < 10) {
                    await sock.sendMessage(from, {
                        text:
                            `❌ Use assim: ${PREFIXO}investir 50\n` +
                            `Mínimo: 10 | Depois de 30 min use ${PREFIXO}resgatar`
                    })
                } else if (!infinito && saldo < valor) {
                    await sock.sendMessage(from, {
                        text: `❌ Saldo insuficiente. Seu saldo: ${saldo}`
                    })
                } else {
                    if (!infinito) {
                        await adicionarSaldo(from, autor, -valor)
                    }
                    investimentos[chave] = {
                        valor,
                        liberaEm: Date.now() + TEMPO_INVEST_MS,
                        notificado: false
                    }
                    persistir()

                    await sock.sendMessage(from, {
                        text:
                            `📈 investiu *${valor}*!\n` +
                            `⏳ Volte em 30 minutos e use *${PREFIXO}resgatar*\n` +
                            `Pode render mais... ou perder uma parte.\n` +
                            `Quando liberar, te aviso no privado!`,
                    }, { quoted: msg })
                }
            }

            // ==============================
            // RESGATAR INVESTIMENTO
            // ==============================

            else if (
                comando === `${PREFIXO}resgatar`
            ) {
                const chave = chaveUser(from, autor)
                const inv = investimentos[chave]

                if (!inv) {
                    await sock.sendMessage(from, {
                        text: `❌ Você não tem investimento ativo.\nUse *${PREFIXO}investir <valor>*`
                    })
                } else if (Date.now() < inv.liberaEm) {
                    const min = Math.ceil((inv.liberaEm - Date.now()) / 60000)
                    await sock.sendMessage(from, {
                        text: `⏳ Ainda faltam ~${min} minuto(s) pra resgatar.`
                    })
                } else {
                    const mult = 0.6 + Math.random() * 1.1
                    const retorno = Math.round(inv.valor * mult * 100) / 100
                    const diferenca = Math.round((retorno - inv.valor) * 100) / 100

                    const saldoFinal = await adicionarSaldo(from, autor, retorno)
                    delete investimentos[chave]
                    persistir()

                    if (diferenca >= 0) {
                        await sock.sendMessage(from, {
                            text:
                                `📈 resgatou o investimento!\n` +
                                `💰 Investiu: ${inv.valor}\n` +
                                `✅ Retorno: *${retorno}* (+${diferenca})\n` +
                                `🏦 Saldo: ${saldoFinal}`,
                        }, { quoted: msg })
                    } else {
                        await sock.sendMessage(from, {
                            text:
                                `📉 resgatou o investimento!\n` +
                                `💰 Investiu: ${inv.valor}\n` +
                                `❌ Retorno: *${retorno}* (${diferenca})\n` +
                                `🏦 Saldo: ${saldoFinal}`,
                        }, { quoted: msg })
                    }
                }
            }

            // ==============================
            // RANK LOJA
            // ==============================

            else if (
                comando === `${PREFIXO}rankloja` &&
                ehGrupo
            ) {
                const doGrupo = Object.entries(gastoLoja)
                    .filter(([chave]) => chave.startsWith(from))
                    .map(([chave, total]) => ({
                        autor: chave.split('_')[1],
                        total
                    }))
                    .sort((a, b) => b.total - a.total)
                    .slice(0, 5)

                if (doGrupo.length === 0) {
                    await sock.sendMessage(from, {
                        text: 'Ainda ninguém gastou na loja deste grupo.'
                    })
                } else {
                    const medalhas = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣']
                    let texto =
                        `╭────────────────────────────╮\n` +
                        `│ 🛍️ RANK GASTOS DA LOJA     │\n` +
                        `╰────────────────────────────╯\n\n`

                    doGrupo.forEach((item, i) => {
                        texto +=
                            `${medalhas[i] || (i + 1) + 'º'} — @${item.autor.split('@')[0]}\n` +
                            `💸 Gastou: ${item.total}\n\n`
                    })

                    await sock.sendMessage(from, {
                        text: texto,
                        mentions: doGrupo.map(i => i.autor)
                    })
                }
            }

            // ==============================
            // GOLPE (roubar)
            // ==============================

            else if (
                comando.startsWith(`${PREFIXO}golpe`) &&
                ehGrupo
            ) {
                const alvo = extrairAlvo(msg)
                const chaveAutor = chaveUser(from, autor)
                const agora = Date.now()
                const COOLDOWN_MS = 5 * 60 * 1000 // 5 minutos

                if (!alvo) {
                    await sock.sendMessage(from, {
                        text: `❌ Marque a pessoa.\nExemplo: ${PREFIXO}golpe @pessoa`
                    })
                } else if (normalizarNumero(alvo) === normalizarNumero(autor)) {
                    await sock.sendMessage(from, {
                        text: '❌ Você não pode roubar a si mesmo.'
                    })
                } else if (temDinheiroInfinito(alvo)) {
                    await sock.sendMessage(from, {
                        text: '🚫 Não dá pra roubar quem tem *dinheiro infinito*.'
                    })
                } else {
                    const alvoEhDono = await ehDono(from, alvo)
                    if (alvoEhDono) {
                        await sock.sendMessage(from, {
                            text: '🚫 Não é possível roubar o *dono do grupo*.'
                        })
                        return
                    }

                    if (cooldownGolpe[chaveAutor] && agora - cooldownGolpe[chaveAutor] < COOLDOWN_MS) {
                        const falta = Math.ceil((COOLDOWN_MS - (agora - cooldownGolpe[chaveAutor])) / 60000)
                        await sock.sendMessage(from, {
                            text: `⏳ Espere mais ${falta} minuto(s) pra tentar outro golpe.`
                        })
                        return
                    }

                    const saldoAlvo = await lerSaldoUnificado(from, alvo)

                    if (saldoAlvo < 5) {
                        await sock.sendMessage(from, {
                            text: '❌ Essa pessoa tem pouco dinheiro pra roubar.'
                        })
                        return
                    }

                    cooldownGolpe[chaveAutor] = agora

                    const sucesso = (autorEhAdmin || autorEhDono) ? true : Math.random() < 0.4
                    const valorRoubado = Math.round(saldoAlvo * (Math.random() * 0.3 + 0.1) * 100) / 100

                    if (sucesso && valorRoubado > 0) {
                        await adicionarSaldo(from, alvo, -valorRoubado)
                        await adicionarSaldo(from, autor, valorRoubado)
                        persistir()

                        await sock.sendMessage(from, {
                            text:
                                `🔫 *GOLPE BEM SUCEDIDO!*\n\n` +
                                `roubou *${valorRoubado}* de @${alvo.split('@')[0]}!`,
                            mentions: [autor, alvo]
                        })
                    } else {
                        const saldoAutor = await lerSaldoUnificado(from, autor)
                        const multa = Math.min(10, saldoAutor)
                        if (multa > 0) {
                            await adicionarSaldo(from, autor, -multa)
                            persistir()
                        }

                        await sock.sendMessage(from, {
                            text:
                                `🚨 *GOLPE FALHOU!*\n\n` +
                                `tentou roubar @${alvo.split('@')[0]} e foi pego!\n` +
                                (multa > 0 ? `💸 Multa: -${multa}` : ''),
                            mentions: [autor, alvo]
                        })
                    }
                }
            }

            // ==============================
            // LEMBRETE
            // ==============================

            else if (
                comando.startsWith(`${PREFIXO}lembrete`)
            ) {
                const partes = texto.trim().split(/\s+/)
                const minutos = Number(partes[1])
                const textoLembrete = partes.slice(2).join(' ').trim()

                if (!Number.isInteger(minutos) || minutos < 1 || minutos > 1440 || !textoLembrete) {
                    await sock.sendMessage(from, {
                        text: `❌ Use assim:\n${PREFIXO}lembrete 10 estudar matemática\n(mínimo 1 min, máximo 24h)`
                    })
                } else {
                    await sock.sendMessage(from, {
                        text:
                            `⏰ lembrete criado!\n` +
                            `Vou te avisar em *${minutos} minuto(s)*:\n` +
                            `"${textoLembrete}"`,
                    }, { quoted: msg })

                    setTimeout(async () => {
                        try {
                            await sock.sendMessage(from, {
                                text:
                                    `🔔 *LEMBRETE*\n\n` +
                                    `\n` +
                                    `"${textoLembrete}"`,
                            }, { quoted: msg })
                        } catch (e) {
                            console.log('Erro ao enviar lembrete:', e.message)
                        }
                    }, minutos * 60 * 1000)
                }
            }

            // ==============================
            // ANUNCIO (admin)
            // ==============================

            else if (
                comando.startsWith(`${PREFIXO}anuncio`) &&
                ehGrupo
            ) {
                if (!autorEhAdmin && !autorEhDono) {
                    await sock.sendMessage(from, {
                        text: '🚫 Só admins ou o dono podem usar esse comando.'
                    })
                } else {
                    const textoAnuncio = texto.trim().slice(PREFIXO.length + 7).trim()

                    if (!textoAnuncio) {
                        await sock.sendMessage(from, {
                            text: `❌ Use assim:\n${PREFIXO}anuncio Texto do anúncio aqui`
                        })
                    } else {
                        await sock.sendMessage(from, {
                            text:
                                `╭──────────────────────────────╮\n` +
                                `│                              │\n` +
                                `│ 📢  ANÚNCIO DO GRUPO  📢     │\n` +
                                `│                              │\n` +
                                `│ ${textoAnuncio}\n` +
                                `│                              │\n` +
                                `│ 📋 Mensagem da moderação     │\n` +
                                `│                              │\n` +
                                `╰──────────────────────────────╯`
                        })
                    }
                }
            }

            // ==============================
            // TITULO
            // ==============================

            else if (
                comando.startsWith(`${PREFIXO}titulo`) &&
                ehGrupo
            ) {
                if (!autorEhAdmin && !autorEhDono) {
                    await sock.sendMessage(from, {
                        text: '🚫 Só admins ou o dono podem dar títulos.'
                    })
                } else {
                    const alvo = extrairAlvo(msg)
                    const partes = texto.trim().split(/\s+/)
                    // Remove o comando e possíveis @menções para pegar o texto do título
                    const tituloTexto = partes.slice(1).filter(p => !p.startsWith('@')).join(' ').trim()

                    if (!alvo || !tituloTexto) {
                        await sock.sendMessage(from, {
                            text: `❌ Use assim:\n${PREFIXO}titulo @pessoa Rei do grupo`
                        })
                    } else {
                        const chave = `${from}_${alvo}`
                        titulos[chave] = tituloTexto
                        persistir()

                        await sock.sendMessage(from, {
                            text:
                                `👑 @${alvo.split('@')[0]} recebeu o título:\n` +
                                `*${tituloTexto}*`,
                            mentions: [alvo]
                        })
                    }
                }
            }

            // ==============================
            // DENUNCIAR
            // ==============================

            else if (
                comando.startsWith(`${PREFIXO}denunciar`) &&
                ehGrupo
            ) {
                const alvo = extrairAlvo(msg)
                const partes = texto.trim().split(/\s+/)
                const motivo = partes.slice(1).filter(p => !p.startsWith('@')).join(' ').trim()

                if (!alvo) {
                    await sock.sendMessage(from, {
                        text: `❌ Marque a pessoa.\nExemplo: ${PREFIXO}denunciar @pessoa motivo`
                    })
                } else {
                    try {
                        const metadata = await sock.groupMetadata(from)
                        const admins = metadata.participants
                            .filter(p => p.admin === 'admin' || p.admin === 'superadmin')
                            .map(p => p.id)

                        if (admins.length === 0) {
                            await sock.sendMessage(from, {
                                text: '❌ Não há admins neste grupo.'
                            })
                        } else {
                            const textoDenuncia =
                                `🚨 *DENÚNCIA*\n\n` +
                                `👤 Denunciante:\n` +
                                `👤 Denunciado: @${alvo.split('@')[0]}\n` +
                                `📝 Motivo: ${motivo || 'Não informado'}\n\n` +
                                `⚠️ Admins, analisem o ocorrido.`

                            await sock.sendMessage(from, {
                                text: textoDenuncia,
                                mentions: [autor, alvo, ...admins]
                            })
                        }
                    } catch (e) {
                        await sock.sendMessage(from, {
                            text: '❌ Não consegui acionar os admins.'
                        })
                    }
                }
            }

            // ==============================
            // LETRA DA MÚSICA
            // ==============================

            else if (
                comando.startsWith(`${PREFIXO}letra`)
            ) {
                const nomeMusica = texto.trim().slice(PREFIXO.length + 5).trim()

                if (!nomeMusica) {
                    await sock.sendMessage(from, {
                        text: `❌ Use assim:\n${PREFIXO}letra nome da música`
                    })
                } else {
                    await sock.sendMessage(from, {
                        text: `🔎 buscando letra de *${nomeMusica}*...`,
                    }, { quoted: msg })

                    try {
                        // Tenta separar artista e música se tiver " - "
                        let artista = ''
                        let titulo = nomeMusica

                        if (nomeMusica.includes(' - ')) {
                            const partes = nomeMusica.split(' - ')
                            artista = partes[0].trim()
                            titulo = partes.slice(1).join(' - ').trim()
                        } else if (nomeMusica.includes(' by ')) {
                            const partes = nomeMusica.split(' by ')
                            titulo = partes[0].trim()
                            artista = partes.slice(1).join(' by ').trim()
                        }

                        const url = artista
                            ? `https://api.lyrics.ovh/v1/${encodeURIComponent(artista)}/${encodeURIComponent(titulo)}`
                            : `https://api.lyrics.ovh/v1/${encodeURIComponent(nomeMusica)}/${encodeURIComponent(nomeMusica)}`

                        const resposta = await fetch(url)
                        const dados = await resposta.json()

                        if (dados.lyrics) {
                            let letra = dados.lyrics.trim()
                            // WhatsApp tem limite de mensagem, corta se for muito grande
                            if (letra.length > 3500) {
                                letra = letra.slice(0, 3500) + '\n\n... (letra cortada)'
                            }

                            await sock.sendMessage(from, {
                                text:
                                    `🎵 *Letra de ${nomeMusica}*\n\n` +
                                    letra
                            })
                        } else {
                            await sock.sendMessage(from, {
                                text:
                                    `❌ Não achei a letra de *${nomeMusica}*.\n` +
                                    `Tenta no formato: artista - nome da música`
                            })
                        }
                    } catch (e) {
                        console.log('Erro ao buscar letra:', e.message)
                        await sock.sendMessage(from, {
                            text: '❌ Erro ao buscar a letra. Tenta de novo mais tarde.'
                        })
                    }
                }
            }

            // ==============================
            // IA — TEXTO (Pollinations, sem API key)
            // ==============================

            else if (
                comando.startsWith(`${PREFIXO}perguntar`) ||
                comando.startsWith(`${PREFIXO}pergunte`)
            ) {
                const pergunta = texto.trim()
                    .replace(new RegExp(`^\\${PREFIXO}(perguntar|pergunte)\\s*`, 'i'), '')
                    .trim()

                if (!pergunta) {
                    await sock.sendMessage(from, {
                        text: `❌ Use assim:\n${PREFIXO}perguntar qual a capital do Brasil?`
                    })
                } else {
                    await sock.sendMessage(from, {
                        text: `🤖 Pensando...`,
                    }, { quoted: msg })
                    try {
                        const resp = await gerarTextoIA(
                            'Você é um assistente útil e objetivo no WhatsApp.',
                            pergunta,
                            1200
                        )
                        await sock.sendMessage(from, {
                            __fonteIA: true,
                            text: `🤖\n\n${resp}`,
                        }, { quoted: msg })
                    } catch (e) {
                        console.log('Erro !perguntar:', e.message)
                        await sock.sendMessage(from, {
                            text: '❌ A IA não respondeu agora. Tenta de novo em instantes.'
                        })
                    }
                }
            }

            else if (comando.startsWith(`${PREFIXO}explicar`)) {
                const assunto = texto.trim()
                    .replace(new RegExp(`^\\${PREFIXO}explicar\\s*`, 'i'), '')
                    .trim()

                if (!assunto) {
                    await sock.sendMessage(from, {
                        text: `❌ Use assim:\n${PREFIXO}explicar buracos negros`
                    })
                } else {
                    await sock.sendMessage(from, { text: '🧠 Explicando...' })
                    try {
                        const resp = await gerarTextoIA(
                            'Explique o assunto de forma simples, como se fosse para um leigo. Use analogias curtas se ajudar. Máximo 2 parágrafos.',
                            assunto,
                            1000
                        )
                        await sock.sendMessage(from, {
                            __fonteIA: true,
                            text: `🧠 *Explicação pra*\n\n${resp}`,
                        }, { quoted: msg })
                    } catch (e) {
                        console.log('Erro !explicar:', e.message)
                        await sock.sendMessage(from, {
                            text: '❌ Não consegui explicar agora. Tenta de novo.'
                        })
                    }
                }
            }

            else if (
                comando.startsWith(`${PREFIXO}historia`) ||
                comando.startsWith(`${PREFIXO}história`)
            ) {
                const tema = texto.trim()
                    .replace(new RegExp(`^\\${PREFIXO}hist[oó]ria\\s*`, 'i'), '')
                    .trim() || 'uma aventura surpresa'

                await sock.sendMessage(from, { text: '📖 Escrevendo história...' })
                try {
                    const resp = await gerarTextoIA(
                        'Escreva uma história curta e envolvente (5 a 12 frases) em português. Tenha começo, meio e fim. Tom leve, adequado para WhatsApp.',
                        tema,
                        1400
                    )
                    await sock.sendMessage(from, {
                        __fonteIA: true,
                        text: `📖 *História* — pedido de\n\n${resp}`,
                    }, { quoted: msg })
                } catch (e) {
                    console.log('Erro !historia:', e.message)
                    await sock.sendMessage(from, {
                        text: '❌ Não consegui escrever a história agora.'
                    })
                }
            }

            else if (comando.startsWith(`${PREFIXO}piada`)) {
                const tema = texto.trim()
                    .replace(new RegExp(`^\\${PREFIXO}piada\\s*`, 'i'), '')
                    .trim() || 'qualquer tema leve'

                await sock.sendMessage(from, { text: '😂 Preparando piada...' })
                try {
                    const resp = await gerarTextoIA(
                        'Conte UMA piada curta e engraçada em português brasileiro. Sem introdução longa, só a piada (e a resposta se for de pergunta). Evite conteúdo ofensivo pesado.',
                        tema,
                        500
                    )
                    await sock.sendMessage(from, {
                        __fonteIA: true,
                        text: `😂\n\n${resp}`,
                    }, { quoted: msg })
                } catch (e) {
                    console.log('Erro !piada:', e.message)
                    await sock.sendMessage(from, {
                        text: '❌ A piada falhou... tenta de novo.'
                    })
                }
            }

            else if (comando.startsWith(`${PREFIXO}conselho`)) {
                const tema = texto.trim()
                    .replace(new RegExp(`^\\${PREFIXO}conselho\\s*`, 'i'), '')
                    .trim() || 'um conselho do dia'

                await sock.sendMessage(from, { text: '💡 Pensando num conselho...' })
                try {
                    const resp = await gerarTextoIA(
                        'Dê um conselho curto, útil e com um toque de humor leve em português. 2 a 5 frases no máximo.',
                        tema,
                        600
                    )
                    await sock.sendMessage(from, {
                        __fonteIA: true,
                        text: `💡 *Conselho pra*\n\n${resp}`,
                    }, { quoted: msg })
                } catch (e) {
                    console.log('Erro !conselho:', e.message)
                    await sock.sendMessage(from, {
                        text: '❌ Sem conselhos no momento. Tenta de novo.'
                    })
                }
            }

            else if (comando.startsWith(`${PREFIXO}corrigir`)) {
                let textoCorrigir = texto.trim()
                    .replace(new RegExp(`^\\${PREFIXO}corrigir\\s*`, 'i'), '')
                    .trim()

                // Se não passou texto, tenta mensagem citada
                if (!textoCorrigir) {
                    const citado =
                        msg.message?.extendedTextMessage?.contextInfo?.quotedMessage
                    textoCorrigir =
                        citado?.conversation ||
                        citado?.extendedTextMessage?.text ||
                        ''
                }

                if (!textoCorrigir) {
                    await sock.sendMessage(from, {
                        text:
                            `❌ Use assim:\n` +
                            `${PREFIXO}corrigir eu foi na escola ontem\n` +
                            `Ou responda uma mensagem com ${PREFIXO}corrigir`
                    })
                } else {
                    await sock.sendMessage(from, { text: '✏️ Corrigindo...' })
                    try {
                        const resp = await gerarTextoIA(
                            'Corrija o português do texto. Responda só com: 1) a versão corrigida 2) uma linha breve dizendo o que mudou. Não invente conteúdo novo.',
                            textoCorrigir,
                            900
                        )
                        await sock.sendMessage(from, {
                            __fonteIA: true,
                            text: `✏️\n\n${resp}`,
                        }, { quoted: msg })
                    } catch (e) {
                        console.log('Erro !corrigir:', e.message)
                        await sock.sendMessage(from, {
                            text: '❌ Não consegui corrigir agora.'
                        })
                    }
                }
            }

            else if (comando.startsWith(`${PREFIXO}traduzir`)) {
                let textoTrad = texto.trim()
                    .replace(new RegExp(`^\\${PREFIXO}traduzir\\s*`, 'i'), '')
                    .trim()

                if (!textoTrad) {
                    const citado =
                        msg.message?.extendedTextMessage?.contextInfo?.quotedMessage
                    textoTrad =
                        citado?.conversation ||
                        citado?.extendedTextMessage?.text ||
                        ''
                }

                if (!textoTrad) {
                    await sock.sendMessage(from, {
                        text:
                            `❌ Use assim:\n` +
                            `${PREFIXO}traduzir Hello, how are you?\n` +
                            `Ou responda uma mensagem com ${PREFIXO}traduzir`
                    })
                } else {
                    await sock.sendMessage(from, { text: '🌐 Traduzindo...' })
                    try {
                        const deEn = pareceIngles(textoTrad)
                        const langpair = deEn ? 'en|pt' : 'pt|en'
                        const url =
                            `https://api.mymemory.translated.net/get?q=${encodeURIComponent(textoTrad.slice(0, 500))}` +
                            `&langpair=${langpair}`

                        const resp = await fetch(url)
                        const dados = await resp.json()
                        const traduzido =
                            dados?.responseData?.translatedText ||
                            null

                        if (!traduzido) {
                            throw new Error('sem tradução')
                        }

                        const direcao = deEn ? 'EN → PT' : 'PT → EN'
                        await sock.sendMessage(from, {
                            __fonteIA: true,
                            text:
                                `🌐 *Tradução* (${direcao})\n` +
                                `👤\n\n` +
                                `📝 Original:\n${textoTrad.slice(0, 400)}\n\n` +
                                `✅ Traduzido:\n${traduzido}`,
                        }, { quoted: msg })
                    } catch (e) {
                        console.log('Erro !traduzir:', e.message)
                        await sock.sendMessage(from, {
                            text: '❌ Não consegui traduzir agora. Tenta de novo.'
                        })
                    }
                }
            }

            else if (comando.startsWith(`${PREFIXO}voz`)) {
                const textoVoz = texto.trim()
                    .replace(new RegExp(`^\\${PREFIXO}voz\\s*`, 'i'), '')
                    .trim()

                if (!textoVoz || textoVoz.length < 2) {
                    await sock.sendMessage(from, {
                        text: `❌ Use assim:\n${PREFIXO}voz olá, tudo bem com você?`
                    })
                } else if (textoVoz.length > 300) {
                    await sock.sendMessage(from, {
                        text: '❌ Texto muito longo pro áudio. Máximo 300 caracteres.'
                    })
                } else {
                    await sock.sendMessage(from, {
                        text: `🔊 Gerando áudio...`,
                    }, { quoted: msg })
                    try {
                        // Pollinations TTS gratuito
                        const url =
                            `https://text.pollinations.ai/${encodeURIComponent(textoVoz)}` +
                            `?model=openai-audio&voice=nova`

                        const controller = new AbortController()
                        const timeout = setTimeout(() => controller.abort(), 60000)

                        const resp = await fetch(url, {
                            signal: controller.signal,
                            headers: {
                                'User-Agent': 'Mozilla/5.0 (WhatsAppBot)',
                                'Accept': 'audio/*,*/*'
                            }
                        })
                        clearTimeout(timeout)

                        if (!resp.ok) {
                            throw new Error(`HTTP ${resp.status}`)
                        }

                        const contentType = (resp.headers.get('content-type') || '').toLowerCase()
                        const audioBuf = Buffer.from(await resp.arrayBuffer())

                        if (audioBuf.length < 500 || contentType.includes('text/')) {
                            throw new Error('áudio inválido')
                        }

                        await sock.sendMessage(from, {
                            audio: audioBuf,
                            mimetype: 'audio/mpeg',
                            ptt: true // envia como figurinha de voz
                        })
                    } catch (e) {
                        console.log('Erro !voz:', e.message)
                        await sock.sendMessage(from, {
                            text: '❌ Não consegui gerar o áudio agora. Tenta de novo.'
                        })
                    }
                }
            }

            // ==============================
            // CRIAR IMAGEM (IA - estilo Perchance/Pollinations)
            // ==============================

            else if (
                comando.startsWith(`${PREFIXO}criarimg`) ||
                comando.startsWith(`${PREFIXO}imagem`) ||
                comando.startsWith(`${PREFIXO}gerarimg`)
            ) {
                const promptImg = texto.trim()
                    .replace(new RegExp(`^\\${PREFIXO}(criarimg|imagem|gerarimg)\\s*`, 'i'), '')
                    .trim()

                if (!promptImg || promptImg.length < 2) {
                    await sock.sendMessage(from, {
                        text:
                            `❌ Use assim:\n` +
                            `${PREFIXO}criarimg um gato astronauta no espaço\n\n` +
                            `Descreva a imagem que você quer gerar.`
                    })
                } else if (promptImg.length > 400) {
                    await sock.sendMessage(from, {
                        text: '❌ Descrição muito longa. Máximo 400 caracteres.'
                    })
                } else {
                    await sock.sendMessage(from, {
                        text:
                            `🎨 gerando imagem...\n` +
                            `📝 *${promptImg}*\n\n` +
                            `⏳ Aguarde alguns segundos.`,
                    }, { quoted: msg })

                    try {
                        // Melhora o prompt pra qualidade maior e menos blur
                        const promptMelhorado =
                            `${promptImg}, highly detailed, sharp focus, best quality, 8k resolution, professional photography, crisp details, no blur, no watermark, no text overlay`

                        const seed = Math.floor(Math.random() * 999999999)
                        const params = new URLSearchParams({
                            width: '1280',
                            height: '1280',
                            model: 'flux',
                            nologo: 'true',
                            private: 'true',
                            enhance: 'true',
                            safe: 'false',
                            seed: String(seed)
                        })

                        // Tenta endpoint principal e fallback
                        const urls = [
                            `https://image.pollinations.ai/prompt/${encodeURIComponent(promptMelhorado)}?${params.toString()}`,
                            `https://gen.pollinations.ai/image/${encodeURIComponent(promptMelhorado)}?${params.toString()}`
                        ]

                        let buffer = null
                        let ultimoErro = null

                        for (const url of urls) {
                            try {
                                const controller = new AbortController()
                                const timeout = setTimeout(() => controller.abort(), 100000)

                                const resp = await fetch(url, {
                                    signal: controller.signal,
                                    headers: {
                                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                                        'Accept': 'image/*,*/*'
                                    }
                                })
                                clearTimeout(timeout)

                                if (!resp.ok) {
                                    ultimoErro = `HTTP ${resp.status}`
                                    continue
                                }

                                const contentType = (resp.headers.get('content-type') || '').toLowerCase()
                                const buf = Buffer.from(await resp.arrayBuffer())

                                if (buf.length < 2000) {
                                    ultimoErro = 'imagem muito pequena'
                                    continue
                                }

                                // Se veio HTML/erro em vez de imagem, pula
                                if (
                                    contentType.includes('text/html') ||
                                    contentType.includes('application/json')
                                ) {
                                    ultimoErro = 'resposta inválida'
                                    continue
                                }

                                buffer = buf
                                break
                            } catch (errUrl) {
                                ultimoErro = errUrl.message
                            }
                        }

                        if (!buffer) {
                            throw new Error(ultimoErro || 'falha ao gerar')
                        }

                        // Corta marca d'água com ffmpeg (já usado no !tocar)
                        try {
                            const path = require('path')
                            const os = require('os')
                            const { execSync } = require('child_process')
                            const tempDir = os.tmpdir()
                            const idTmp = `img_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
                            const entrada = path.join(tempDir, `${idTmp}_in.jpg`)
                            const saida = path.join(tempDir, `${idTmp}_out.jpg`)

                            fs.writeFileSync(entrada, buffer)

                            // Corta 10% de baixo + 2% das laterais (logo do Pollinations)
                            execSync(
                                `ffmpeg -y -i "${entrada}" -vf "crop=iw*0.96:ih*0.88:iw*0.02:0" -q:v 2 "${saida}"`,
                                { timeout: 30000, stdio: 'ignore' }
                            )

                            if (fs.existsSync(saida)) {
                                const cortado = fs.readFileSync(saida)
                                if (cortado.length > 1000) {
                                    buffer = cortado
                                }
                            }

                            try { fs.unlinkSync(entrada) } catch {}
                            try { fs.unlinkSync(saida) } catch {}
                        } catch (cropErr) {
                            console.log('Aviso crop watermark:', cropErr.message)
                        }

                        await sock.sendMessage(from, {
                            __fonteIA: true,
                            image: buffer,
                            caption:
                                `✨ *Imagem criada*\n\n` +
                                `📝 *Descrição do prompt:*\n` +
                                `${promptImg}`,
                        }, { quoted: msg })
                    } catch (e) {
                        console.log('Erro !criarimg:', e.message)
                        await sock.sendMessage(from, {
                            text:
                                `❌ Não consegui gerar a imagem agora.\n` +
                                `Tenta de novo em alguns segundos ou muda a descrição.`
                        })
                    }
                }
            }

            // ==============================
            // TOCAR MÚSICA
            // ==============================

            else if (
                comando.startsWith(
                    `${PREFIXO}tocar`
                )
            ) {
                const nomeMusica =
                    texto.trim().slice(
                        PREFIXO.length + 5
                    ).trim()

                if (!nomeMusica) {
                    await sock.sendMessage(
                        from,
                        {
                            text:
                                `❌ Use assim:\n` +
                                `${PREFIXO}tocar nome da música\n` +
                                `${PREFIXO}tocar artista - música\n` +
                                `${PREFIXO}tocar https://youtube.com/...\n` +
                                `${PREFIXO}tocar https://soundcloud.com/...\n\n` +
                                `Depois escolha: *audio*, *video* ou *ambos*`
                        }
                    )
                } else {
                    const chavePedido = `${from}_${autor}`
                    pedidosMusica[chavePedido] = {
                        nomeMusica,
                        criadoEm: Date.now()
                    }

                    // Limpa pedido antigo automaticamente após 2 min
                    setTimeout(() => {
                        if (
                            pedidosMusica[chavePedido] &&
                            Date.now() - pedidosMusica[chavePedido].criadoEm >= 120000
                        ) {
                            delete pedidosMusica[chavePedido]
                        }
                    }, 125000)

                    await sock.sendMessage(from, {
                        text:
                            `🎵 *${nomeMusica}*\n\n` +
                            `Qual mídia você quer receber?\n\n` +
                            `1️⃣ *audio* — só o áudio (MP3)\n` +
                            `2️⃣ *video* — vídeo com a música\n` +
                            `3️⃣ *ambos* — áudio + vídeo\n\n` +
                            `Responda com: *audio*, *video* ou *ambos*\n` +
                            `(⏳ Expira em 2 minutos)`,
                    }, { quoted: msg })
                }
            }

            // ==============================
            // RESET SAVE
            // ==============================

            else if (
                comando === `${PREFIXO}reset save`
            ) {
                if (!ehGrupo) {
                    await sock.sendMessage(
                        from,
                        {
                            text:
                                '❌ Esse comando só funciona em grupos.'
                        }
                    )
                } else if (!autorEhAdmin) {
                    await sock.sendMessage(
                        from,
                        {
                            text:
                                '🚫 Só admins podem usar esse comando.'
                        }
                    )
                } else {
                    for (const chave of Object.keys(contadorMensagens)) delete contadorMensagens[chave]
                    for (const chave of Object.keys(avisos)) delete avisos[chave]
                    for (const chave of Object.keys(niveis)) delete niveis[chave]
                    for (const chave of Object.keys(pontosTrivia)) delete pontosTrivia[chave]
                    for (const chave of Object.keys(saldoBanco)) delete saldoBanco[chave]
                    for (const chave of Object.keys(ultimoDiario)) delete ultimoDiario[chave]
                    for (const chave of Object.keys(inventarios)) delete inventarios[chave]

                    persistir()

                    await sock.sendMessage(
                        from,
                        {
                            text:
                                `♻️ *DADOS RESETADOS!*\n\n` +
                                `Todo o save (saldo, inventário, níveis, mensagens e advertências) foi zerado.`
                        }
                    )
                }
            }

            // ==============================
            // RESET DINHEIRO
            // ==============================

            else if (
                comando.startsWith(
                    `${PREFIXO}resetdinheiro`
                )
            ) {
                if (!ehGrupo) {
                    await sock.sendMessage(
                        from,
                        {
                            text:
                                '❌ Esse comando só funciona em grupos.'
                        }
                    )
                } else if (!autorEhDono) {
                    await sock.sendMessage(
                        from,
                        {
                            text:
                                '🚫 Somente o *dono do grupo* pode usar esse comando.'
                        }
                    )
                } else {
                    const partes =
                        texto.trim().split(/\s+/)

                    const arg =
                        partes[1]?.toLowerCase()

                    const alvo =
                        extrairAlvo(msg)

                    if (arg === 'todos') {
                        let quantos = 0
                        for (const chave of Object.keys(saldoBanco)) {
                            if (chave.startsWith(from + '_')) {
                                delete saldoBanco[chave]
                                quantos++
                            }
                        }
                        persistir()
                        await sock.sendMessage(from, {
                            text:
                                `💸 *DINHEIRO ZERADO!*\n\n` +
                                `O saldo deste grupo foi zerado (${quantos} registros).`
                        })
                    } else if (alvo) {
                        const ids = [...await coletarIdsMembro(from, alvo)]
                        setSaldoSync(from, alvo, 0, ids)
                        persistir()

                        await sock.sendMessage(from, {
                            text:
                                `💸 *DINHEIRO ZERADO!*\n\n` +
                                `O saldo de @${alvo.split('@')[0]} foi zerado neste grupo.`,
                            mentions: [alvo]
                        })
                    } else {
                        await sock.sendMessage(
                            from,
                            {
                                text:
                                    `❌ Use assim:\n\n` +
                                    `• ${PREFIXO}resetdinheiro todos\n` +
                                    `• ${PREFIXO}resetdinheiro @pessoa`
                            }
                        )
                    }
                }
            }

            // ==============================
            // FIGURINHA
            // ==============================

            else if (
                comando === `${PREFIXO}fig`
            ) {
                const contexto =
                    msg.message?.extendedTextMessage?.contextInfo

                const mensagemCitada =
                    contexto?.quotedMessage

                const midiaAlvo =
                    mensagemCitada?.imageMessage
                        ? { tipo: 'image', msg: mensagemCitada }
                        : mensagemCitada?.videoMessage
                            ? { tipo: 'video', msg: mensagemCitada }
                            : msg.message?.imageMessage
                                ? { tipo: 'image', msg: msg.message }
                                : msg.message?.videoMessage
                                    ? { tipo: 'video', msg: msg.message }
                                    : null

                if (!midiaAlvo) {
                    await sock.sendMessage(
                        from,
                        {
                            text:
                                `❌ Responda (ou envie junto) uma imagem ou vídeo curto com ${PREFIXO}fig pra virar figurinha.`
                        }
                    )
                } else {
                    try {
                        const { downloadMediaMessage } =
                            await import('@whiskeysockets/baileys')

                        const { Sticker, StickerTypes } =
                            await import('wa-sticker-formatter')

                        const mensagemFake = {
                            key: msg.key,
                            message: midiaAlvo.msg
                        }

                        const buffer =
                            await baixarMidiaMsg(downloadMediaMessage, mensagemFake)

                        let nomeGrupo = 'privado'
                        if (ehGrupo) {
                            try {
                                const metadata = await sock.groupMetadata(from)
                                nomeGrupo = metadata.subject || 'grupo'
                            } catch {
                                nomeGrupo = 'grupo'
                            }
                        }

                        const figurinha = new Sticker(buffer, {
                            pack: 'Criada por doodle bot',
                            author: `No grupo: ${nomeGrupo}`,
                            type: StickerTypes.FULL,
                            quality: 70
                        })

                        const bufferFigurinha =
                            await figurinha.toBuffer()

                        await sock.sendMessage(
                            from,
                            {
                                sticker: bufferFigurinha
                            }
                        )
                    } catch (err) {
                        console.log(
                            'Erro ao criar figurinha:',
                            err.message
                        )

                        const faltaLib =
                            err.message.includes('Cannot find') ||
                            err.message.includes('wa-sticker-formatter')

                        await sock.sendMessage(
                            from,
                            {
                                text:
                                    faltaLib
                                        ? '❌ Falta instalar uma dependência no servidor do bot (wa-sticker-formatter/ffmpeg).'
                                        : '❌ Não consegui transformar essa mídia em figurinha. Tente com uma imagem ou vídeo curto.'
                            }
                        )
                    }
                }
            }

            // ==============================
            // FIGURINHA → IMAGEM
            // ==============================

            else if (
                comando === `${PREFIXO}img`
            ) {
                const contexto =
                    msg.message?.extendedTextMessage?.contextInfo

                const mensagemCitada =
                    contexto?.quotedMessage

                const stickerMsg =
                    mensagemCitada?.stickerMessage
                        ? mensagemCitada
                        : msg.message?.stickerMessage
                            ? msg.message
                            : null

                if (!stickerMsg) {
                    await sock.sendMessage(
                        from,
                        {
                            text:
                                `❌ Responda uma figurinha com ${PREFIXO}img pra transformar em imagem.`
                        }
                    )
                } else {
                    try {
                        const { downloadMediaMessage } =
                            await import('@whiskeysockets/baileys')

                        const mensagemFake = {
                            key: msg.key,
                            message: stickerMsg
                        }

                        const buffer =
                            await baixarMidiaMsg(downloadMediaMessage, mensagemFake)

                        await sock.sendMessage(
                            from,
                            {
                                image: buffer,
                                caption: `🖼️ Figurinha convertida em imagem\n`,
                            }, { quoted: msg }
                        )
                    } catch (err) {
                        console.log(
                            'Erro ao converter figurinha:',
                            err.message
                        )

                        await sock.sendMessage(
                            from,
                            {
                                text:
                                    '❌ Não consegui converter essa figurinha em imagem.'
                            }
                        )
                    }
                }
            }

            // ==============================
            // REVELAR (view once → normal)
            // ==============================

            else if (
                comando === `${PREFIXO}revelar`
            ) {
                const contexto =
                    msg.message?.extendedTextMessage?.contextInfo

                const mensagemCitada =
                    contexto?.quotedMessage

                if (!mensagemCitada) {
                    await sock.sendMessage(
                        from,
                        {
                            text:
                                `❌ Responda uma mídia de *visualização única* com ${PREFIXO}revelar.`
                        }
                    )
                } else {
                    // Desembrulha viewOnce / viewOnceV2 / ephemeral
                    let midiaMsg = mensagemCitada

                    if (mensagemCitada.viewOnceMessage?.message) {
                        midiaMsg = mensagemCitada.viewOnceMessage.message
                    } else if (mensagemCitada.viewOnceMessageV2?.message) {
                        midiaMsg = mensagemCitada.viewOnceMessageV2.message
                    } else if (mensagemCitada.ephemeralMessage?.message) {
                        midiaMsg = mensagemCitada.ephemeralMessage.message
                    }

                    const isImage = !!midiaMsg.imageMessage
                    const isVideo = !!midiaMsg.videoMessage

                    if (!isImage && !isVideo) {
                        await sock.sendMessage(
                            from,
                            {
                                text:
                                    `❌ Essa mensagem não parece ser uma imagem ou vídeo de visualização única.`
                            }
                        )
                    } else {
                        try {
                            const { downloadMediaMessage } =
                                await import('@whiskeysockets/baileys')

                            const mensagemFake = {
                                key: msg.key,
                                message: midiaMsg
                            }

                            const buffer =
                                await baixarMidiaMsg(downloadMediaMessage, mensagemFake)

                            if (isImage) {
                                await sock.sendMessage(
                                    from,
                                    {
                                        image: buffer,
                                        caption:
                                            `👁️ Mídia de visualização única revelada\n`,
                                    }, { quoted: msg }
                                )
                            } else {
                                await sock.sendMessage(
                                    from,
                                    {
                                        video: buffer,
                                        caption:
                                            `👁️ Mídia de visualização única revelada\n`,
                                    }, { quoted: msg }
                                )
                            }
                        } catch (err) {
                            console.log(
                                'Erro ao revelar mídia:',
                                err.message
                            )

                            await sock.sendMessage(
                                from,
                                {
                                    text:
                                        '❌ Não consegui revelar essa mídia. Ela pode ter expirado ou o bot não tem permissão.'
                                }
                            )
                        }
                    }
                }
            }

            // ==============================
            // BANIR
            // ==============================

            else if (
                comando === `${PREFIXO}banir` &&
                ehGrupo
            ) {
                if (!autorEhAdmin) {
                    await sock.sendMessage(
                        from,
                        {
                            text:
                                '🚫 Só admins podem usar esse comando.'
                        }
                    )
                } else {
                    const alvo =
                        extrairAlvo(msg)

                    if (!alvo) {
                        await sock.sendMessage(
                            from,
                            {
                                text:
                                    `Marque ou responda alguém: ${PREFIXO}banir`
                            }
                        )
                    } else {
                        try {
                            await sock.groupParticipantsUpdate(
                                from,
                                [alvo],
                                'remove'
                            )

                            await sock.sendMessage(
                                from,
                                {
                                    text:
                                        `╭──────────────────────────────╮\n` +
                                        `│                              │\n` +
                                        `│ 🔨  USUÁRIO REMOVIDO!  🔨    │\n` +
                                        `│                              │\n` +
                                        `│ 👤 @${alvo.split('@')[0]}\n` +
                                        `│                              │\n` +
                                        `│ ⚖️ Foi removido(a) com       │\n` +
                                        `│ sucesso por motivos justos  │\n` +
                                        `│                              │\n` +
                                        `│ 📋 Ação da moderação         │\n` +
                                        `│                              │\n` +
                                        `╰──────────────────────────────╯`,
                                    mentions: [alvo]
                                }
                            )
                        } catch {
                            await sock.sendMessage(
                                from,
                                {
                                    text:
                                        '❌ Não consegui remover. Confere se sou admin.'
                                }
                            )
                        }
                    }
                }
            }

            // ==============================
            // AVISAR
            // ==============================

            else if (
                comando === `${PREFIXO}avisar` &&
                ehGrupo
            ) {
                if (!autorEhAdmin) {
                    await sock.sendMessage(
                        from,
                        {
                            text:
                                '🚫 Só admins podem usar esse comando.'
                        }
                    )
                } else {
                    const alvo =
                        extrairAlvo(msg)

                    if (!alvo) {
                        await sock.sendMessage(
                            from,
                            {
                                text:
                                    `Marque ou responda alguém: ${PREFIXO}avisar`
                            }
                        )
                    } else {
                        // Proteção: não pode advertir o dono do grupo nem o próprio bot
                        const botJid =
                            sock.user?.id?.split(':')[0] +
                            '@s.whatsapp.net'

                        const alvoEhDono =
                            await ehDono(from, alvo)

                        const alvoEhBot =
                            alvo === botJid ||
                            alvo === sock.user?.id

                        if (alvoEhDono || alvoEhBot) {
                            await sock.sendMessage(
                                from,
                                {
                                    text:
                                        '🚫 Não é permitido dar advertência no dono do grupo ou no bot.'
                                }
                            )
                            return
                        }

                        const chaveAviso =
                            `${from}_${alvo}`

                        avisos[chaveAviso] =
                            (avisos[chaveAviso] || 0) +
                            1

                        if (
                            avisos[chaveAviso] >=
                            LIMITE_AVISOS
                        ) {
                            try {
                                await sock.groupParticipantsUpdate(
                                    from,
                                    [alvo],
                                    'remove'
                                )

                                await sock.sendMessage(
                                    from,
                                    {
                                        text:
                                            `╭──────────────────────────────╮\n` +
                                            `│                              │\n` +
                                            `│ 🔨  USUÁRIO REMOVIDO!  🔨    │\n` +
                                            `│                              │\n` +
                                            `│ 👤 @${alvo.split('@')[0]}\n` +
                                            `│                              │\n` +
                                            `│ ⚖️ Foi removido(a) com       │\n` +
                                            `│ sucesso por motivos justos  │\n` +
                                            `│                              │\n` +
                                            `│ 📋 Ação da moderação         │\n` +
                                            `│                              │\n` +
                                            `╰──────────────────────────────╯`,
                                        mentions: [alvo]
                                    }
                                )
                            } catch {
                                await sock.sendMessage(
                                    from,
                                    {
                                        text:
                                            '❌ Não consegui remover.'
                                    }
                                )
                            }

                            delete avisos[
                                chaveAviso
                            ]
                        } else {
                            await sock.sendMessage(
                                from,
                                {
                                    text:
                                        `⚠️ @${alvo.split('@')[0]} recebeu uma advertência ` +
                                        `(${avisos[chaveAviso]}/${LIMITE_AVISOS}).`,
                                    mentions: [alvo]
                                }
                            )

                            await enviarGifUrl(from, GIF_ADVERTENCIA)
                        }

                        persistir()
                    }
                }
            }

            // ==============================
            // MUTAR
            // ==============================

            else if (
                comando === `${PREFIXO}mutar` &&
                ehGrupo
            ) {
                if (!autorEhAdmin) {
                    await sock.sendMessage(
                        from,
                        {
                            text:
                                '🚫 Só admins podem usar esse comando.'
                        }
                    )
                } else {
                    try {
                        await sock.groupSettingUpdate(
                            from,
                            'announcement'
                        )

                        await sock.sendMessage(
                            from,
                            {
                                text:
                                    '🔇 Grupo mutado. Só admins podem enviar mensagens.'
                            }
                        )

                        await enviarGifUrl(from, GIF_MUTAR)
                    } catch {
                        await sock.sendMessage(
                            from,
                            {
                                text:
                                    '❌ Não consegui mutar o grupo.'
                            }
                        )
                    }
                }
            }

            // ==============================
            // DESMUTAR
            // ==============================

            else if (
                comando === `${PREFIXO}desmutar` &&
                ehGrupo
            ) {
                if (!autorEhAdmin) {
                    await sock.sendMessage(
                        from,
                        {
                            text:
                                '🚫 Só admins podem usar esse comando.'
                        }
                    )
                } else {
                    try {
                        await sock.groupSettingUpdate(
                            from,
                            'not_announcement'
                        )

                        await sock.sendMessage(
                            from,
                            {
                                text:
                                    '🔊 Grupo liberado!'
                            }
                        )
                    } catch {
                        await sock.sendMessage(
                            from,
                            {
                                text:
                                    '❌ Não consegui desmutar.'
                            }
                        )
                    }
                }
            }

            // ==============================
            // TODOS
            // ==============================

            else if (
                comando.startsWith(
                    `${PREFIXO}todos`
                ) &&
                ehGrupo
            ) {
                if (!autorEhAdmin) {
                    await sock.sendMessage(
                        from,
                        {
                            text:
                                '🚫 Só admins podem usar esse comando.'
                        }
                    )
                } else {
                    const mensagemExtra =
                        texto.trim().slice(
                            PREFIXO.length + 5
                        ).trim()

                    const metadata =
                        await sock.groupMetadata(
                            from
                        )

                    const todosIds =
                        metadata.participants.map(
                            p => p.id
                        )

                    const textoFinal =
                        mensagemExtra
                            ? `📢 *Aviso geral:*\n${mensagemExtra}`
                            : `📢 *Atenção, pessoal!*`

                    await sock.sendMessage(
                        from,
                        {
                            text: textoFinal,
                            mentions: todosIds
                        }
                    )
                }
            }

            // ==============================
            // ENQUETE
            // ==============================

            else if (
                comando.startsWith(
                    `${PREFIXO}enquete`
                ) &&
                ehGrupo
            ) {
                const conteudo =
                    texto.trim().slice(
                        PREFIXO.length + 8
                    ).trim()

                const partes =
                    conteudo
                        .split('|')
                        .map(
                            p => p.trim()
                        )
                        .filter(Boolean)

                if (partes.length < 3) {
                    await sock.sendMessage(
                        from,
                        {
                            text:
                                `Use assim:\n${PREFIXO}enquete Pergunta|Opção 1|Opção 2`
                        }
                    )
                } else {
                    const [
                        pergunta,
                        ...opcoes
                    ] = partes

                    let textoEnquete =
                        `📊 *${pergunta}*\n\n`

                    opcoes.forEach(
                        (opcao, i) => {
                            textoEnquete +=
                                `${i + 1}️⃣ ${opcao}\n`
                        }
                    )

                    await sock.sendMessage(
                        from,
                        {
                            text:
                                textoEnquete
                        }
                    )
                }
            }

            // ==============================
            // SET ENTRADA / SAÍDA
            // ==============================
            else if (
                (comando.startsWith(`${PREFIXO}setentrada`) ||
                    comando.startsWith(`${PREFIXO}setsaida`)) &&
                ehGrupo
            ) {
                if (!autorEhAdmin && !autorEhDono) {
                    await sock.sendMessage(from, { text: '🚫 Só admins podem usar.' })
                } else {
                    const isEntrada = comando.startsWith(`${PREFIXO}setentrada`)
                    const conteudo = texto.trim().replace(
                        new RegExp(`^\\${PREFIXO}set(entrada|saida)\\s*`, 'i'),
                        ''
                    ).trim()
                    if (!conteudo) {
                        await sock.sendMessage(from, {
                            text:
                                `❌ Use assim:\n` +
                                `${PREFIXO}setentrada Bem-vindo @{user} ao {grupo}!\n` +
                                `${PREFIXO}setsaida @{user} saiu do grupo.\n\n` +
                                `Placeholders: @{user} ou {user} · {grupo}`
                        })
                    } else {
                        if (isEntrada) msgsEntrada[from] = conteudo
                        else msgsSaida[from] = conteudo
                        persistir()
                        await sock.sendMessage(from, {
                            text: isEntrada
                                ? '✅ Mensagem de *entrada* atualizada.'
                                : '✅ Mensagem de *saída* atualizada.'
                        })
                    }
                }
            }

            // ==============================
            // ATIVAR / DESATIVAR MÓDULOS
            // ==============================
            else if (
                (comando.startsWith(`${PREFIXO}ativar`) ||
                    comando.startsWith(`${PREFIXO}desativar`)) &&
                ehGrupo
            ) {
                if (!autorEhAdmin && !autorEhDono) {
                    await sock.sendMessage(from, { text: '🚫 Só admins podem usar.' })
                } else {
                    const ligar = comando.startsWith(`${PREFIXO}ativar`)
                    const mod = texto.trim().split(/\s+/)[1]?.toLowerCase()
                    if (!mod || !MODULOS_BOT.includes(mod)) {
                        await sock.sendMessage(from, {
                            text:
                                `❌ Módulo inválido.\n` +
                                `Disponíveis: ${MODULOS_BOT.join(', ')}\n` +
                                `Ex: ${PREFIXO}desativar jogos`
                        })
                    } else {
                        if (!funcoesDesativadas[from]) funcoesDesativadas[from] = {}
                        if (ligar) delete funcoesDesativadas[from][mod]
                        else funcoesDesativadas[from][mod] = true
                        persistir()
                        await sock.sendMessage(from, {
                            text: ligar
                                ? `✅ Módulo *${mod}* ativado.`
                                : `⏸️ Módulo *${mod}* desativado.`
                        })
                    }
                }
            }

            else if (
                (comando === `${PREFIXO}funçõesdesativadas` ||
                    comando === `${PREFIXO}funcoesdesativadas`) &&
                ehGrupo
            ) {
                const mapa = funcoesDesativadas[from] || {}
                const lista = Object.keys(mapa).filter(k => mapa[k])
                await sock.sendMessage(from, {
                    text: lista.length
                        ? `⏸️ *Funções desativadas neste grupo:*\n• ${lista.join('\n• ')}`
                        : '✅ Nenhuma função desativada neste grupo.'
                })
            }

            // ==============================
            // PROTEÇÕES ON/OFF
            // ==============================
            else if (
                ehGrupo &&
                /^(antilink|antistatus|antibotao|anticall|antipayment)\b/i.test(
                    comando.slice(PREFIXO.length)
                )
            ) {
                if (!autorEhAdmin && !autorEhDono) {
                    await sock.sendMessage(from, { text: '🚫 Só admins podem usar.' })
                } else {
                    const partes = texto.trim().split(/\s+/)
                    const nomeProt = partes[0].slice(PREFIXO.length).toLowerCase()
                    const estado = (partes[1] || '').toLowerCase()
                    if (estado !== 'on' && estado !== 'off') {
                        await sock.sendMessage(from, {
                            text: `❌ Use: ${PREFIXO}${nomeProt} on  ou  ${PREFIXO}${nomeProt} off`
                        })
                    } else {
                        if (!protecoes[from]) protecoes[from] = {}
                        protecoes[from][nomeProt] = estado === 'on'
                        persistir()
                        await sock.sendMessage(from, {
                            text:
                                estado === 'on'
                                    ? `🛡️ *${nomeProt}* ativado.`
                                    : `🔓 *${nomeProt}* desativado.`
                        })
                    }
                }
            }

            // ==============================
            // ABRIR / FECHAR GRUPO AGENDADO
            // ==============================
            else if (
                (comando.startsWith(`${PREFIXO}abrirgrupo`) ||
                    comando.startsWith(`${PREFIXO}fechargrupo`)) &&
                ehGrupo
            ) {
                if (!autorEhAdmin && !autorEhDono) {
                    await sock.sendMessage(from, { text: '🚫 Só admins podem usar.' })
                } else {
                    const abrir = comando.startsWith(`${PREFIXO}abrirgrupo`)
                    const horaStr = texto.trim().split(/\s+/)[1] || ''
                    if (!/^\d{1,2}:\d{2}$/.test(horaStr)) {
                        await sock.sendMessage(from, {
                            text:
                                `❌ Use: ${PREFIXO}${abrir ? 'abrirgrupo' : 'fechargrupo'} HH:MM\n` +
                                `Ex: ${PREFIXO}fechargrupo 22:00`
                        })
                    } else {
                        if (!agendasGrupo[from]) agendasGrupo[from] = {}
                        if (abrir) agendasGrupo[from].abrir = horaStr
                        else agendasGrupo[from].fechar = horaStr
                        persistir()
                        await sock.sendMessage(from, {
                            text:
                                `⏰ Grupo será *${abrir ? 'aberto' : 'fechado'}* todo dia às *${horaStr}*.\n` +
                                `(Horário do servidor do bot)`
                        })
                    }
                }
            }

            // ==============================
            // ANÚNCIO AUTOMÁTICO POR TEMPO
            // ==============================
            else if (
                comando.startsWith(`${PREFIXO}anuncioauto`) &&
                ehGrupo
            ) {
                if (!autorEhAdmin && !autorEhDono) {
                    await sock.sendMessage(from, { text: '🚫 Só admins podem usar.' })
                } else {
                    const partes = texto.trim().split(/\s+/)
                    const min = Number(partes[1])
                    const msgAuto = partes.slice(2).join(' ').trim()
                    if (!Number.isInteger(min) || min < 1 || min > 1440 || !msgAuto) {
                        await sock.sendMessage(from, {
                            text:
                                `❌ Use: ${PREFIXO}anuncioauto <minutos> <mensagem>\n` +
                                `Ex: ${PREFIXO}anuncioauto 60 Recado do grupo!\n` +
                                `Para parar: ${PREFIXO}paranuncio`
                        })
                    } else {
                        anunciosAuto[from] = {
                            texto: msgAuto,
                            intervaloMin: min,
                            proximo: Date.now() + min * 60000
                        }
                        persistir()
                        await sock.sendMessage(from, {
                            text: `📢 Anúncio automático a cada *${min} min* ativado.`
                        })
                    }
                }
            }

            else if (comando === `${PREFIXO}paranuncio` && ehGrupo) {
                if (!autorEhAdmin && !autorEhDono) {
                    await sock.sendMessage(from, { text: '🚫 Só admins podem usar.' })
                } else {
                    delete anunciosAuto[from]
                    persistir()
                    await sock.sendMessage(from, { text: '🛑 Anúncio automático parado.' })
                }
            }

            // ==============================
            // INSTRUÇÕES ADMIN (PV)
            // ==============================
            else if (
                comando === `${PREFIXO}instruções_admin` ||
                comando === `${PREFIXO}instrucoes_admin`
            ) {
                if (ehGrupo && !autorEhAdmin && !autorEhDono) {
                    await sock.sendMessage(from, { text: '🚫 Só admins podem usar.' })
                } else {
                    const guia =
                        `╭──────────────────────────────╮\n` +
                        `│  🛡️  𝑰𝒏𝒔𝒕𝒓𝒖𝒄̧𝒐̃𝒆𝒔 𝑨𝒅𝒎𝒊𝒏     │\n` +
                        `╰──────────────────────────────╯\n\n` +
                        `*Moderação*\n` +
                        `• ${PREFIXO}banir @pessoa\n` +
                        `• ${PREFIXO}avisar @pessoa\n` +
                        `• ${PREFIXO}mutar / ${PREFIXO}desmutar\n` +
                        `• ${PREFIXO}todos <msg> · ${PREFIXO}enquete\n\n` +
                        `*Mensagens*\n` +
                        `• ${PREFIXO}setentrada <texto>\n` +
                        `• ${PREFIXO}setsaida <texto>\n` +
                        `  Placeholders: @{user} {grupo}\n\n` +
                        `*Agenda*\n` +
                        `• ${PREFIXO}abrirgrupo HH:MM\n` +
                        `• ${PREFIXO}fechargrupo HH:MM\n` +
                        `• ${PREFIXO}anuncioauto <min> <texto>\n` +
                        `• ${PREFIXO}paranuncio\n\n` +
                        `*Módulos*\n` +
                        `• ${PREFIXO}ativar / ${PREFIXO}desativar <módulo>\n` +
                        `  Módulos: ${MODULOS_BOT.join(', ')}\n` +
                        `• ${PREFIXO}funçõesdesativadas\n\n` +
                        `*Proteções*\n` +
                        `• ${PREFIXO}antilink on/off\n` +
                        `• ${PREFIXO}antistatus on/off\n` +
                        `• ${PREFIXO}antibotao on/off\n` +
                        `• ${PREFIXO}anticall on/off\n` +
                        `• ${PREFIXO}antipayment on/off\n\n` +
                        `*Dono global*\n` +
                        `• ${PREFIXO}on / ${PREFIXO}off — liga o bot no grupo`

                    try {
                        await sock.sendMessage(autor, { text: guia })
                        if (ehGrupo) {
                            await sock.sendMessage(from, {
                                text: `📩 @${autor.split('@')[0]} enviei as instruções no seu privado.`,
                                mentions: [autor]
                            })
                        }
                    } catch {
                        await sock.sendMessage(from, {
                            text: '❌ Não consegui abrir seu PV. Me chama no privado e use o comando de novo.'
                        })
                    }
                }
            }

            // ==============================
            // BAIXAR POR LINK (YT / TikTok / IG)
            // ==============================
            else if (comando.startsWith(`${PREFIXO}baixar`)) {
                if (moduloDesativado(from, 'downloads') || moduloDesativado(from, 'midia')) {
                    await sock.sendMessage(from, { text: '⏸️ Downloads estão desativados neste grupo.' })
                } else {
                    const link = texto.trim().split(/\s+/)[1] || ''
                    if (!/^https?:\/\//i.test(link)) {
                        await sock.sendMessage(from, {
                            text:
                                `❌ Use: ${PREFIXO}baixar <link>\n` +
                                `Suporta YouTube, TikTok, Instagram e outros (via yt-dlp).`
                        })
                    } else {
                        await sock.sendMessage(from, {
                            text: '📥 Baixando mídia do link, aguarde...',
                        }, { quoted: msg })
                        try {
                            const { exec } = require('child_process')
                            const { promisify } = require('util')
                            const execAsync = promisify(exec)
                            const os = require('os')
                            const path = require('path')
                            const tempDir = os.tmpdir()
                            const id = `dl_${Date.now()}`
                            const outTpl = path.join(tempDir, `${id}.%(ext)s`)

                            // Preferência: vídeo/audio sem watermark quando o site permitir
                            const cmd =
                                `yt-dlp --no-playlist --no-warnings ` +
                                `-f "bv*+ba/b" --merge-output-format mp4 ` +
                                `--max-filesize 50M -o "${outTpl}" "${limparShell(link)}"`

                            await execAsync(cmd, { timeout: 180000, maxBuffer: 20 * 1024 * 1024 })

                            const arquivos = fs.readdirSync(tempDir).filter(f => f.startsWith(id))
                            if (arquivos.length === 0) throw new Error('arquivo não encontrado')

                            const arquivo = path.join(tempDir, arquivos[0])
                            const buffer = fs.readFileSync(arquivo)
                            const ext = path.extname(arquivo).toLowerCase()

                            if (['.mp3', '.m4a', '.opus', '.ogg'].includes(ext)) {
                                await sock.sendMessage(from, {
                                    audio: buffer,
                                    mimetype: 'audio/mpeg'
                                }, { quoted: msg })
                            } else {
                                await sock.sendMessage(from, {
                                    video: buffer,
                                    caption: '📥 Mídia baixada'
                                }, { quoted: msg })
                            }

                            try { fs.unlinkSync(arquivo) } catch {}
                        } catch (e) {
                            console.log('Erro !baixar:', e.message)
                            await sock.sendMessage(from, {
                                text: '❌ Não consegui baixar esse link. Verifique o link ou tente outro.'
                            })
                        }
                    }
                }
            }

            // ==============================
            // CONVERSA COM A IA
            // ==============================
            // No grupo: só responde quando alguém dá reply numa mensagem do bot.
            // No privado: conversa direto, sem precisar de reply nem menção.
            // Trava por chat (iaEmAndamento) evita respostas empilhadas/atropeladas
            // quando o mesmo chat manda várias mensagens rápido, mas não afeta
            // outros grupos — cada chat tem sua própria chave e roda em paralelo.

            else if (
                (ehGrupo ? citouOBot : true) &&
                !iaEmAndamento[from] &&
                !moduloDesativado(from, 'ia')
            ) {
                iaEmAndamento[from] = true

                sock.sendPresenceUpdate('composing', from).catch(() => {})

                try {
                    const resp = await gerarRespostaChatRapido(
                        texto.trim()
                    )

                    await sock.sendMessage(
                        from,
                        { __fonteIA: true, text: resp },
                        { quoted: msg }
                    )
                } catch (e) {
                    console.log('Erro na IA de conversa (respondendo em silêncio):', e.message)
                    // Não manda nada pro chat — só loga aqui pra debug.
                } finally {
                    delete iaEmAndamento[from]
                    sock.sendPresenceUpdate('paused', from).catch(() => {})
                }
            }
        })
    )
}

process.on(
    'uncaughtException',
    (err) => {
        console.log(
            '⚠️ Erro não tratado:',
            err.message
        )
    }
)

process.on(
    'unhandledRejection',
    (err) => {
        console.log(
            '⚠️ Promise rejeitada:',
            err?.message || err
        )
    }
)

iniciar()
