'use strict'

/**
 * doodlebot-web.js — ponte entre o site do Doodle Bot e o doodlebot-index.js
 *
 * Como funciona:
 *  - O site manda cada mensagem pra cá (POST /api/enviar).
 *  - A gente transforma ela numa mensagem "falsa" de WhatsApp (chat privado) e entrega
 *    pro MESMO handler do bot. Ou seja: todo comando roda o código real do doodlebot-index.js.
 *  - Quando o bot responde (sock.sendMessage) pra um número do site, a resposta
 *    é desviada pro navegador via SSE (/api/eventos) em vez de ir pro WhatsApp.
 *
 * Não precisa instalar nada: só usa módulos nativos do Node.
 */

const http = require('http')
const fs = require('fs')
const os = require('os')
const path = require('path')
const crypto = require('crypto')

// ==============================
// CONFIG
// ==============================

const PORTA = Number(process.env.WEB_PORT || process.env.PORT || 3000)
const PASTA_PUBLICA = path.join(__dirname, 'public')

const SUFIXO = '@web.doodle'
// Número virtual dos usuários do site: 999 + 9 dígitos (o DDI 999 não existe,
// então nunca bate com número real de WhatsApp)
const REGEX_JID_WEB = /^999\d{9}(@web\.doodle)?$/
const REGEX_TOKEN = /^[a-f0-9]{32}$/

const LIMITE_MSGS_POR_MIN_SESSAO = 25
const LIMITE_MSGS_POR_MIN_IP = 90
const LIMITE_UPLOADS_POR_MIN_SESSAO = 10
const MAX_UPLOAD_BYTES = 16 * 1024 * 1024
const MAX_MIDIA_TOTAL_BYTES = 160 * 1024 * 1024
const MAX_EVENTOS_GUARDADOS = 150
const MAX_PESADOS_SIMULTANEOS = 2
const MAX_CLIENTES_POR_SESSAO = 4
const SESSAO_OCIOSA_MS = 12 * 60 * 60 * 1000

const BOOT = crypto.randomBytes(4).toString('hex')

const config = {
    numeroBot: '',
    numerosReservados: []
}

// ==============================
// ESTADO
// ==============================

let handlerMensagens = null
let servidor = null

const sessoes = new Map()      // numero -> sessão
const midias = new Map()       // id -> { id, numero, tipo, mime, buf, umaVez }
let midiasBytes = 0
const limitePorIp = new Map()  // ip -> [timestamps]

let pesadosAtivos = 0
const filaPesados = []

// ==============================
// UTILITÁRIOS
// ==============================

function ehJidWeb(jid) {
    return typeof jid === 'string' && REGEX_JID_WEB.test(jid)
}

function rand(bytes = 8) {
    return crypto.randomBytes(bytes).toString('hex')
}

function ultimos8(n) {
    return String(n).replace(/\D/g, '').slice(-8)
}

// O bot compara números pelos últimos 8 dígitos (dinheiro infinito). A gente
// nunca gera um número virtual que bata com os reservados (dono / dinheiro infinito).
function numeroReservado(numero) {
    return config.numerosReservados.some(r => ultimos8(r) === ultimos8(numero))
}

function numeroDoToken(token) {
    for (let i = 0; i < 50; i++) {
        const h = crypto.createHash('sha256').update(`${token}:${i}`).digest()
        const n = String(h.readUIntBE(0, 6) % 1000000000).padStart(9, '0')
        const numero = `999${n}`
        if (!numeroReservado(numero)) return numero
    }
    return `999${rand(4).replace(/\D/g, '0').padEnd(9, '0').slice(0, 9)}`
}

