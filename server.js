const express = require('express');
const path = require('path');
const fs = require('fs');

// Load configuration
let config;
try {
    // Try to load local config first (for development)
    config = require('./config.local.js');
    console.log('Using local configuration');
} catch (error) {
    // Fall back to default config (for production)
    config = require('./config.js');
    console.log('Using default configuration');
}

const app = express();
const { BASE_DIR, PORT, SESSION_TIMEOUT, DEBUG } = config;
const AUDIO_EXTENSIONS = ['.flac', '.wav', '.mp3', '.m4a', '.ogg'];
const EVALUATION_SAMPLE_CSV = path.join(__dirname, 'MANUAL_EVALUATION_SAMPLE_500_DEDUP.csv');
const SPLIT_FOLDERS = ['nusrat', 'marzan'];
const ANNOTATIONS_ROOT = path.join(__dirname, 'annotations');

// Helper function to normalize paths to forward slashes consistently
function normalizePath(pathStr) {
    if (!pathStr) return '';
    return pathStr
        .replace(/\\/g, '/')           // Convert backslashes to forward slashes
        .replace(/\/+/g, '/')          // Replace multiple consecutive slashes with single slash
        .replace(/^\//, '')            // Remove leading slash if present
        .replace(/\/$/, '');           // Remove trailing slash if present
}

function parseCsvFirstField(line) {
    let value = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
            inQuotes = !inQuotes;
            continue;
        }
        if (ch === ',' && !inQuotes) {
            break;
        }
        value += ch;
    }
    return value.trim();
}

function loadEvaluationManifest() {
    if (!fs.existsSync(EVALUATION_SAMPLE_CSV)) {
        throw new Error(`Manifest CSV not found: ${EVALUATION_SAMPLE_CSV}`);
    }

    const raw = fs.readFileSync(EVALUATION_SAMPLE_CSV, 'utf8');
    const lines = raw.split(/\r?\n/).filter(line => line.trim().length > 0);
    const seen = new Set();
    const fileIds = [];

    for (let i = 1; i < lines.length; i++) {
        const id = parseCsvFirstField(lines[i]);
        if (id && !seen.has(id)) {
            seen.add(id);
            fileIds.push(id);
        }
    }

    if (fileIds.length === 0) {
        throw new Error(`No valid file_id entries found in ${EVALUATION_SAMPLE_CSV}`);
    }

    const splitIndex = Math.ceil(fileIds.length / 2);

    return {
        nusrat: fileIds.slice(0, splitIndex),
        marzan: fileIds.slice(splitIndex)
    };
}

const evaluationManifest = loadEvaluationManifest();
const manifestSetByFolder = {
    nusrat: new Set(evaluationManifest.nusrat),
    marzan: new Set(evaluationManifest.marzan)
};
const audioFileNameCache = new Map();

function isAnnotationSaved(splitFolder, clipId) {
    const annotationPath = path.join(ANNOTATIONS_ROOT, splitFolder, `${clipId}.json`);
    return fs.existsSync(annotationPath);
}

function resolveAudioFileName(fileId) {
    if (audioFileNameCache.has(fileId)) {
        return audioFileNameCache.get(fileId);
    }

    // Manifest is file-id based; default to .flac when extension is absent.
    const resolved = path.extname(fileId) ? fileId : `${fileId}.flac`;

    audioFileNameCache.set(fileId, resolved);
    return resolved;
}

function resolveAudioPathFromRequest(requestPath) {
    const normalized = normalizePath(requestPath);
    const leafName = path.basename(normalized);

    if (!leafName || leafName === '.' || leafName === '..') {
        return null;
    }

    if (path.extname(leafName)) {
        const directPath = path.resolve(BASE_DIR, leafName);
        if (fs.existsSync(directPath)) {
            return directPath;
        }
        return null;
    }

    for (const ext of AUDIO_EXTENSIONS) {
        const candidate = path.resolve(BASE_DIR, `${leafName}${ext}`);
        if (fs.existsSync(candidate)) {
            return candidate;
        }
    }

    return null;
}

function resolveTranscriptPathFromRequest(requestPath) {
    const normalized = normalizePath(requestPath);
    const leafName = path.basename(normalized);

    if (!leafName || leafName === '.' || leafName === '..') {
        return null;
    }

    const fileName = path.extname(leafName) ? leafName : `${leafName}.json`;
    const fullPath = path.resolve(BASE_DIR, fileName);
    return fs.existsSync(fullPath) ? fullPath : null;
}

// Demo accounts with secure random passwords
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

// Simple session storage (in production, use proper session management)
const sessions = new Map();

// Middleware to parse JSON
app.use(express.json());

