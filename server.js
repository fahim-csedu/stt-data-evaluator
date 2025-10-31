const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 3002;

// Demo accounts with secure random passwords
const DEMO_ACCOUNTS = {
    'mehadi': 'Kx9#mP2vL8qR',
    'annoor': 'Zt4$nW7jF3xY',
    'lina': 'Bv6&hQ9sM1kE',
    'rar': 'Gp3*rT8cN5wA',
    'dipto': 'Jm7@uV2bX4zD',
    'sta': 'Qw5!yH8fK9pL',
    'rkr': 'Cx2%eR6gJ7nM',
    'fa': 'Fs4^iO1tY3vB',
    'demo': 'Nz8&aU5hW2qS'
};

// Simple session storage (in production, use proper session management)
const sessions = new Map();

// Middleware to parse JSON
app.use(express.json());

// Configure the base directory - you can change this path
const BASE_DIR = 'D:\\STT D3\\STT D3\\deliverables3\\';

// Authentication middleware
function requireAuth(req, res, next) {
    const sessionId = req.headers['x-session-id'];
    if (!sessionId || !sessions.has(sessionId)) {
        return res.status(401).json({ error: 'Authentication required' });
    }
    next();
}

// Serve static files (CSS, JS, audio files)
app.use('/static', express.static(path.join(__dirname, 'public')));
app.use('/audio', requireAuth, express.static(BASE_DIR));

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

        res.json({ success: true, sessionId, username });
    } else {
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
    const relativePath = decodeURIComponent(req.query.path || '');
    const fullPath = path.resolve(BASE_DIR, relativePath);

    try {
        // Security check: ensure the resolved path is within BASE_DIR
        const normalizedBase = path.resolve(BASE_DIR);
        const normalizedFull = path.resolve(fullPath);

        if (!normalizedFull.startsWith(normalizedBase)) {
            return res.status(403).json({ error: 'Access denied: Path outside base directory' });
        }

        if (!fs.existsSync(fullPath)) {
            return res.status(404).json({ error: `Directory not found: ${fullPath}` });
        }

        const items = fs.readdirSync(fullPath, { withFileTypes: true });
        const result = {
            currentPath: relativePath,
            items: []
        };

        // Collect all files by type
        const audioFiles = [];
        const jsonFiles = [];
        const allFiles = [];

        items.forEach(item => {
            if (item.isDirectory()) {
                // Use forward slashes for web paths, but handle Windows paths properly
                const itemPath = relativePath ? `${relativePath}/${item.name}` : item.name;
                result.items.push({
                    name: item.name,
                    type: 'folder',
                    path: itemPath
                });
            } else {
                allFiles.push(item.name);

                // Support multiple audio formats
                if (item.name.match(/\.(flac|wav|mp3|m4a|ogg)$/i)) {
                    audioFiles.push(item.name);
                } else if (item.name.endsWith('.json')) {
                    jsonFiles.push(item.name);
                }
            }
        });

        // Debug logging
        console.log(`\n=== DIRECTORY SCAN ===`);
        console.log(`Relative path: "${relativePath}"`);
        console.log(`Full path: "${fullPath}"`);
        console.log(`Directory exists: ${fs.existsSync(fullPath)}`);
        console.log(`All files found: ${allFiles.length}`);
        if (allFiles.length > 0) {
            console.log(`Files:`, allFiles);
        }
        console.log(`Audio files found: ${audioFiles.length}`);
        if (audioFiles.length > 0) {
            console.log(`Audio files:`, audioFiles);
        }
        console.log(`JSON files found: ${jsonFiles.length}`);
        if (jsonFiles.length > 0) {
            console.log(`JSON files:`, jsonFiles);
        }
        console.log(`======================\n`);

        // Process audio files with flexible matching
        audioFiles.forEach(audioFile => {
            const baseName = audioFile.replace(/\.(flac|wav|mp3|m4a|ogg)$/i, '');
            let matchingJson = null;

            // Try different matching strategies
            // 1. Exact base name match
            matchingJson = jsonFiles.find(jsonFile => jsonFile === baseName + '.json');

            // 2. If no exact match, try UUID-based matching (for files with timestamps)
            if (!matchingJson) {
                const uuidMatch = audioFile.match(/_([a-f0-9-]{36})\.(flac|wav|mp3|m4a|ogg)$/i);
                if (uuidMatch) {
                    const uuid = uuidMatch[1];
                    matchingJson = jsonFiles.find(jsonFile => jsonFile.includes(uuid));
                }
            }

            // 3. If still no match, try partial name matching
            if (!matchingJson) {
                matchingJson = jsonFiles.find(jsonFile => {
                    const jsonBase = jsonFile.replace('.json', '');
                    return baseName.includes(jsonBase) || jsonBase.includes(baseName);
                });
            }

            const audioPath = relativePath ? `${relativePath}/${audioFile}` : audioFile;
            const jsonPath = matchingJson ? (relativePath ? `${relativePath}/${matchingJson}` : matchingJson) : null;

            result.items.push({
                name: baseName,
                type: 'audio',
                audioFile: audioPath,
                jsonFile: jsonPath,
                path: audioPath
            });
        });

        console.log(`Final items count: ${result.items.length}`);
        res.json(result);
    } catch (error) {
        console.error('Browse error:', error);
        res.status(500).json({ error: 'Failed to read directory: ' + error.message });
    }
});

// Debug endpoint to list all files in directory (remove in production)
app.get('/api/debug', requireAuth, (req, res) => {
    const relativePath = decodeURIComponent(req.query.path || '');
    const fullPath = path.resolve(BASE_DIR, relativePath);

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
    const fullPath = path.resolve(BASE_DIR, decodedPath);
    res.json({ absolutePath: fullPath });
});

// API endpoint to get JSON content
app.get('/api/transcript', requireAuth, (req, res) => {
    const filePath = req.query.file;
    if (!filePath) {
        return res.status(400).json({ error: 'File path required' });
    }

    const decodedPath = decodeURIComponent(filePath);
    const fullPath = path.resolve(BASE_DIR, decodedPath);

    try {
        if (!fs.existsSync(fullPath)) {
            return res.status(404).json({ error: 'File not found' });
        }

        const content = fs.readFileSync(fullPath, 'utf8');
        const jsonData = JSON.parse(content);
        res.json(jsonData);
    } catch (error) {
        res.status(500).json({ error: 'Failed to read transcript file' });
    }
});

// Serve the main HTML page (protected)
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Serve login page
app.get('/login.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.listen(PORT, () => {
    console.log(`Audio file server running at http://localhost:${PORT}`);
    console.log(`Serving files from: ${BASE_DIR}`);
});