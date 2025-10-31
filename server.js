const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 3000;

// Configure the base directory - you can change this path
const BASE_DIR = 'D:\\STT D3\\STT D3\\deliverables3\\';

// Serve static files (CSS, JS, audio files)
app.use('/static', express.static(path.join(__dirname, 'public')));
app.use('/audio', express.static(BASE_DIR));

// API endpoint to get directory contents
app.get('/api/browse', (req, res) => {
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
        
        items.forEach(item => {
            if (item.isDirectory()) {
                result.items.push({
                    name: item.name,
                    type: 'folder',
                    path: path.join(relativePath, item.name).replace(/\\/g, '/')
                });
            } else if (item.name.endsWith('.flac')) {
                const baseName = item.name.replace('.flac', '');
                const jsonFile = baseName + '.json';
                const jsonPath = path.join(fullPath, jsonFile);
                
                result.items.push({
                    name: baseName,
                    type: 'audio',
                    audioFile: path.join(relativePath, item.name).replace(/\\/g, '/'),
                    jsonFile: fs.existsSync(jsonPath) ? path.join(relativePath, jsonFile).replace(/\\/g, '/') : null,
                    path: path.join(relativePath, item.name).replace(/\\/g, '/')
                });
            }
        });
        
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: 'Failed to read directory' });
    }
});

// API endpoint to get JSON content
app.get('/api/transcript', (req, res) => {
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

// Serve the main HTML page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Audio file server running at http://localhost:${PORT}`);
    console.log(`Serving files from: ${BASE_DIR}`);
});