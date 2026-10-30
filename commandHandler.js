const fs = require('fs');
const path = require('path');
const config = require('../config');
const db = require('./db');
const store = require('./store');
const {
    getText,
    getSender,
    isGroup,
    isOwner,
    isAdmin,
    isBotAdmin,
} = require('./helpers');

const commands = new Map();
const aliases = new Map();

function loadCommands() {
    const dir = path.join(__dirname, '..', 'commands');
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.js'));
    for (const file of files) {
        try {
            delete require.cache[require.resolve(path.join(dir, file))];
            const mod = require(path.join(dir, file));
            if (!mod.command && !mod.commands) continue;
            const names = mod.commands || [mod.command];
            const main = names[0];
            commands.set(main, mod);
            for (const name of names) {
                aliases.set(name.toLowerCase(), main);
            }
        } catch (err) {
            console.error(`Gagal load command ${file}:`, err.message);
        }
    }
    console.log(`✅ Loaded ${commands.size} command module(s).`);
}

function buildCtx(sock, msg) {
    const from = msg.key.remoteJid;
    const sender = getSender(msg);
    const text = getText(msg).trim();
    const isGrp = isGroup(from);

    const reply = async (content, options = {}) => {
        const payload = typeof content === 'string' ? { text: content } : content;
        return sock.sendMessage(from, payload, { quoted: msg, ...options });
    };

    return {
        sock,
        msg,
        from,
        sender,
        text,
        isGroup: isGrp,
        args: [],
        command: '',
        reply,
        isOwner: () => isOwner(sender),
        isAdmin: async () => (isGrp ? isAdmin(sock, from, sender) : false),
        isBotAdmin: async () => (isGrp ? isBotAdmin(sock, from) : false),
        config,
        db,
        store,
        prefix: store.getSetting('prefix', config.prefix),
    };
}

async function handleCommand(sock, msg) {
    const from = msg.key?.remoteJid;
    if (!from || from === 'status@broadcast' || from.endsWith('@newsletter')) return;

    const sender = getSender(msg);
    const user = db.getUser(sender);

    // Ban check
    if (user.banned && !isOwner(sender)) {
        return;
    }

    // MODE SELF
    if (store.getSetting('mode', 'public') === 'self' && !isOwner(sender) && !msg.key.fromMe) return;

    // Group moderation
    if (isGroup(from)) {
        const settings = db.getGroup(from);
        const senderIsAdmin = (await isAdmin(sock, from, sender)) || isOwner(sender);

        if (settings.mute && !senderIsAdmin && !msg.key.fromMe) return;

        if (settings.antispam && !senderIsAdmin && !msg.key.fromMe) {
            const body = getText(msg);
            if (body && db.checkSpam(`${from}:${sender}`, body)) {
                try {
                    await sock.sendMessage(from, { delete: msg.key });
                } catch {}
                return;
            }
        }

        if (settings.antilink && !msg.key.fromMe) {
            const body = getText(msg);
            if (/https?:\/\/|www\.|wa\.me\/|t\.me\//i.test(body)) {
                if (!senderIsAdmin) {
                    try {
                        await sock.sendMessage(from, {
                            text: '🚫 Link terdeteksi! Pesan dihapus (Anti-Link aktif).',
                        });
                        await sock.sendMessage(from, { delete: msg.key });
                    } catch {}
                    return;
                }
            }
        }
    }

    const prefix = store.getSetting('prefix', config.prefix);
    const text = getText(msg).trim();
    if (!text.startsWith(prefix)) return;

    const commandText = text.slice(config.prefix.length).trim();
    if (!commandText) return;

    const [rawCmd, ...args] = commandText.split(/\s+/);
    const cmdName = rawCmd.toLowerCase();
    const mainName = aliases.get(cmdName);
    if (!mainName) return;

    const mod = commands.get(mainName);
    if (!mod || typeof mod.run !== 'function') return;

    // Rate limit
    if (!db.checkRateLimit(sender, config.rateLimitPerMinute) && !isOwner(sender)) {
        return sock.sendMessage(
            from,
            { text: '⏳ Terlalu banyak perintah. Tunggu sebentar.' },
            { quoted: msg }
        );
    }

    const ctx = buildCtx(sock, msg);
    ctx.args = args;
    ctx.command = mainName;

    // Permission checks
    if (mod.ownerOnly && !ctx.isOwner()) {
        return ctx.reply(config.messages.onlyOwner);
    }
    if (mod.groupOnly && !ctx.isGroup) {
        return ctx.reply(config.messages.onlyGroup);
    }
    if (mod.adminOnly) {
        if (!(await ctx.isAdmin()) && !ctx.isOwner()) {
            return ctx.reply(config.messages.onlyAdmin);
        }
    }
    if (mod.botAdmin) {
        if (!(await ctx.isBotAdmin())) {
            return ctx.reply(config.messages.botNeedAdmin);
        }
    }

    try {
        await sock.sendPresenceUpdate('composing', from).catch(() => {});
        await mod.run(ctx);
        await sock.sendPresenceUpdate('paused', from).catch(() => {});
        // Give small XP for using commands
        if (!mod.ownerOnly) {
            const result = db.addXp(sender, 3);
            if (result.leveled) {
                await ctx.reply(
                    `🎉 Selamat! Level naik menjadi *${result.level}*\nXP: ${result.xp}/${result.level * 100}`
                ).catch(() => {});
            }
        }
    } catch (err) {
        console.error(`Error command .${mainName}:`, err);
        await ctx.reply(config.messages.error).catch(() => {});
    }
}

function getCommandList() {
    const list = [];
    for (const [name, mod] of commands) {
        list.push({
            name,
            aliases: (mod.commands || [mod.command]).slice(1),
            category: mod.category || 'Lainnya',
            description: mod.description || '-',
            ownerOnly: !!mod.ownerOnly,
            groupOnly: !!mod.groupOnly,
            adminOnly: !!mod.adminOnly,
        });
    }
    return list;
}

module.exports = {
    loadCommands,
    handleCommand,
    getCommandList,
    commands,
};
