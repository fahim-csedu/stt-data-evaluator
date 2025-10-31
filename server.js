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
const BASE_DIR = path.join(__dirname, 'data');

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
    const relativePath = req.query.path || '';
    const fullPath = path.join(BASE_DIR, relativePath);

    try {
        if (!fs.existsSync(fullPath)) {
            return res.status(404).json({ error: 'Directory not found' });
        }

        const items = fs.readdirSync(fullPath, { withFileTypes: true });
        const result = {
            currentPath: relativePath,
            items: []
        };

        // First, collect all files and group by UUID
        const audioFiles = [];
        const jsonFiles = [];

        items.forEach(item => {
            if (item.isDirectory()) {
                result.items.push({
                    name: item.name,
                    type: 'folder',
                    path: path.join(relativePath, item.name).replace(/\\/g, '/')
                });
            } else if (item.name.endsWith('.flac')) {
                audioFiles.push(item.name);
            } else if (item.name.endsWith('.json')) {
                jsonFiles.push(item.name);
            }
        });

        // Match audio files with their corresponding JSON files by UUID
        audioFiles.forEach(audioFile => {
            // Extract UUID from filename (everything after the first underscore)
            const uuidMatch = audioFile.match(/_(.+)\.flac$/);
            if (uuidMatch) {
                const uuid = uuidMatch[1];

                // Find matching JSON file with same UUID
                const matchingJson = jsonFiles.find(jsonFile => jsonFile.includes(uuid));

                const baseName = audioFile.replace('.flac', '');

                result.items.push({
                    name: baseName,
                    type: 'audio',
                    audioFile: path.join(relativePath, audioFile).replace(/\\/g, '/'),
                    jsonFile: matchingJson ? path.join(relativePath, matchingJson).replace(/\\/g, '/') : null,
                    path: path.join(relativePath, audioFile).replace(/\\/g, '/')
                });
            }
        });

        res.json(result);
    } catch (error) {
        res.status(500).json({ error: 'Failed to read directory' });
    }
});

// API endpoint to get absolute path
app.get('/api/absolutePath', requireAuth, (req, res) => {
    const filePath = req.query.file;
    if (!filePath) {
        return res.status(400).json({ error: 'File path required' });
    }

    const fullPath = path.join(BASE_DIR, filePath);
    res.json({ absolutePath: fullPath });
});

// API endpoint to get JSON content
app.get('/api/transcript', requireAuth, (req, res) => {
    const filePath = req.query.file;
    if (!filePath) {
        return res.status(400).json({ error: 'File path required' });
    }

    const fullPath = path.join(BASE_DIR, filePath);

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