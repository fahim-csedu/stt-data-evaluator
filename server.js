const express = require('express');
const path = require('path');
const fs = require('fs');

// Load configuration
let config;
try {
    config = require('./config.local.js');
    console.log('Using local configuration');
} catch (error) {
    config = require('./config.js');
    console.log('Using default configuration');
}

const app = express();
const { BASE_DIR, PORT, SESSION_TIMEOUT, DEBUG } = config;
const SPLIT_CSVS = config.SPLIT_CSVS || {
    'annotator1': 'split_annotator1.csv',
    'annotator2': 'split_annotator2.csv',
};
const AUDIO_EXTENSIONS = ['.flac', '.wav', '.mp3', '.m4a', '.ogg'];
const ANNOTATIONS_ROOT = path.join(__dirname, 'annotations');

function normalizePath(pathStr) {
    if (!pathStr) return '';
    return pathStr
        .replace(/\\/g, '/')
        .replace(/\/+/g, '/')
        .replace(/^\//, '')
        .replace(/\/$/, '');
}

// ── CSV loading ──────────────────────────────────────────────────────────────

function parseCsvRow(line) {
    const fields = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
            if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
                current += '"';
                i++;
            } else {
                inQuotes = !inQuotes;
            }
            continue;
        }
        if (ch === ',' && !inQuotes) {
            fields.push(current);
            current = '';
            continue;
        }
        current += ch;
    }
    fields.push(current);
    return fields;
}

function loadSplitCsv(csvPath) {
    if (!fs.existsSync(csvPath)) {
        throw new Error(`Split CSV not found: ${csvPath}`);
    }

    const raw = fs.readFileSync(csvPath, 'utf8');
    const lines = raw.split(/\r?\n/).filter(l => l.trim().length > 0);
    if (lines.length < 2) return [];

    const headers = parseCsvRow(lines[0]).map(h => h.trim());
    const rows = [];

    for (let i = 1; i < lines.length; i++) {
        const fields = parseCsvRow(lines[i]);
        const row = {};
        headers.forEach((h, idx) => { row[h] = (fields[idx] || '').trim(); });

        row.WER = parseFloat(row.WER) || 0;
        row.CER = parseFloat(row.CER) || 0;
        row.snr_vad = parseFloat(row.snr_vad) || 0;
        row.unique_words = parseInt(row.unique_words, 10) || 0;
        row.silence_percentage = parseFloat(row.silence_percentage) || 0;

        if (row.key) rows.push(row);
    }

    return rows;
}

// Build per-split data and a global metadata map keyed by clipId
const splitFolders = Object.keys(SPLIT_CSVS);
const splitData = {};      // splitName -> [row, ...]
const metadataMap = new Map(); // clipId -> row
const splitSets = {};      // splitName -> Set<clipId>

splitFolders.forEach(name => {
    const csvFile = path.join(__dirname, SPLIT_CSVS[name]);
    const rows = loadSplitCsv(csvFile);
    splitData[name] = rows;
    splitSets[name] = new Set();
    rows.forEach(row => {
        metadataMap.set(row.key, row);
        splitSets[name].add(row.key);
    });
    console.log(`Loaded split "${name}": ${rows.length} samples from ${SPLIT_CSVS[name]}`);
});

const audioFileNameCache = new Map();

function isAnnotationSaved(splitFolder, clipId) {
    const annotationPath = path.join(ANNOTATIONS_ROOT, splitFolder, `${clipId}.json`);
    return fs.existsSync(annotationPath);
}

function countSavedAnnotations(splitFolder) {
    const dir = path.join(ANNOTATIONS_ROOT, splitFolder);
    if (!fs.existsSync(dir)) return 0;
    return fs.readdirSync(dir).filter(f => f.endsWith('.json')).length;
}

function resolveAudioFileName(fileId) {
    if (audioFileNameCache.has(fileId)) return audioFileNameCache.get(fileId);
    const resolved = path.extname(fileId) ? fileId : `${fileId}.flac`;
    audioFileNameCache.set(fileId, resolved);
    return resolved;
}