// Authentication middleware
function requireAuth(req, res, next) {
    const sessionId = req.headers['x-session-id'];

    if (DEBUG) {
        console.log(`Auth check - Session ID: ${sessionId}`);
        console.log(`Active sessions: ${sessions.size}`);
        console.log(`Session exists: ${sessions.has(sessionId)}`);
    }

    if (!sessionId || !sessions.has(sessionId)) {
        if (DEBUG) {
            console.log(`Authentication failed for session: ${sessionId}`);
        }
        return res.status(401).json({ error: 'Authentication required' });
    }
    next();
}

// Serve static files (CSS, JS, audio files) with cache control
app.use('/static', express.static(path.join(__dirname, 'public'), {
    setHeaders: (res, path) => {
        // Disable caching for HTML, CSS, and JS files to ensure users get updates
        if (path.endsWith('.html') || path.endsWith('.css') || path.endsWith('.js')) {
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
            res.setHeader('Pragma', 'no-cache');
            res.setHeader('Expires', '0');
        }
    }
}));

// Custom audio file serving with authentication
app.get('/audio/*', (req, res) => {
    // Check authentication via query parameter or header
    const sessionId = req.query.session || req.headers['x-session-id'];

    if (!sessionId || !sessions.has(sessionId)) {
        return res.status(401).json({ error: 'Authentication required' });
    }

    // Get the file path from the URL
    const filePath = req.params[0];
    const decodedPath = decodeURIComponent(filePath);
    const fullPath = resolveAudioPathFromRequest(decodedPath);

    try {
        if (!fullPath) {
            return res.status(404).json({ error: 'File not found' });
        }

        // Determine content type based on file extension
        const ext = path.extname(fullPath).toLowerCase();
        const contentTypes = {
            '.flac': 'audio/flac',
            '.wav': 'audio/wav',
            '.mp3': 'audio/mpeg',
            '.m4a': 'audio/mp4',
            '.ogg': 'audio/ogg'
        };
        const contentType = contentTypes[ext] || 'audio/octet-stream';

        // Set appropriate headers for audio streaming
        const stat = fs.statSync(fullPath);
        const fileSize = stat.size;
        const range = req.headers.range;

        if (range) {
            // Handle range requests for audio seeking
            const parts = range.replace(/bytes=/, "").split("-");
            const start = parseInt(parts[0], 10);
            const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
            const chunksize = (end - start) + 1;
            const file = fs.createReadStream(fullPath, { start, end });
            const head = {
                'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                'Accept-Ranges': 'bytes',
                'Content-Length': chunksize,
                'Content-Type': contentType,
            };
            res.writeHead(206, head);
            file.pipe(res);
        } else {
            // Serve the entire file
            const head = {
                'Content-Length': fileSize,
                'Content-Type': contentType,
                'Accept-Ranges': 'bytes',
            };
            res.writeHead(200, head);
            fs.createReadStream(fullPath).pipe(res);
        }
    } catch (error) {
        console.error('Audio serving error:', error);
        res.status(500).json({ error: 'Failed to serve audio file' });
    }
});

// Login endpoint
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password required' });
    }

    if (DEMO_ACCOUNTS[username] && DEMO_ACCOUNTS[username] === password) {
        // Generate session ID
        const sessionId = Math.random().toString(36).substring(2) + Date.now().toString(36);
        sessions.set(sessionId, { username, loginTime: new Date() });

        if (DEBUG) {
            console.log(`Login successful - User: ${username}, Session: ${sessionId}`);
            console.log(`Total active sessions: ${sessions.size}`);
        }

        res.json({ success: true, sessionId, username });
    } else {
        if (DEBUG) {
            console.log(`Login failed - User: ${username}`);
        }
        res.status(401).json({ error: 'Invalid username or password' });
    }
});

// Logout endpoint
app.post('/api/logout', (req, res) => {
    const sessionId = req.headers['x-session-id'];
    if (sessionId) {
        sessions.delete(sessionId);
    }
    res.json({ success: true });
});

// API endpoint to get directory contents
app.get('/api/browse', requireAuth, (req, res) => {
    const relativePath = normalizePath(decodeURIComponent(req.query.path || ''));

    try {
        if (!relativePath) {
            return res.json({
                currentPath: '',
                items: SPLIT_FOLDERS.map(folder => ({
                    name: folder,
                    type: 'folder',
                    path: folder,
                    fileCount: evaluationManifest[folder].length
                }))
            });
        }

        if (!SPLIT_FOLDERS.includes(relativePath)) {
            return res.status(404).json({ error: 'Folder not found' });
        }

        const clipItems = evaluationManifest[relativePath].map(fileId => {
            const audioFile = resolveAudioFileName(fileId);
            return {
                name: fileId,
                type: 'audio',
                path: normalizePath(`${relativePath}/${fileId}`),
                audioFile,
                jsonFile: `${fileId}.json`,
                splitFolder: relativePath,
                saved: isAnnotationSaved(relativePath, fileId)
            };
        });

        res.json({
            currentPath: relativePath,
            items: clipItems
        });
    } catch (error) {
        console.error('Browse error:', error);
        res.status(500).json({ error: 'Failed to load sample list: ' + error.message });
    }
});

