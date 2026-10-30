const fs = require('fs');
const path = require('path');
const db = require('./db');

const STORE_DIR = path.join(__dirname, '..', 'store');

function ensureDir() {
    if (!fs.existsSync(STORE_DIR)) fs.mkdirSync(STORE_DIR, { recursive: true });
}

function loadStore(name, fallback = {}) {
    ensureDir();
    const file = path.join(STORE_DIR, `${name}.json`);
    if (!fs.existsSync(file)) return structuredClone(fallback);
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
        return structuredClone(fallback);
    }
}

function saveStore(name, data) {
    ensureDir();
    const file = path.join(STORE_DIR, `${name}.json`);
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, file);
}

// ==================== Settings runtime ====================
function getSetting(key, fallback = null) {
    const s = loadStore('settings', {});
    return key in s ? s[key] : fallback;
}
function setSetting(key, value) {
    const s = loadStore('settings', {});
    s[key] = value;
    saveStore('settings', s);
}

// ==================== Bank (bunga 0,1%/jam, maks akumulasi 24 jam) ====================
const BANK_RATE = 0.001;
const BANK_MAX_HOURS = 24;

function getBank(jid) {
    const all = loadStore('bank', {});
    const clean = jid.replace(/:\d+@/, '@');
    let acc = all[clean] || { balance: 0, lastAccrual: Date.now() };
    const hours = Math.min((Date.now() - (acc.lastAccrual || Date.now())) / 3_600_000, BANK_MAX_HOURS);
    if (hours > 0 && acc.balance > 0) {
        const interest = Math.floor(acc.balance * BANK_RATE * hours);
        acc.balance += interest;
        acc.lastAccrual = Date.now();
        all[clean] = acc;
        saveStore('bank', all);
    }
    return acc;
}

function deposit(jid, amount) {
    const user = db.getUser(jid);
    if (amount <= 0 || user.balance < amount) return { ok: false, reason: 'saldo tidak cukup' };
    db.addBalance(jid, -amount);
    const acc = getBank(jid);
    const all = loadStore('bank', {});
    const clean = jid.replace(/:\d+@/, '@');
    all[clean] = { balance: acc.balance + amount, lastAccrual: Date.now() };
    saveStore('bank', all);
    return { ok: true, balance: all[clean].balance };
}

function withdraw(jid, amount) {
    const acc = getBank(jid);
    if (amount <= 0 || acc.balance < amount) return { ok: false, reason: 'saldo bank tidak cukup' };
    const all = loadStore('bank', {});
    const clean = jid.replace(/:\d+@/, '@');
    all[clean] = { balance: acc.balance - amount, lastAccrual: Date.now() };
    saveStore('bank', all);
    db.addBalance(jid, amount);
    return { ok: true, balance: all[clean].balance };
}

// ==================== Inventory ====================
function getInventory(jid) {
    const all = loadStore('inventory', {});
    const clean = jid.replace(/:\d+@/, '@');
    return all[clean] || {};
}
function addItem(jid, item, qty = 1) {
    const all = loadStore('inventory', {});
    const clean = jid.replace(/:\d+@/, '@');
    const inv = all[clean] || {};
    inv[item] = (inv[item] || 0) + qty;
    all[clean] = inv;
    saveStore('inventory', all);
}
function removeItem(jid, item, qty = 1) {
    const all = loadStore('inventory', {});
    const clean = jid.replace(/:\d+@/, '@');
    const inv = all[clean] || {};
    if ((inv[item] || 0) < qty) return false;
    inv[item] -= qty;
    if (inv[item] <= 0) delete inv[item];
    all[clean] = inv;
    saveStore('inventory', all);
    return true;
}
function hasItem(jid, item, qty = 1) {
    return (getInventory(jid)[item] || 0) >= qty;
}

// ==================== Buff aktif (perisai/jimat) ====================
function getBuffs(jid) {
    const all = loadStore('buffs', {});
    const clean = jid.replace(/:\d+@/, '@');
    const b = all[clean] || {};
    const now = Date.now();
    if (b.shieldUntil && b.shieldUntil < now) b.shieldUntil = 0;
    if (b.luckUntil && b.luckUntil < now) b.luckUntil = 0;
    return b;
}
function setBuff(jid, type, untilMs) {
    const all = loadStore('buffs', {});
    const clean = jid.replace(/:\d+@/, '@');
    const b = all[clean] || {};
    b[type] = untilMs;
    all[clean] = b;
    saveStore('buffs', all);
}

