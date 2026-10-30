const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { getQuoted } = require('./helpers');

async function streamToBuffer(stream) {
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    return Buffer.concat(chunks);
}

/**
 * Ambil buffer media dari pesan (atau quoted).
 * typeHint: 'image' | 'video' | 'sticker' | 'audio' | 'document'
 */
async function getMediaBuffer(msg, typeHint) {
    const quoted = getQuoted(msg);
    const target = quoted || msg.message;
    if (!target) return null;

    const candidates = typeHint
        ? [typeHint]
        : ['image', 'video', 'sticker', 'audio', 'document'];

    for (const type of candidates) {
        const key = `${type}Message`;
        if (target[key]) {
            const stream = await downloadContentFromMessage(target[key], type === 'sticker' ? 'sticker' : type);
            const buffer = await streamToBuffer(stream);
            return { buffer, type, mimetype: target[key].mimetype };
        }
    }
    return null;
}

function runFfmpeg(args) {
    return new Promise((resolve, reject) => {
        const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
        let stderr = '';
        proc.stderr.on('data', (d) => (stderr += d.toString()));
        proc.on('error', () =>
            reject(new Error('ffmpeg tidak ditemukan. Pasang dengan: pkg install ffmpeg'))
        );
        proc.on('close', (code) =>
            code === 0 ? resolve() : reject(new Error(stderr.slice(-400) || `ffmpeg exit ${code}`))
        );
    });
}

async function toWebpSticker(inputBuffer, isVideo = false) {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wabot-sticker-'));
    const inputPath = path.join(tmpDir, isVideo ? 'in.mp4' : 'in.jpg');
    const outputPath = path.join(tmpDir, 'out.webp');
    fs.writeFileSync(inputPath, inputBuffer);

    try {
        const args = isVideo
            ? [
                  '-i', inputPath,
                  '-vcodec', 'libwebp',
                  '-vf', 'scale=512:512:force_original_aspect_ratio=decrease,fps=15',
                  '-loop', '0',
                  '-ss', '00:00:00',
                  '-t', '6',
                  '-an',
                  '-vsync', '0',
                  '-y', outputPath,
              ]
            : [
                  '-i', inputPath,
                  '-vcodec', 'libwebp',
                  '-vf', 'scale=512:512:force_original_aspect_ratio=decrease',
                  '-y', outputPath,
              ];
        await runFfmpeg(args);
        return fs.readFileSync(outputPath);
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
}

async function webpToPng(webpBuffer) {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wabot-toimg-'));
    const inputPath = path.join(tmpDir, 'in.webp');
    const outputPath = path.join(tmpDir, 'out.png');
    fs.writeFileSync(inputPath, webpBuffer);
    try {
        await runFfmpeg(['-i', inputPath, '-y', outputPath]);
        return fs.readFileSync(outputPath);
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
}

async function toMp3(inputBuffer, inputExt = 'mp4') {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wabot-tomp3-'));
    const inputPath = path.join(tmpDir, `in.${inputExt}`);
    const outputPath = path.join(tmpDir, 'out.mp3');
    fs.writeFileSync(inputPath, inputBuffer);
    try {
        await runFfmpeg([
            '-i', inputPath,
            '-vn',
            '-acodec', 'libmp3lame',
            '-ab', '128k',
            '-ar', '44100',
            '-y', outputPath,
        ]);
        return fs.readFileSync(outputPath);
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
}

module.exports = {
    getMediaBuffer,
    toWebpSticker,
    webpToPng,
    toMp3,
    runFfmpeg,
};