function limparNome(nome) {
    return String(nome || '')
        .replace(/[\u0000-\u001f\u007f*_~`]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 24)
}

function farejarMime(buf, padrao) {
    if (buf.length > 12) {
        if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e) return 'image/png'
        if (buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg'
        if (buf.slice(0, 3).toString('latin1') === 'GIF') return 'image/gif'
        if (
            buf.slice(0, 4).toString('latin1') === 'RIFF' &&
            buf.slice(8, 12).toString('latin1') === 'WEBP'
        ) return 'image/webp'
        if (buf.slice(4, 8).toString('latin1') === 'ftyp') return 'video/mp4'
        if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return 'video/webm'
        if (buf.slice(0, 3).toString('latin1') === 'ID3') return 'audio/mpeg'
        if (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0) return 'audio/mpeg'
        if (buf.slice(0, 4).toString('latin1') === 'OggS') return 'audio/ogg'
    }
    return padrao
}

function dentroDoLimite(lista, max) {
    const agora = Date.now()
    while (lista.length && agora - lista[0] > 60000) lista.shift()
    if (lista.length >= max) return false
    lista.push(agora)
    return true
}

function ipDe(req) {
    const h = req.headers
    return String(
        h['cf-connecting-ip'] ||
        (h['x-forwarded-for'] || '').split(',')[0].trim() ||
        req.socket.remoteAddress ||
        '?'
    )
}

// ==============================
// SESSÕES
// ==============================

function obterSessao(numero) {
    let s = sessoes.get(numero)

    if (!s) {
        if (sessoes.size >= 3000) limparSessoes(true)

        s = {
            numero,
            jid: `${numero}${SUFIXO}`,
            nome: 'Você',
            seq: 0,
            eventos: [],
            clientes: new Set(),
            midias: new Set(),
            janelaMsgs: [],
            janelaUploads: [],
            pesado: false,
            aguardandoMidia: false,
            uso: Date.now()
        }
        sessoes.set(numero, s)
    }

    s.uso = Date.now()
    return s
}

function sessaoDoToken(token) {
    if (typeof token !== 'string' || !REGEX_TOKEN.test(token)) return null
    return obterSessao(numeroDoToken(token))
}

function apagarMidia(id) {
    const m = midias.get(id)
    if (!m) return
    midiasBytes -= m.buf.length
    midias.delete(id)
    sessoes.get(m.numero)?.midias.delete(id)
}

function limparSessoes(forcar = false) {
    const agora = Date.now()

    for (const [numero, s] of sessoes) {
        const ociosa = agora - s.uso > SESSAO_OCIOSA_MS
        if ((ociosa || forcar) && s.clientes.size === 0) {
            for (const id of [...s.midias]) apagarMidia(id)
            sessoes.delete(numero)
            if (forcar && sessoes.size < 2500) break
        }
    }

    for (const [ip, lista] of limitePorIp) {
        while (lista.length && agora - lista[0] > 60000) lista.shift()
        if (!lista.length) limitePorIp.delete(ip)
    }
}

// ==============================
// MÍDIAS
// ==============================

function guardarMidia(s, { tipo, mime, buf, umaVez = false }) {
    const id = rand(12)
    midias.set(id, { id, numero: s.numero, tipo, mime, buf, umaVez })
    midiasBytes += buf.length
    s.midias.add(id)

    while (midiasBytes > MAX_MIDIA_TOTAL_BYTES && midias.size > 1) {
        const maisAntigo = midias.keys().next().value
        if (maisAntigo === id) break
        apagarMidia(maisAntigo)
    }

    return id
}

// ==============================
// EVENTOS (servidor -> navegador)
// ==============================

function emitir(s, ev, { guardar = true } = {}) {
    ev.t = ev.t || Date.now()

    let dados = ''
    if (guardar) {
        ev.seq = ++s.seq
        s.eventos.push(ev)
        if (s.eventos.length > MAX_EVENTOS_GUARDADOS) s.eventos.shift()
        dados = `id: ${ev.seq}\n`
    }
    dados += `data: ${JSON.stringify(ev)}\n\n`

    for (const res of s.clientes) {
        try { res.write(dados) } catch { }
    }
}

function emitirTextoBot(s, texto, citadoId = null) {
    emitir(s, {
        de: 'bot',
        id: `B${rand(6)}`,
        tipo: 'texto',
        texto,
        citadoId
    })
}

// O código original do bot manda algumas frases sem o nome de quem falou
// (ex.: "🆙 está no nível 3"). No site a gente completa com o nome da pessoa.
function nomear(s, texto) {
    if (!texto) return texto
    const nome = s.nome || 'Você'

    return texto
        .replace(/^👤[ \t]*$/gm, () => `👤 ${nome}`)
        .replace(
            /^(\S+) (está no nível|subiu pro nível|recebeu a mesada|pegou o bônus|apostou|investiu|resgatou o investimento|tirou:)/gm,
            (_, emoji, resto) => `${emoji} *${nome}* ${resto}`
        )
        .replace(/investido no grupo: \*[^*\n]*\*/g, 'investido')
        .replace(/ no grupo para receber/g, ' para receber')
}

// Tudo que o bot manda pra um número do site passa por aqui
async function enviarParaWeb(jid, c, opcoes) {
    const s = obterSessao(jid.split('@')[0])
    c = c || {}

    if (c.delete || c.react || c.poll || c.forward) {
        return { key: { id: rand(6), remoteJid: jid, fromMe: true } }
    }

    s.respostasDesdeDigitar = (s.respostasDesdeDigitar || 0) + 1

    const id = `B${rand(6)}`
    const base = {
        de: 'bot',
        id,
        citadoId: opcoes?.quoted?.key?.id || null,
        ia: !!c.__fonteIA
    }

    const pegarArquivo = (campo) => {
        const v = c[campo]
        if (!v) return null
        if (Buffer.isBuffer(v)) return { buf: v }
        if (v.url && /^https?:\/\//i.test(String(v.url))) return { url: String(v.url) }
        return null
    }

    const legenda = nomear(s, typeof c.caption === 'string' ? c.caption : '')

    const registrar = (tipoMidia, arq, mimePadrao, extra = {}) => {
        if (arq.url) {
            emitir(s, { ...base, tipo: tipoMidia, texto: legenda, url: arq.url, ...extra })
            return
        }
        const mime = farejarMime(arq.buf, c.mimetype || mimePadrao)
        const mid = guardarMidia(s, { tipo: tipoMidia, mime, buf: arq.buf })
        emitir(s, { ...base, tipo: tipoMidia, texto: legenda, url: `/m/${mid}`, mid, mime, ...extra })
    }

    let arq
    if ((arq = pegarArquivo('image'))) {
        registrar('imagem', arq, 'image/jpeg')
    } else if ((arq = pegarArquivo('video'))) {
        registrar(c.gifPlayback ? 'gif' : 'video', arq, 'video/mp4')
    } else if ((arq = pegarArquivo('audio'))) {
        registrar(c.ptt ? 'voz' : 'audio', arq, 'audio/mpeg')
    } else if ((arq = pegarArquivo('sticker'))) {
        registrar('figurinha', arq, 'image/webp')
    } else if ((arq = pegarArquivo('document'))) {
        registrar('documento', arq, 'application/octet-stream', { nome: String(c.fileName || 'arquivo') })
    } else {
        const texto = nomear(
            s,
            typeof c.text === 'string' ? c.text : (c.caption || c.title || '')
        )
        if (texto) emitir(s, { ...base, tipo: 'texto', texto })
    }

    return { key: { id, remoteJid: jid, fromMe: true }, message: c }
}

function presencaWeb(jid, estado) {
    const s = obterSessao(jid.split('@')[0])
    const digitando = estado === 'composing' || estado === 'recording'

    if (digitando) {
        s.digitando = true
        s.respostasDesdeDigitar = 0
    } else if (s.digitando) {
        s.digitando = false
        // O bot fica em silêncio quando a IA falha. No site a gente avisa.
        if (!s.respostasDesdeDigitar) {
            emitirTextoBot(s, '😵 A IA não conseguiu responder agora. Tenta de novo em instantes.')
        }
    }

    emitir(s, { tipo: 'digitando', ativo: digitando }, { guardar: false })
}

// ==============================
// ENTREGA PRO BOT
// ==============================

function montarCitado(s, c) {
    if (!c || typeof c !== 'object') return null

    const m = typeof c.mid === 'string' ? midias.get(c.mid) : null
    const midia = m && m.numero === s.numero ? m : null
    const participant = c.deBot
        ? `${config.numeroBot || '0'}@s.whatsapp.net`
        : s.jid

    let quotedMessage

    if (midia) {
        const conteudo = {
            mimetype: midia.mime,
            caption: String(c.texto || '').slice(0, 500),
            __webBuffer: midia.buf
        }

        const embrulho =
            midia.tipo === 'figurinha' ? { stickerMessage: conteudo } :
            midia.tipo === 'video' || midia.tipo === 'gif' ? { videoMessage: conteudo } :
            midia.tipo === 'audio' || midia.tipo === 'voz' ? { audioMessage: conteudo } :
            { imageMessage: conteudo }

        quotedMessage = midia.umaVez
            ? { viewOnceMessageV2: { message: embrulho } }
            : embrulho
    } else {
        quotedMessage = { conversation: String(c.texto || '').slice(0, 1500) }
    }

    return {
        stanzaId: String(c.id || '').slice(0, 40),
        participant,
        quotedMessage
    }
}

function montarMensagem(s, id, texto, citado) {
    const key = { remoteJid: s.jid, fromMe: false, id }
    const ctx = montarCitado(s, citado)

    const message = ctx
        ? { extendedTextMessage: { text: texto, contextInfo: ctx } }
        : { conversation: texto }

    return {
        key,
        message,
        pushName: s.nome,
        messageTimestamp: Math.floor(Date.now() / 1000)
    }
}

// Comandos que só existem em grupo do WhatsApp (precisam de membros, admin, marcação...)
const GRUPO_APENAS = [
    'ranking', 'rankingbanco', 'rankloja', 'casal', 'roleta', 'trivia', 'bandeira', 'forca',
    'topcasal', 'topfofos', 'perguntas', 'niverrelacionamento', 'divorciar', 'casar', 'cupido',
    'abracar', 'beijar', 'cafune', 'tapar', 'matar', 'segredo', 'banir', 'avisar', 'mutar',
    'desmutar', 'todos', 'enquete', 'titulo', 'denunciar', 'setentrada', 'setsaida',
    'abrirgrupo', 'fechargrupo', 'anuncioauto', 'paranuncio', 'ativar', 'desativar',
    'funcoesdesativadas', 'funçõesdesativadas', 'antilink', 'antistatus', 'antibotao',
    'anticall', 'antipayment', 'resetdinheiro', 'setnivel', 'grupo', 'on', 'off', 'ligar',
    'desligar', 'pix', 'doar', 'reset'
]
const REGEX_GRUPO_APENAS = new RegExp(`^!(${GRUPO_APENAS.join('|')})(\\s|$)`, 'i')

const REGEX_PESADO = /^!(tocar|baixar|criarimg|imagem|gerarimg|voz)\b/i
const REGEX_ESCOLHA_MIDIA = /^(audio|áudio|video|vídeo|ambos|os dois|tudo|1|2|3)$/i

function ehPesado(s, texto) {
    const t = texto.trim()
    if (REGEX_PESADO.test(t)) return true
    return s.aguardandoMidia && REGEX_ESCOLHA_MIDIA.test(t)
}

function rodarNaFila(fn) {
    return new Promise((resolve) => {
        const rodar = async () => {
            pesadosAtivos++
            try { await fn() } finally {
                pesadosAtivos--
                const proximo = filaPesados.shift()
                if (proximo) proximo()
                resolve()
            }
        }

        if (pesadosAtivos < MAX_PESADOS_SIMULTANEOS) rodar()
        else filaPesados.push(rodar)
    })
}

async function executar(s, msg) {
    if (!handlerMensagens) {
        emitirTextoBot(s, '⏳ O bot ainda está ligando. Tenta de novo em alguns segundos.', msg.key.id)
        return
    }

    try {
        await handlerMensagens({ messages: [msg], type: 'notify' })
    } catch (e) {
        console.log('[WEB] Erro ao processar mensagem:', e?.message || e)
        emitirTextoBot(s, '❌ Deu erro aqui do meu lado. Tenta de novo.', msg.key.id)
    }
}

function despachar(s, msg, texto) {
    const pesado = ehPesado(s, texto)
    s.aguardandoMidia = /^!tocar\s+\S/i.test(texto.trim())

    if (!pesado) {
        executar(s, msg)
        return
    }

    if (s.pesado) {
        emitirTextoBot(s, '⏳ Ainda estou processando o seu pedido anterior. Espera ele terminar.', msg.key.id)
        return
    }

    s.pesado = true

    if (pesadosAtivos >= MAX_PESADOS_SIMULTANEOS) {
        emitirTextoBot(s, '⏳ Tem bastante gente pedindo mídia agora. Você está na fila, já já sai.', msg.key.id)
    }

    rodarNaFila(() => executar(s, msg)).finally(() => { s.pesado = false })
}

// ==============================
// HTTP
// ==============================

const TIPOS = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.webmanifest': 'application/manifest+json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon',
    '.woff2': 'font/woff2',
    '.txt': 'text/plain; charset=utf-8'
}

function cabecalhosBase(extra = {}) {
    return {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
        ...extra
    }
}

function responderJSON(res, status, obj) {
    const corpo = JSON.stringify(obj)
    res.writeHead(status, cabecalhosBase({
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store'
    }))
    res.end(corpo)
}

function lerCorpo(req, limite) {
    return new Promise((resolve, reject) => {
        const partes = []
        let total = 0

        req.on('data', (c) => {
            total += c.length
            if (total > limite) {
                reject(Object.assign(new Error('grande demais'), { status: 413 }))
                req.destroy()
                return
            }
            partes.push(c)
        })
        req.on('end', () => resolve(Buffer.concat(partes)))
        req.on('error', reject)
    })
}

async function rotaEnviar(req, res) {
    let corpo
    try {
        corpo = JSON.parse((await lerCorpo(req, 40000)).toString('utf8') || '{}')
    } catch (e) {
        return responderJSON(res, e.status || 400, { erro: 'corpo inválido' })
    }

    const s = sessaoDoToken(corpo.s)
    if (!s) return responderJSON(res, 401, { erro: 'sessão inválida' })

    const ip = ipDe(req)
    if (!limitePorIp.has(ip)) limitePorIp.set(ip, [])

    if (
        !dentroDoLimite(s.janelaMsgs, LIMITE_MSGS_POR_MIN_SESSAO) ||
        !dentroDoLimite(limitePorIp.get(ip), LIMITE_MSGS_POR_MIN_IP)
    ) {
        return responderJSON(res, 429, { erro: 'calma, muitas mensagens em pouco tempo' })
    }

    const nome = limparNome(corpo.nome)
    if (nome) s.nome = nome

    const texto = String(corpo.texto || '').replace(/\u0000/g, '').trim().slice(0, 1500)
    if (!texto) return responderJSON(res, 400, { erro: 'mensagem vazia' })

    const id = /^W[a-f0-9]{16}$/.test(corpo.id) ? corpo.id : `W${rand(8)}`
    const msg = montarMensagem(s, id, texto, corpo.citado)

    responderJSON(res, 200, { ok: true, id, bot: !!handlerMensagens })

    const grupo = REGEX_GRUPO_APENAS.exec(texto)
    if (grupo) {
        emitirTextoBot(
            s,
            `🔒 O comando *!${grupo[1].toLowerCase()}* só funciona em grupos do WhatsApp.\n` +
            `Aqui no site vale tudo que funciona no privado. Manda *!menu* pra ver.`,
            id
        )
        return
    }

    despachar(s, msg, texto)
}

async function rotaUpload(req, res, url) {
    const s = sessaoDoToken(url.searchParams.get('s'))
    if (!s) return responderJSON(res, 401, { erro: 'sessão inválida' })

    if (!dentroDoLimite(s.janelaUploads, LIMITE_UPLOADS_POR_MIN_SESSAO)) {
        return responderJSON(res, 429, { erro: 'muitos envios seguidos' })
    }

    let buf
    try {
        buf = await lerCorpo(req, MAX_UPLOAD_BYTES)
    } catch (e) {
        return responderJSON(res, e.status || 400, { erro: e.status === 413 ? 'arquivo grande demais (máx. 16 MB)' : 'falha no envio' })
    }

    const declarado = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase()
    const mime = farejarMime(buf, declarado)

    if (!/^(image|video)\//.test(mime)) {
        return responderJSON(res, 415, { erro: 'só imagem ou vídeo' })
    }

    let tipo = mime.startsWith('video/') ? 'video' : 'imagem'
    if (mime === 'image/webp' && url.searchParams.get('tipo') === 'figurinha') tipo = 'figurinha'

    const umaVez = url.searchParams.get('umaVez') === '1' && tipo !== 'figurinha'
    const mid = guardarMidia(s, { tipo, mime, buf, umaVez })

    responderJSON(res, 200, { ok: true, mid, mime, tipo, url: `/m/${mid}` })
}

function rotaEventos(req, res, url) {
    const s = sessaoDoToken(url.searchParams.get('s'))
    if (!s) return responderJSON(res, 401, { erro: 'sessão inválida' })

    req.socket.setTimeout(0)
    req.socket.setKeepAlive(true)

    res.writeHead(200, cabecalhosBase({
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no'
    }))

    const reset = url.searchParams.get('boot') !== BOOT
    const desde = reset ? 0 : (Number(url.searchParams.get('desde')) || 0)

    res.write('retry: 2500\n\n')
    res.write(`event: hello\ndata: ${JSON.stringify({ boot: BOOT, reset, bot: !!handlerMensagens })}\n\n`)

    for (const ev of s.eventos) {
        if (ev.seq > desde) res.write(`id: ${ev.seq}\ndata: ${JSON.stringify(ev)}\n\n`)
    }

    s.clientes.add(res)
    while (s.clientes.size > MAX_CLIENTES_POR_SESSAO) {
        const velho = s.clientes.values().next().value
        s.clientes.delete(velho)
        try { velho.end() } catch { }
    }

    const batimento = setInterval(() => {
        try { res.write(': vivo\n\n') } catch { }
    }, 15000)

    req.on('close', () => {
        clearInterval(batimento)
        s.clientes.delete(res)
        s.uso = Date.now()
    })
}

function rotaMidia(req, res, id) {
    const m = midias.get(id)
    if (!m) {
        res.writeHead(404, cabecalhosBase({ 'Content-Type': 'text/plain; charset=utf-8' }))
        return res.end('mídia expirada')
    }

    const total = m.buf.length
    const cab = cabecalhosBase({
        'Content-Type': m.mime,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'private, max-age=3600'
    })

    const faixa = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '')
    if (faixa) {
        let ini = faixa[1] === '' ? total - Number(faixa[2]) : Number(faixa[1])
        let fim = faixa[1] === '' || faixa[2] === '' ? total - 1 : Number(faixa[2])
        ini = Math.max(0, ini)
        fim = Math.min(total - 1, fim)

        if (ini > fim || ini >= total) {
            res.writeHead(416, { ...cab, 'Content-Range': `bytes */${total}` })
            return res.end()
        }

        res.writeHead(206, {
            ...cab,
            'Content-Range': `bytes ${ini}-${fim}/${total}`,
            'Content-Length': fim - ini + 1
        })
        return res.end(m.buf.subarray(ini, fim + 1))
    }

    res.writeHead(200, { ...cab, 'Content-Length': total })
    res.end(m.buf)
}

function rotaEstatica(req, res, pathname) {
    let rel
    try { rel = decodeURIComponent(pathname) } catch {
        res.writeHead(400); return res.end()
    }

    if (rel === '/' || rel === '') rel = '/doodlebot-site.html'

    const alvo = path.normalize(path.join(PASTA_PUBLICA, rel))
    if (!alvo.startsWith(PASTA_PUBLICA + path.sep)) {
        res.writeHead(403); return res.end()
    }

    fs.readFile(alvo, (err, dados) => {
        if (err) {
            res.writeHead(404, cabecalhosBase({ 'Content-Type': 'text/plain; charset=utf-8' }))
            return res.end('não encontrado')
        }

        const ext = path.extname(alvo).toLowerCase()
        res.writeHead(200, cabecalhosBase({
            'Content-Type': TIPOS[ext] || 'application/octet-stream',
            'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600'
        }))
        res.end(dados)
    })
}

async function atender(req, res) {
    let url
    try { url = new URL(req.url, 'http://localhost') } catch {
        res.writeHead(400); return res.end()
    }

    const p = url.pathname

    if (req.method === 'OPTIONS') {
        res.writeHead(204, cabecalhosBase())
        return res.end()
    }

    if (req.method === 'GET' && p === '/api/status') {
        return responderJSON(res, 200, { ok: true, boot: BOOT, bot: !!handlerMensagens })
    }
    if (req.method === 'GET' && p === '/api/eventos') return rotaEventos(req, res, url)
    if (req.method === 'POST' && p === '/api/enviar') return rotaEnviar(req, res)
    if (req.method === 'POST' && p === '/api/midia') return rotaUpload(req, res, url)

    if (req.method === 'GET' && p.startsWith('/m/')) {
        const id = p.slice(3)
        if (/^[a-f0-9]{24}$/.test(id)) return rotaMidia(req, res, id)
    }

    if (req.method === 'GET' || req.method === 'HEAD') return rotaEstatica(req, res, p)

    res.writeHead(405); res.end()
}

function enderecosLocais() {
    const lista = []
    for (const itens of Object.values(os.networkInterfaces())) {
        for (const i of itens || []) {
            if (i.family === 'IPv4' && !i.internal) lista.push(i.address)
        }
    }
    return lista
}

function iniciarServidor() {
    if (servidor) return

    servidor = http.createServer((req, res) => {
        atender(req, res).catch((e) => {
            console.log('[WEB] Erro na rota:', e?.message || e)
            try {
                if (!res.headersSent) res.writeHead(500)
                res.end()
            } catch { }
        })
    })

    servidor.on('error', (e) => {
        console.log(
            e.code === 'EADDRINUSE'
                ? `⚠️ [WEB] A porta ${PORTA} já está em uso. Use WEB_PORT=3001 node doodlebot-index.js (o bot continua funcionando no WhatsApp).`
                : `⚠️ [WEB] Erro no servidor: ${e.message}`
        )
        servidor = null
    })

    servidor.listen(PORTA, '0.0.0.0', () => {
        console.log(`\n🌐 Site do Doodle Bot no ar: http://localhost:${PORTA}`)
        for (const ip of enderecosLocais()) console.log(`   Na sua rede: http://${ip}:${PORTA}`)
        console.log('')
    })

    setInterval(() => limparSessoes(false), 10 * 60 * 1000).unref()
}