function resolveAudioPathFromRequest(requestPath) {
    const normalized = normalizePath(requestPath);
    const leafName = path.basename(normalized);
    if (!leafName || leafName === '.' || leafName === '..') return null;

    if (path.extname(leafName)) {
        const directPath = path.resolve(BASE_DIR, leafName);
        if (fs.existsSync(directPath)) return directPath;
        return null;
    }

    for (const ext of AUDIO_EXTENSIONS) {
        const candidate = path.resolve(BASE_DIR, `${leafName}${ext}`);
        if (fs.existsSync(candidate)) return candidate;
    }
    return null;
}

function resolveTranscriptPathFromRequest(requestPath) {
    const normalized = normalizePath(requestPath);
    const leafName = path.basename(normalized);
    if (!leafName || leafName === '.' || leafName === '..') return null;
    const fileName = path.extname(leafName) ? leafName : `${leafName}.json`;
    const fullPath = path.resolve(BASE_DIR, fileName);
    return fs.existsSync(fullPath) ? fullPath : null;
}

// ── Auth ─────────────────────────────────────────────────────────────────────

const DEMO_ACCOUNTS = {
    'mehadi': 'Kx9#mP2vL8qR',
    'annoor': 'Zt4$nW7jF3xY',
    'lina': 'Bv6&hQ9sM1kE',
    'rar': 'Gp3*rT8cN5wA',
    'dipto': 'Jm7@uV2bX4zD',
    'sta': 'Qw5!yH8fK9pL',
    'mrk': 'Cx2%eR6gJ7nM',
    'fa': 'Fs4^iO1tY3vB',
    'demo': 'Nz8&aU5hW2qS'
};

const sessions = new Map();

app.use(express.json());

function requireAuth(req, res, next) {
    const sessionId = req.headers['x-session-id'];
    if (DEBUG) {
        console.log(`Auth check - Session ID: ${sessionId}, exists: ${sessions.has(sessionId)}`);
    }
    if (!sessionId || !sessions.has(sessionId)) {
        return res.status(401).json({ error: 'Authentication required' });
    }
    next();
}

// ── Static files ─────────────────────────────────────────────────────────────

app.use('/static', express.static(path.join(__dirname, 'public'), {
    setHeaders: (res, filePath) => {
        if (filePath.endsWith('.html') || filePath.endsWith('.css') || filePath.endsWith('.js')) {
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
            res.setHeader('Pragma', 'no-cache');
            res.setHeader('Expires', '0');
        }
    }
}));

// ── Audio streaming ──────────────────────────────────────────────────────────

app.get('/audio/*', (req, res) => {
    const sessionId = req.query.session || req.headers['x-session-id'];
    if (!sessionId || !sessions.has(sessionId)) {
        return res.status(401).json({ error: 'Authentication required' });
    }

    const filePath = req.params[0];
    const decodedPath = decodeURIComponent(filePath);
    const fullPath = resolveAudioPathFromRequest(decodedPath);

    try {
        if (!fullPath) return res.status(404).json({ error: 'File not found' });

        const ext = path.extname(fullPath).toLowerCase();
        const contentTypes = {
            '.flac': 'audio/flac', '.wav': 'audio/wav', '.mp3': 'audio/mpeg',
            '.m4a': 'audio/mp4', '.ogg': 'audio/ogg'
        };
        const contentType = contentTypes[ext] || 'audio/octet-stream';
        const stat = fs.statSync(fullPath);
        const fileSize = stat.size;
        const range = req.headers.range;

        if (range) {
            const parts = range.replace(/bytes=/, '').split('-');
            const start = parseInt(parts[0], 10);
            const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
            const chunksize = end - start + 1;
            const file = fs.createReadStream(fullPath, { start, end });
            res.writeHead(206, {
                'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                'Accept-Ranges': 'bytes',
                'Content-Length': chunksize,
                'Content-Type': contentType,
            });
            file.pipe(res);
        } else {
            res.writeHead(200, {
                'Content-Length': fileSize,
                'Content-Type': contentType,
                'Accept-Ranges': 'bytes',
            });
            fs.createReadStream(fullPath).pipe(res);
        }
    } catch (error) {
        console.error('Audio serving error:', error);
        res.status(500).json({ error: 'Failed to serve audio file' });
    }
});