// ==================== Pernikahan ====================
const pendingMarriage = new Map(); // proposer -> {target, time}

function getMarriage(jid) {
    const all = loadStore('marriage', {});
    const clean = jid.replace(/:\d+@/, '@');
    return all[clean] || { partner: null, since: 0 };
}
function setMarriage(jid, data) {
    const all = loadStore('marriage', {});
    const clean = jid.replace(/:\d+@/, '@');
    all[clean] = data;
    saveStore('marriage', all);
}
function propose(from, to) {
    pendingMarriage.set(to, { from, time: Date.now() });
    setTimeout(() => {
        const p = pendingMarriage.get(to);
        if (p && p.from === from) pendingMarriage.delete(to);
    }, 120_000);
}
function getProposal(target) {
    return pendingMarriage.get(target) || null;
}
function clearProposal(target) {
    pendingMarriage.delete(target);
}

// ==================== Auto-respond (keyword -> jawaban) ====================
function getAutoresponds() {
    return loadStore('autorespond', {});
}
function setAutorespond(trigger, response) {
    const all = getAutoresponds();
    all[trigger.toLowerCase()] = response;
    saveStore('autorespond', all);
}
function delAutorespond(trigger) {
    const all = getAutoresponds();
    const key = trigger.toLowerCase();
    if (!(key in all)) return false;
    delete all[key];
    saveStore('autorespond', all);
    return true;
}
function matchAutorespond(text) {
    const body = String(text || '').toLowerCase().trim();
    if (!body) return null;
    const all = getAutoresponds();
    if (all[body]) return all[body];
    for (const [k, v] of Object.entries(all)) {
        if (k.length > 3 && body.includes(k)) return v;
    }
    return null;
}

// ==================== Memori percakapan AI ====================
function getAiSession(jid) {
    const all = loadStore('aisession', {});
    return Array.isArray(all[jid]) ? all[jid] : [];
}
function pushAiSession(jid, role, text) {
    const all = loadStore('aisession', {});
    const session = Array.isArray(all[jid]) ? all[jid] : [];
    session.push({ role, parts: [{ text: String(text).slice(0, 4000) }] });
    while (session.length > 12) session.shift();
    all[jid] = session;
    saveStore('aisession', all);
}
function clearAiSession(jid) {
    const all = loadStore('aisession', {});
    delete all[jid];
    saveStore('aisession', all);
}

// ==================== Penyimpanan pesan terhapus (antidelete) ====================
function saveDeleted(jid, snapshot) {
    const all = loadStore('deleted', {});
    const list = Array.isArray(all[jid]) ? all[jid] : [];
    list.push(snapshot);
    while (list.length > 30) list.shift();
    all[jid] = list;
    saveStore('deleted', all);
}
function getDeleted(jid) {
    const all = loadStore('deleted', {});
    return Array.isArray(all[jid]) ? all[jid] : [];
}
function clearDeleted(jid) {
    const all = loadStore('deleted', {});
    delete all[jid];
    saveStore('deleted', all);
}

// ==================== Papan peringkat level ====================
function getLevelLeaderboard(limit = 10) {
    const users = db.load('users', {});
    return Object.entries(users)
        .map(([jid, data]) => ({
            jid,
            level: data.level || 1,
            xp: data.xp || 0,
            balance: data.balance || 0,
        }))
        .sort((a, b) => b.level - a.level || b.xp - a.xp || b.balance - a.balance)
        .slice(0, limit);
}

// ==================== Hitung mundur command cooldown ====================
const cooldowns = new Map();
function isOnCooldown(key, ms) {
    const last = cooldowns.get(key) || 0;
    if (Date.now() - last < ms) return Math.ceil((ms - (Date.now() - last)) / 1000);
    cooldowns.set(key, Date.now());
    return 0;
}

module.exports = {
    getSetting, setSetting,
    getBank, deposit, withdraw, BANK_RATE, BANK_MAX_HOURS,
    getInventory, addItem, removeItem, hasItem,
    getBuffs, setBuff,
    getMarriage, setMarriage, propose, getProposal, clearProposal,
    getAutoresponds, setAutorespond, delAutorespond, matchAutorespond,
    getAiSession, pushAiSession, clearAiSession,
    saveDeleted, getDeleted, clearDeleted,
    getLevelLeaderboard,
    isOnCooldown,
};