// Debug endpoint to list all files in directory (remove in production)
app.get('/api/debug', requireAuth, (req, res) => {
    const relativePath = decodeURIComponent(req.query.path || '');
    const windowsPath = relativePath.replace(/\//g, path.sep);
    const fullPath = path.resolve(BASE_DIR, windowsPath);

    try {
        if (!fs.existsSync(fullPath)) {
            return res.status(404).json({ error: 'Directory not found' });
        }

        const items = fs.readdirSync(fullPath, { withFileTypes: true });
        const debug = {
            path: fullPath,
            totalItems: items.length,
            directories: [],
            files: []
        };

        items.forEach(item => {
            if (item.isDirectory()) {
                debug.directories.push(item.name);
            } else {
                const stats = fs.statSync(path.join(fullPath, item.name));
                debug.files.push({
                    name: item.name,
                    size: stats.size,
                    extension: path.extname(item.name).toLowerCase()
                });
            }
        });

        res.json(debug);
    } catch (error) {
        res.status(500).json({ error: 'Debug failed: ' + error.message });
    }
});

// API endpoint to get absolute path
app.get('/api/absolutePath', requireAuth, (req, res) => {
    const filePath = req.query.file;
    if (!filePath) {
        return res.status(400).json({ error: 'File path required' });
    }

    const decodedPath = decodeURIComponent(filePath);
    const resolvedAudioPath = resolveAudioPathFromRequest(decodedPath);
    const normalizedPath = resolvedAudioPath
        ? normalizePath(path.basename(resolvedAudioPath))
        : normalizePath(path.basename(decodedPath));

    // Debug logging
    if (DEBUG) {
        console.log('AbsolutePath Debug:', {
            originalFile: filePath,
            decodedPath: decodedPath,
            normalizedPath: normalizedPath
        });
    }

    res.json({ absolutePath: normalizedPath });
});

// API endpoint to get JSON content
app.get('/api/transcript', requireAuth, (req, res) => {
    const filePath = req.query.file;
    if (!filePath) {
        return res.status(400).json({ error: 'File path required' });
    }

    const decodedPath = decodeURIComponent(filePath);
    const fullPath = resolveTranscriptPathFromRequest(decodedPath);

    try {
        if (!fullPath) {
            return res.status(404).json({ error: 'File not found' });
        }

        const content = fs.readFileSync(fullPath, 'utf8');
        const jsonData = JSON.parse(content);
        res.json(jsonData);
    } catch (error) {
        res.status(500).json({ error: 'Failed to read transcript file' });
    }
});

// Save annotation by split folder
app.post('/api/annotation', requireAuth, (req, res) => {
    const sessionId = req.headers['x-session-id'];
    const session = sessions.get(sessionId);
    const username = session?.username || 'unknown';
    const { splitFolder, clipId, audioFile, jsonFile, duration, text, evaluation } = req.body || {};

    if (!splitFolder || !clipId || !evaluation || typeof evaluation !== 'object') {
        return res.status(400).json({ error: 'splitFolder, clipId, and evaluation are required' });
    }

    if (!SPLIT_FOLDERS.includes(splitFolder)) {
        return res.status(400).json({ error: 'Invalid splitFolder' });
    }

    if (!manifestSetByFolder[splitFolder].has(clipId)) {
        return res.status(400).json({ error: 'clipId does not belong to this split folder' });
    }

    try {
        const folderPath = path.join(ANNOTATIONS_ROOT, splitFolder);
        fs.mkdirSync(folderPath, { recursive: true });

        const outputPath = path.join(folderPath, `${clipId}.json`);
        const payload = {
            splitFolder,
            clipId,
            audioFile: audioFile || null,
            jsonFile: jsonFile || null,
            duration: duration || null,
            text: text || '',
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

// Get saved annotation by split folder and clip
app.get('/api/annotation', requireAuth, (req, res) => {
    const splitFolder = normalizePath(decodeURIComponent(req.query.splitFolder || ''));
    const clipId = decodeURIComponent(req.query.clipId || '');

    if (!splitFolder || !clipId) {
        return res.status(400).json({ error: 'splitFolder and clipId are required' });
    }

    if (!SPLIT_FOLDERS.includes(splitFolder)) {
        return res.status(400).json({ error: 'Invalid splitFolder' });
    }

    if (!manifestSetByFolder[splitFolder].has(clipId)) {
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

// Serve the main HTML page (protected) with no-cache headers
app.get('/', (req, res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Serve login page with no-cache headers
app.get('/login.html', (req, res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.listen(PORT, () => {
    console.log(`Audio file server running at http://localhost:${PORT}`);
    console.log(`Serving files from: ${BASE_DIR}`);
});