// ── Login / Logout ───────────────────────────────────────────────────────────

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password required' });
    }

    if (DEMO_ACCOUNTS[username] && DEMO_ACCOUNTS[username] === password) {
        const sessionId = Math.random().toString(36).substring(2) + Date.now().toString(36);
        sessions.set(sessionId, { username, loginTime: new Date() });
        if (DEBUG) console.log(`Login OK - User: ${username}, Session: ${sessionId}`);
        res.json({ success: true, sessionId, username });
    } else {
        res.status(401).json({ error: 'Invalid username or password' });
    }
});

app.post('/api/logout', (req, res) => {
    const sessionId = req.headers['x-session-id'];
    if (sessionId) sessions.delete(sessionId);
    res.json({ success: true });
});

// ── Browse ───────────────────────────────────────────────────────────────────

app.get('/api/browse', requireAuth, (req, res) => {
    const relativePath = normalizePath(decodeURIComponent(req.query.path || ''));

    try {
        if (!relativePath) {
            return res.json({
                currentPath: '',
                items: splitFolders.map(folder => ({
                    name: folder,
                    type: 'folder',
                    path: folder,
                    fileCount: splitData[folder].length,
                    savedCount: countSavedAnnotations(folder)
                }))
            });
        }

        if (!splitFolders.includes(relativePath)) {
            return res.status(404).json({ error: 'Folder not found' });
        }

        const rows = splitData[relativePath];
        const clipItems = rows.map(row => {
            const audioFile = resolveAudioFileName(row.key);
            return {
                name: row.key,
                type: 'audio',
                path: normalizePath(`${relativePath}/${row.key}`),
                audioFile,
                jsonFile: `${row.key}.json`,
                splitFolder: relativePath,
                saved: isAnnotationSaved(relativePath, row.key),
                wer: row.WER,
            };
        });

        res.json({
            currentPath: relativePath,
            items: clipItems,
            totalCount: clipItems.length,
            savedCount: countSavedAnnotations(relativePath)
        });
    } catch (error) {
        console.error('Browse error:', error);
        res.status(500).json({ error: 'Failed to load sample list: ' + error.message });
    }
});

// ── Sample metadata from CSV ─────────────────────────────────────────────────

app.get('/api/sample-meta', requireAuth, (req, res) => {
    const clipId = decodeURIComponent(req.query.clipId || '');
    if (!clipId) return res.status(400).json({ error: 'clipId is required' });

    const row = metadataMap.get(clipId);
    if (!row) return res.status(404).json({ error: 'Clip not found in metadata' });

    res.json({
        wer: row.WER,
        cer: row.CER,
        snr_vad: row.snr_vad,
        unique_words: row.unique_words,
        silence_percentage: row.silence_percentage,
        transcript: row.Transcript || '',
        elevenLabs: row.ElevenLabs || '',
    });
});

// ── Transcript (JSON on disk, fallback to CSV) ──────────────────────────────

