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

// Helper function to normalize paths to forward slashes consistently
function normalizePath(pathStr) {
    if (!pathStr) return '';
    return pathStr
        .replace(/\\/g, '/')           // Convert backslashes to forward slashes
        .replace(/\/+/g, '/')          // Replace multiple consecutive slashes with single slash
        .replace(/^\//, '')            // Remove leading slash if present
        .replace(/\/$/, '');           // Remove trailing slash if present
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

// Serve static files (CSS, JS, audio files)
app.use('/static', express.static(path.join(__dirname, 'public')));

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
    const windowsPath = decodedPath.replace(/\//g, path.sep);
    const fullPath = path.resolve(BASE_DIR, windowsPath);

    try {
        // Security check: ensure the resolved path is within BASE_DIR
        const normalizedBase = path.resolve(BASE_DIR);
        const normalizedFull = path.resolve(fullPath);

        if (!normalizedFull.startsWith(normalizedBase)) {
            return res.status(403).json({ error: 'Access denied: Path outside base directory' });
        }

        if (!fs.existsSync(fullPath)) {
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
    const relativePath = decodeURIComponent(req.query.path || '');
    // Convert forward slashes to Windows path separators
    const windowsPath = relativePath.replace(/\//g, path.sep);
    const fullPath = path.resolve(BASE_DIR, windowsPath);

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
                const itemPath = normalizePath(relativePath ? `${relativePath}/${item.name}` : item.name);

                // Count files in this directory
                const dirFullPath = path.join(fullPath, item.name);
                let fileCount = 0;
                try {
                    const dirItems = fs.readdirSync(dirFullPath, { withFileTypes: true });
                    fileCount = dirItems.filter(dirItem => dirItem.isFile()).length;
                } catch (error) {
                    // If we can't read the directory, set count to 0
                    fileCount = 0;
                }

                result.items.push({
                    name: item.name,
                    type: 'folder',
                    path: itemPath,
                    fileCount: fileCount
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

        // Debug logging (only in debug mode)
        if (DEBUG) {
            console.log(`\n=== DIRECTORY SCAN ===`);
            console.log(`Original relative path: "${relativePath}"`);
            console.log(`Windows path: "${windowsPath}"`);
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
        }

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

            const audioPath = normalizePath(relativePath ? `${relativePath}/${audioFile}` : audioFile);
            const jsonPath = matchingJson ? normalizePath(relativePath ? `${relativePath}/${matchingJson}` : matchingJson) : null;

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

    // Convert the path to the desired format: collect/read/YouTube/Sangsad TV/496k9w8hY2c/filename.flac
    // Use helper function to ensure consistent forward slash format
    const normalizedPath = normalizePath(decodedPath);

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
    const windowsPath = decodedPath.replace(/\//g, path.sep);
    const fullPath = path.resolve(BASE_DIR, windowsPath);

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