// ==============================
// API PRO doodlebot-index.js
// ==============================

function configurar(opcoes = {}) {
    if (opcoes.numeroBot) config.numeroBot = String(opcoes.numeroBot)
    if (Array.isArray(opcoes.numerosReservados)) config.numerosReservados = opcoes.numerosReservados.map(String)
}

// O index.js entrega o handler de 'messages.upsert' aqui (a cada reconexão ele troca)
function registrarHandler(fn) {
    handlerMensagens = fn
    return fn
}

// Desvia tudo que o bot manda pra números do site (WhatsApp real continua igual)
function anexar(sock) {
    const enviarAnterior = sock.sendMessage.bind(sock)
    sock.sendMessage = async (jid, conteudo, ...resto) => {
        if (ehJidWeb(jid)) return enviarParaWeb(jid, conteudo, resto[0])
        return enviarAnterior(jid, conteudo, ...resto)
    }

    const presencaAnterior = sock.sendPresenceUpdate?.bind(sock)
    sock.sendPresenceUpdate = (estado, jid, ...resto) => {
        if (ehJidWeb(jid)) {
            presencaWeb(jid, estado)
            return Promise.resolve()
        }
        return presencaAnterior ? presencaAnterior(estado, jid, ...resto) : Promise.resolve()
    }

    const metaAnterior = sock.groupMetadata?.bind(sock)
    sock.groupMetadata = (jid, ...resto) => {
        if (ehJidWeb(jid)) return Promise.reject(new Error('chat privado do site'))
        return metaAnterior ? metaAnterior(jid, ...resto) : Promise.reject(new Error('sem conexão'))
    }

    iniciarServidor()
}

module.exports = {
    configurar,
    registrarHandler,
    anexar,
    ehJidWeb
}
