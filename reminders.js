const db = require('./db');
const { cleanJid } = require('./helpers');

let timer = null;
let activeSock = null;
async function deliverDueReminders(sock) {
    const now = Date.now();
    for (const item of db.getAllReminders()) {
        if (item.sent || !Number.isFinite(item.dueAt) || item.dueAt > now) continue;
        // Mark first to avoid duplicate sends if a send fails or reconnect races.
        db.markReminderSent(item.jid, item.id);
        try {
            await sock.sendMessage(cleanJid(item.jid), {
                text: `⏰ *PENGINGAT*\n${item.text}\n\nDibuat pada: ${new Date(item.createdAt).toLocaleString('id-ID')}`
            });
        } catch (err) {
            console.error('Gagal mengirim pengingat:', err.message);
        }
    }
}
function startReminderWorker(sock) {
    activeSock = sock;
    if (timer) return;
    const tick = () => activeSock && deliverDueReminders(activeSock).catch((err) => console.error('Reminder worker:', err.message));
    tick();
    timer = setInterval(tick, 15000);
    timer.unref?.();
}
module.exports = { startReminderWorker, deliverDueReminders };
