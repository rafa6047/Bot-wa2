const fs = require('fs');
const path = require('path');

const DB_DIR = path.join(__dirname, '..', 'database');

function ensureDir() {
    if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
}

function load(name, fallback = {}) {
    ensureDir();
    const file = path.join(DB_DIR, `${name}.json`);
    if (!fs.existsSync(file)) return structuredClone(fallback);
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
        return structuredClone(fallback);
    }
}

function save(name, data) {
    ensureDir();
    const file = path.join(DB_DIR, `${name}.json`);
    const temp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(data, null, 2));
    fs.renameSync(temp, file);
}

// ---- Group settings ----
const DEFAULT_GROUP = {
    welcome: false,
    welcomeText: '👋 Selamat datang @user di *@group*!',
    leaveText: '👋 @user telah meninggalkan grup.',
    antilink: false,
    antispam: false,
    antiviewonce: false,
    mute: false,
    warns: {}, // jid -> count
};

function getGroup(id) {
    const db = load('groups');
    return { ...DEFAULT_GROUP, ...(db[id] || {}) };
}

function setGroup(id, patch) {
    const db = load('groups');
    db[id] = { ...getGroup(id), ...patch };
    save('groups', db);
    return db[id];
}

// ---- AFK ----
function getAfk(jid) {
    const db = load('afk');
    return db[jid] || null;
}

function setAfk(jid, data) {
    const db = load('afk');
    if (data === null) delete db[jid];
    else db[jid] = data;
    save('afk', db);
}

// ---- Users (economy + level + ban) ----
const DEFAULT_USER = {
    balance: 0,
    xp: 0,
    level: 1,
    lastDaily: 0,
    banned: false,
    banReason: '',
};

function getUser(jid) {
    const db = load('users');
    const clean = jid.replace(/:\d+@/, '@');
    return { ...DEFAULT_USER, ...(db[clean] || db[jid] || {}) };
}

function setUser(jid, patch) {
    const db = load('users');
    const clean = jid.replace(/:\d+@/, '@');
    db[clean] = { ...getUser(jid), ...patch };
    save('users', db);
    return db[clean];
}

function addBalance(jid, amount) {
    const u = getUser(jid);
    u.balance = Math.max(0, (u.balance || 0) + amount);
    return setUser(jid, { balance: u.balance });
}

function addXp(jid, amount = 5) {
    const u = getUser(jid);
    u.xp = (u.xp || 0) + amount;
    let leveled = false;
    while (u.xp >= u.level * 100) {
        u.xp -= u.level * 100;
        u.level += 1;
        leveled = true;
    }
    setUser(jid, { xp: u.xp, level: u.level });
    return { ...u, leveled };
}

function getLeaderboard(limit = 10) {
    const db = load('users');
    return Object.entries(db)
        .map(([jid, data]) => ({ jid, ...data }))
        .sort((a, b) => (b.balance || 0) - (a.balance || 0))
        .slice(0, limit);
}