app.get('/api/transcript', requireAuth, (req, res) => {
    const filePath = req.query.file;
    if (!filePath) return res.status(400).json({ error: 'File path required' });

    const decodedPath = decodeURIComponent(filePath);
    const fullPath = resolveTranscriptPathFromRequest(decodedPath);

    try {
        if (fullPath) {
            const content = fs.readFileSync(fullPath, 'utf8');
            const jsonData = JSON.parse(content);
            return res.json(jsonData);
        }

        // Fallback: serve transcript from CSV metadata
        const leafName = path.basename(decodedPath, '.json');
        const row = metadataMap.get(leafName);
        if (row && row.Transcript) {
            return res.json({
                text: row.Transcript,
                source: 'csv'
            });
        }

        return res.status(404).json({ error: 'Transcript not found' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to read transcript file' });
    }
});

// ── Debug ────────────────────────────────────────────────────────────────────

app.get('/api/debug', requireAuth, (req, res) => {
    const relativePath = decodeURIComponent(req.query.path || '');
    const windowsPath = relativePath.replace(/\//g, path.sep);
    const fullPath = path.resolve(BASE_DIR, windowsPath);

    try {
        if (!fs.existsSync(fullPath)) {
            return res.status(404).json({ error: 'Directory not found' });
        }
        const items = fs.readdirSync(fullPath, { withFileTypes: true });
        const debug = { path: fullPath, totalItems: items.length, directories: [], files: [] };
        items.forEach(item => {
            if (item.isDirectory()) {
                debug.directories.push(item.name);
            } else {
                const stats = fs.statSync(path.join(fullPath, item.name));
                debug.files.push({ name: item.name, size: stats.size, extension: path.extname(item.name).toLowerCase() });
            }
        });
        res.json(debug);
    } catch (error) {
        res.status(500).json({ error: 'Debug failed: ' + error.message });
    }
});

// ── Absolute path ────────────────────────────────────────────────────────────

app.get('/api/absolutePath', requireAuth, (req, res) => {
    const filePath = req.query.file;
    if (!filePath) return res.status(400).json({ error: 'File path required' });

    const decodedPath = decodeURIComponent(filePath);
    const resolvedAudioPath = resolveAudioPathFromRequest(decodedPath);
    const normalizedPath = resolvedAudioPath
        ? normalizePath(path.basename(resolvedAudioPath))
        : normalizePath(path.basename(decodedPath));

    res.json({ absolutePath: normalizedPath });
});

// ── Annotations ──────────────────────────────────────────────────────────────

app.post('/api/annotation', requireAuth, (req, res) => {
    const sessionId = req.headers['x-session-id'];
    const session = sessions.get(sessionId);
    const username = session?.username || 'unknown';
    const { splitFolder, clipId, audioFile, jsonFile, duration, text, evaluation } = req.body || {};

    if (!splitFolder || !clipId || !evaluation || typeof evaluation !== 'object') {
        return res.status(400).json({ error: 'splitFolder, clipId, and evaluation are required' });
    }

    if (!splitFolders.includes(splitFolder)) {
        return res.status(400).json({ error: 'Invalid splitFolder' });
    }

    if (!splitSets[splitFolder].has(clipId)) {
        return res.status(400).json({ error: 'clipId does not belong to this split folder' });
    }

    try {
        const folderPath = path.join(ANNOTATIONS_ROOT, splitFolder);
        fs.mkdirSync(folderPath, { recursive: true });

        const row = metadataMap.get(clipId);
        const outputPath = path.join(folderPath, `${clipId}.json`);
        const payload = {
            splitFolder,
            clipId,
            audioFile: audioFile || null,
            jsonFile: jsonFile || null,
            duration: duration || null,
            text: text || '',
            wer: row?.WER ?? null,
            cer: row?.CER ?? null,
            evaluation,
            savedBy: username,
            savedAt: new Date().toISOString()
        };

        fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2), 'utf8');
        res.json({ success: true, file: outputPath });
    } catch (error) {
        console.error('Annotation save error:', error);
        res.status(500).json({ error: 'Failed to save annotation' });
    }
});

app.get('/api/annotation', requireAuth, (req, res) => {
    const splitFolder = normalizePath(decodeURIComponent(req.query.splitFolder || ''));
    const clipId = decodeURIComponent(req.query.clipId || '');

    if (!splitFolder || !clipId) {
        return res.status(400).json({ error: 'splitFolder and clipId are required' });
    }

    if (!splitFolders.includes(splitFolder)) {
        return res.status(400).json({ error: 'Invalid splitFolder' });
    }

    if (!splitSets[splitFolder].has(clipId)) {
        return res.status(400).json({ error: 'clipId does not belong to this split folder' });
    }

    try {
        const annotationPath = path.join(ANNOTATIONS_ROOT, splitFolder, `${clipId}.json`);
        if (!fs.existsSync(annotationPath)) {
            return res.json({ saved: false });
        }

        const content = fs.readFileSync(annotationPath, 'utf8');
        const annotation = JSON.parse(content);
        return res.json({ saved: true, annotation });
    } catch (error) {
        console.error('Annotation load error:', error);
        return res.status(500).json({ error: 'Failed to load annotation' });
    }
});

// ── HTML pages ───────────────────────────────────────────────────────────────

app.get('/', (req, res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/login.html', (req, res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.listen(PORT, () => {
    console.log(`Audio file server running at http://localhost:${PORT}`);
    console.log(`Serving files from: ${BASE_DIR}`);
    console.log(`Splits: ${splitFolders.join(', ')}`);
});
