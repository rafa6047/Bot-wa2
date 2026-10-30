const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const config = require('../config');

const PLATFORMS = {
    TikTok: ['tiktok.com', 'www.tiktok.com', 'vm.tiktok.com', 'vt.tiktok.com', 'm.tiktok.com'],
    YouTube: [
        'youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be',
        'music.youtube.com', 'www.music.youtube.com',
    ],
    Instagram: ['instagram.com', 'www.instagram.com'],
    Pinterest: ['pinterest.com', 'www.pinterest.com', 'pin.it', 'id.pinterest.com'],
    Facebook: [
        'facebook.com', 'www.facebook.com', 'm.facebook.com', 'fb.watch',
        'web.facebook.com', 'fb.com',
    ],
    Twitter: ['twitter.com', 'www.twitter.com', 'x.com', 'www.x.com', 'mobile.twitter.com'],
};

function validateUrl(rawUrl, label) {
    if (!rawUrl || typeof rawUrl !== 'string') {
        return `Kirim URL ${label}. Contoh: .${label.toLowerCase()} https://...`;
    }
    let parsed;
    try {
        parsed = new URL(rawUrl.trim());
    } catch {
        return 'Link tidak valid. Gunakan URL lengkap yang diawali https://';
    }
    if (!['https:', 'http:'].includes(parsed.protocol)) {
        return 'Hanya link HTTP/HTTPS yang diizinkan.';
    }
    const allowed = PLATFORMS[label];
    if (allowed && !allowed.includes(parsed.hostname.toLowerCase())) {
        return `Link bukan dari platform ${label} yang didukung.`;
    }
    return null;
}

function runYtDlp(url, outputTemplate, extraArgs = []) {
    return new Promise((resolve, reject) => {
        const args = [
            '--no-playlist',
            '--no-warnings',
            '--socket-timeout', '25',
            '--retries', '2',
            '--max-filesize', `${config.maxDownloadBytes}`,
            '-f', 'best[ext=mp4]/bestvideo+bestaudio/best',
            '--merge-output-format', 'mp4',
            '-o', outputTemplate,
            ...extraArgs,
            '--',
            url,
        ];

        const proc = spawn('yt-dlp', args, { stdio: ['ignore', 'pipe', 'pipe'] });
        let stderr = '';
        const timer = setTimeout(() => {
            proc.kill('SIGTERM');
            reject(new Error('Waktu unduh habis (batas 2.5 menit).'));
        }, config.downloadTimeoutMs);

        proc.stderr.on('data', (d) => {
            stderr = (stderr + d.toString()).slice(-4000);
        });
        proc.on('error', (err) => {
            clearTimeout(timer);
            reject(
                err.code === 'ENOENT'
                    ? new Error('yt-dlp tidak ditemukan. Pasang: python -m pip install -U yt-dlp')
                    : new Error(err.message)
            );
        });
        proc.on('close', (code) => {
            clearTimeout(timer);
            if (code === 0) resolve();
            else reject(new Error(stderr.slice(-600) || `yt-dlp keluar dengan kode ${code}`));
        });
    });
}

/**
 * Download media lalu kembalikan path file terbesar.
 * @returns {{ filePath: string, tmpDir: string, size: number, ext: string }}
 */
async function downloadMedia(url, label, extraArgs = []) {
    const validationError = validateUrl(url, label);
    if (validationError) throw new Error(validationError);

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wabot-dl-'));
    const outputTemplate = path.join(tmpDir, '%(id)s.%(ext)s');

    try {
        await runYtDlp(url, outputTemplate, extraArgs);
        const files = fs
            .readdirSync(tmpDir)
            .map((name) => ({ name, path: path.join(tmpDir, name) }))
            .filter((item) => fs.statSync(item.path).isFile())
            .sort((a, b) => fs.statSync(b.path).size - fs.statSync(a.path).size);

        const file = files[0];
        if (!file) throw new Error('File hasil unduhan tidak ditemukan.');
        const stat = fs.statSync(file.path);
        if (stat.size === 0) throw new Error('File hasil unduhan kosong.');
        if (stat.size > config.maxDownloadBytes) {
            throw new Error('File terlalu besar untuk dikirim lewat WhatsApp (maks ~95 MB).');
        }
        return {
            filePath: file.path,
            tmpDir,
            size: stat.size,
            ext: path.extname(file.path).toLowerCase(),
        };
    } catch (err) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
        throw err;
    }
}

async function sendDownloaded({ sock, from, msg, url, label, isAudio = false }) {
    const reply = (text) =>
        sock.sendMessage(from, { text }, { quoted: msg });

    await reply(`⏳ Mengunduh dari *${label}*...\nMohon tunggu sebentar.`);

    let result;
    try {
        const extra = isAudio
            ? ['-x', '--audio-format', 'mp3', '--audio-quality', '0']
            : [];
        result = await downloadMedia(url, label, extra);
        const media = fs.readFileSync(result.filePath);
        const { ext } = result;

        if (isAudio || ['.mp3', '.m4a', '.ogg', '.opus', '.wav'].includes(ext)) {
            await sock.sendMessage(
                from,
                {
                    audio: media,
                    mimetype: 'audio/mpeg',
                    fileName: `audio_${Date.now()}.mp3`,
                    ptt: false,
                },
                { quoted: msg }
            );
        } else if (['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(ext)) {
            await sock.sendMessage(
                from,
                { image: media, caption: `✅ Berhasil diunduh dari *${label}*.` },
                { quoted: msg }
            );
        } else {
            await sock.sendMessage(
                from,
                {
                    video: media,
                    mimetype: ext === '.webm' ? 'video/webm' : 'video/mp4',
                    caption: `✅ Berhasil diunduh dari *${label}*.`,
                },
                { quoted: msg }
            );
        }
    } catch (err) {
        let detail = err.message;
        if (/sign in|login|private/i.test(detail)) {
            detail = 'Konten ini mungkin privat atau memerlukan login.';
        }
        await reply(`❌ Gagal mengunduh dari ${label}:\n${detail}`);
    } finally {
        if (result?.tmpDir) {
            fs.rmSync(result.tmpDir, { recursive: true, force: true });
        }
    }
}

module.exports = {
    PLATFORMS,
    validateUrl,
    downloadMedia,
    sendDownloaded,
};