// ---- Personal notes and to-do lists ----
function getNotes(jid) {
    const all = load('notes');
    return Array.isArray(all[jid]) ? all[jid] : [];
}
function addNote(jid, text) {
    const all = load('notes');
    const notes = Array.isArray(all[jid]) ? all[jid] : [];
    const note = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), text: String(text).slice(0, 1000), createdAt: Date.now() };
    notes.push(note);
    all[jid] = notes.slice(-100);
    save('notes', all);
    return note;
}
function deleteNote(jid, id) {
    const all = load('notes');
    const notes = Array.isArray(all[jid]) ? all[jid] : [];
    const next = notes.filter((n, i) => String(i + 1) !== String(id) && n.id !== String(id));
    if (next.length === notes.length) return false;
    all[jid] = next;
    save('notes', all);
    return true;
}
function getTodos(jid) {
    const all = load('todos');
    return Array.isArray(all[jid]) ? all[jid] : [];
}
function addTodo(jid, text) {
    const all = load('todos');
    const todos = Array.isArray(all[jid]) ? all[jid] : [];
    const item = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), text: String(text).slice(0, 500), done: false, createdAt: Date.now() };
    todos.push(item);
    all[jid] = todos.slice(-200);
    save('todos', all);
    return item;
}
function updateTodo(jid, id, patch) {
    const all = load('todos');
    const todos = Array.isArray(all[jid]) ? all[jid] : [];
    const index = todos.findIndex((t, i) => String(i + 1) === String(id) || t.id === String(id));
    if (index < 0) return false;
    todos[index] = { ...todos[index], ...patch };
    all[jid] = todos;
    save('todos', all);
    return true;
}
function deleteTodo(jid, id) {
    const all = load('todos');
    const todos = Array.isArray(all[jid]) ? all[jid] : [];
    const next = todos.filter((t, i) => String(i + 1) !== String(id) && t.id !== String(id));
    if (next.length === todos.length) return false;
    all[jid] = next;
    save('todos', all);
    return true;
}
function addReminder(jid, reminder) {
    const all = load('reminders');
    const items = Array.isArray(all[jid]) ? all[jid] : [];
    const item = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), ...reminder, createdAt: Date.now(), sent: false };
    items.push(item);
    all[jid] = items.slice(-100);
    save('reminders', all);
    return item;
}

function getReminders(jid) {
    const all = load('reminders');
    return Array.isArray(all[jid]) ? all[jid] : [];
}
function deleteReminder(jid, id) {
    const all = load('reminders');
    const items = Array.isArray(all[jid]) ? all[jid] : [];
    const next = items.filter((item, i) => String(i + 1) !== String(id) && item.id !== String(id));
    if (next.length === items.length) return false;
    all[jid] = next;
    save('reminders', all);
    return true;
}

function getAllReminders() {
    const all = load('reminders');
    return Object.entries(all).flatMap(([jid, items]) => (Array.isArray(items) ? items : []).map((item) => ({ jid, ...item })));
}
function markReminderSent(jid, id) {
    const all = load('reminders');
    const items = Array.isArray(all[jid]) ? all[jid] : [];
    const index = items.findIndex((item) => item.id === id);
    if (index < 0) return false;
    items[index].sent = true;
    all[jid] = items;
    save('reminders', all);
    return true;
}

// ---- Rate limit & spam (in-memory) ----
const rateMap = new Map();
const spamMap = new Map();

function checkSpam(key, body) {
    const now = Date.now();
    const normalized = String(body).trim().toLowerCase();
    const previous = spamMap.get(key);
    if (previous && previous.body === normalized && now - previous.time < 5000) {
        previous.count += 1;
        previous.time = now;
        spamMap.set(key, previous);
        return previous.count >= 3;
    }
    spamMap.set(key, { body: normalized, time: now, count: 1 });
    if (spamMap.size > 5000) {
        for (const [k, v] of spamMap) if (now - v.time > 60000) spamMap.delete(k);
    }
    return false;
}

function checkRateLimit(jid, limitPerMinute = 25) {
    const now = Date.now();
    const windowMs = 60_000;
    let entry = rateMap.get(jid);
    if (!entry || now - entry.start > windowMs) {
        entry = { start: now, count: 0 };
        rateMap.set(jid, entry);
    }
    entry.count += 1;
    return entry.count <= limitPerMinute;
}

// ---- Simple game state (in-memory) ----
const gameState = new Map();

function setGame(key, data) {
    gameState.set(key, data);
}
function getGame(key) {
    return gameState.get(key) || null;
}
function deleteGame(key) {
    gameState.delete(key);
}

module.exports = {
    load,
    save,
    getGroup,
    setGroup,
    getAfk,
    setAfk,
    getUser,
    setUser,
    addBalance,
    addXp,
    getLeaderboard,
    checkRateLimit,
    checkSpam,
    setGame,
    getGame,
    deleteGame,
    DEFAULT_GROUP,
    DEFAULT_USER,
    getNotes, addNote, deleteNote,
    getTodos, addTodo, updateTodo, deleteTodo,
    addReminder, getReminders, deleteReminder, getAllReminders, markReminderSent,
};
