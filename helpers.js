const config = require('../config');

function getText(msg) {
    const m = msg.message || {};
    return (
        m.conversation ||
        m.extendedTextMessage?.text ||
        m.imageMessage?.caption ||
        m.videoMessage?.caption ||
        m.documentMessage?.caption ||
        m.stickerMessage?.caption ||
        m.buttonsResponseMessage?.selectedButtonId ||
        m.listResponseMessage?.singleSelectReply?.selectedRowId ||
        m.templateButtonReplyMessage?.selectedId ||
        m.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson ||
        ''
    );
}

function getSender(msg) {
    return msg.key.participant || msg.key.remoteJid;
}

function isGroup(jid) {
    return typeof jid === 'string' && jid.endsWith('@g.us');
}

function isOwner(jid) {
    if (!jid) return false;
    const clean = jid.replace(/:\d+@/, '@');
    return config.ownerNumbers.some(
        (o) => o === jid || o === clean || o.split('@')[0] === clean.split('@')[0]
    );
}

async function isAdmin(sock, groupJid, userJid) {
    try {
        const meta = await sock.groupMetadata(groupJid);
        const p = meta.participants.find(
            (x) => x.id === userJid || x.id.split(':')[0] === userJid.split(':')[0]
        );
        return p?.admin === 'admin' || p?.admin === 'superadmin';
    } catch {
        return false;
    }
}

async function isBotAdmin(sock, groupJid) {
    try {
        const meta = await sock.groupMetadata(groupJid);
        const botId = sock.user.id;
        const botLid = sock.user.lid;
        const p = meta.participants.find(
            (x) =>
                x.id === botId ||
                x.id === botLid ||
                x.id.split(':')[0] === botId.split(':')[0] ||
                (botLid && x.id.split(':')[0] === botLid.split(':')[0])
        );
        return p?.admin === 'admin' || p?.admin === 'superadmin';
    } catch {
        return false;
    }
}

function formatRuntime(ms) {
    const sec = Math.floor(ms / 1000);
    const d = Math.floor(sec / 86400);
    const h = Math.floor((sec % 86400) / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    const parts = [];
    if (d) parts.push(`${d} hari`);
    if (h) parts.push(`${h} jam`);
    if (m) parts.push(`${m} menit`);
    parts.push(`${s} detik`);
    return parts.join(' ');
}

function pickRandom(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

function getQuoted(msg) {
    return msg.message?.extendedTextMessage?.contextInfo?.quotedMessage || null;
}

function getQuotedParticipant(msg) {
    return msg.message?.extendedTextMessage?.contextInfo?.participant || null;
}

function formatNumber(n) {
    return Number(n || 0).toLocaleString('id-ID');
}

function cleanJid(jid) {
    return (jid || '').replace(/:\d+@/, '@');
}

function parseMention(text) {
    const matches = text.match(/@(\d{8,15})/g) || [];
    return matches.map((m) => m.replace('@', '') + '@s.whatsapp.net');
}

module.exports = {
    getText,
    getSender,
    isGroup,
    isOwner,
    isAdmin,
    isBotAdmin,
    formatRuntime,
    pickRandom,
    sleep,
    getQuoted,
    getQuotedParticipant,
    formatNumber,
    cleanJid,
    parseMention,
};
