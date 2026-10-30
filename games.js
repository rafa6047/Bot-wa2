const db = require('./db');
const data = require('./data');

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();

// ============ KUIS ============
function startQuiz(jid, payload) {
    db.setGame(`quiz:${jid}`, { ...payload, start: Date.now(), ttl: 90000 });
}
function getQuiz(jid) {
    const q = db.getGame(`quiz:${jid}`);
    if (!q) return null;
    if (Date.now() - q.start > q.ttl) { db.deleteGame(`quiz:${jid}`); return 'expired'; }
    return q;
}
function endQuiz(jid) { db.deleteGame(`quiz:${jid}`); }
function checkAnswer(quiz, guess) {
    const g = norm(guess), a = norm(quiz.answer);
    return g === a || (a.length > 2 && g.includes(a)) || (g.length > 2 && a.includes(g));
}
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function shuffle(s) { return s.split('').sort(() => Math.random() - 0.5).join(''); }

function genMath() {
    const op = pick(['+', '-', '×']);
    let a = 1 + Math.floor(Math.random() * 50), b = 1 + Math.floor(Math.random() * 30), ans;
    if (op === '+') ans = a + b;
    else if (op === '-') { if (a < b) [a, b] = [b, a]; ans = a - b; }
    else ans = a * b;
    return { question: `Berapa hasil dari *${a} ${op} ${b}*?`, answer: String(ans) };
}

const QUIZ_TYPES = {
    math: { label: 'Kuis Matematika', gen: () => ({ ...genMath(), reward: 100 }) },
    teki: { label: 'Teka-Teki', gen: () => { const t = pick(data.TEBAK_TEKI); return { question: t.q, answer: t.a, reward: 200 }; } },
    tebaklagu: { label: 'Tebak Lagu', gen: () => { const t = pick(data.TEBAK_LAGU); return { question: t.q, answer: t.a, reward: 250 }; } },
    tebakbendera: { label: 'Tebak Bendera', gen: () => { const t = pick(data.TEBAK_BENDERA); return { question: t.q, answer: t.a, reward: 250 }; } },
    siapaaku: { label: 'Siapa Aku?', gen: () => { const t = pick(data.SIAPA_AKU); return { question: t.q, answer: t.a, reward: 200 }; } },
    caklontong: { label: 'Cak Lontong (hati-hati jebakan!)', gen: () => { const t = pick(data.CAK_LONTONG); return { question: t.q, answer: t.a, reward: 300 }; } },
    susunkata: { label: 'Susun Kata', gen: () => {
        const w = pick(data.SUSUN_KATA);
        return { question: `Susun huruf ini jadi kata: *${shuffle(w)}*\nPetunjuk: ${data.SUSUN_HINT[w] || '-'}`, answer: w, reward: 150 };
    } },
};

// ============ TICTACTOE ============
const tttGames = new Map();
function tttStart(jid, x, o) {
    tttGames.set(jid, { board: Array(9).fill(null), players: { X: x, O: o }, turn: 'X', last: Date.now() });
    setTimeout(() => tttGames.delete(jid), 10 * 60 * 1000);
}
function tttGet(jid) { return tttGames.get(jid) || null; }
function tttEnd(jid) { tttGames.delete(jid); }
function tttRender(b) {
    const c = (i) => (b[i] === 'X' ? '❌' : b[i] === 'O' ? '⭕' : `${i + 1}\uFE0F\u20E3`);
    return `${c(0)}${c(1)}${c(2)}\n${c(3)}${c(4)}${c(5)}\n${c(6)}${c(7)}${c(8)}`;
}
const WIN_LINES = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
function tttWinner(b) {
    for (const [a, c, d] of WIN_LINES) if (b[a] && b[a] === b[c] && b[a] === b[d]) return b[a];
    return b.every((x) => x) ? 'draw' : null;
}
function tttMove(jid, jidPlayer, pos) {
    const g = tttGames.get(jid);
    if (!g) return { ok: false, reason: 'Tidak ada permainan aktif' };
    if (g.players[g.turn] !== jidPlayer) return { ok: false, reason: 'Belum giliranmu!' };
    if (pos < 0 || pos > 8 || g.board[pos]) return { ok: false, reason: 'Kotak tidak valid/terisi' };
    g.board[pos] = g.turn; g.last = Date.now();
    const w = tttWinner(g.board);
    if (w) { tttGames.delete(jid); return { ok: true, winner: w, board: g.board, players: g.players }; }
    g.turn = g.turn === 'X' ? 'O' : 'X';
    return { ok: true, board: g.board, players: g.players, turn: g.turn };
}

module.exports = { startQuiz, getQuiz, endQuiz, checkAnswer, QUIZ_TYPES, tttStart, tttGet, tttEnd, tttRender, tttMove };
