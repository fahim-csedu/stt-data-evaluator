class AudioFileBrowser {
    constructor() {
        this.currentPath = '';
        this.pathHistory = [];
        this.selectedFile = null;
        this.currentTranscript = null;
        this.bookmarks = this.loadBookmarks();
        
        this.initializeElements();
        this.bindEvents();
        this.loadDirectory('');
        this.updateBookmarkSelect();
    }
    
    initializeElements() {
        this.fileList = document.getElementById('fileList');
        this.backBtn = document.getElementById('backBtn');
        this.currentPathSpan = document.getElementById('currentPath');
        this.breadcrumb = document.getElementById('breadcrumb');
        this.audioPlayer = document.getElementById('audioPlayer');
        this.currentFileSpan = document.getElementById('currentFile');
        this.transcriptContent = document.getElementById('transcriptContent');
        this.bookmarkBtn = document.getElementById('bookmarkBtn');
        this.bookmarkSelect = document.getElementById('bookmarkSelect');
        this.copyBtn = document.getElementById('copyBtn');
    }
    
    bindEvents() {
        this.backBtn.addEventListener('click', () => this.goBack());
        this.bookmarkBtn.addEventListener('click', () => this.addBookmark());
        this.bookmarkSelect.addEventListener('change', (e) => this.jumpToBookmark(e.target.value));
        this.copyBtn.addEventListener('click', () => this.copyToClipboard());
        
        // Keyboard navigation
        document.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                e.preventDefault();
                this.navigateFiles(e.key === 'ArrowUp' ? -1 : 1);
            } else if (e.key === 'Enter') {
                this.activateSelectedFile();
            } else if (e.key === 'Backspace' && !this.backBtn.disabled) {
                this.goBack();
            }
        });
    }
    
    async loadDirectory(path) {
        try {
            this.fileList.innerHTML = '<div class="loading">Loading files...</div>';
            
            const response = await fetch(`/api/browse?path=${encodeURIComponent(path)}`);
            const data = await response.json();
            
            if (!response.ok) {
                throw new Error(data.error || 'Failed to load directory');
            }
            
            this.currentPath = data.currentPath;
            this.updateUI(data);
            this.renderFileList(data.items);
            
        } catch (error) {
            this.fileList.innerHTML = `<div class="error">Error: ${error.message}</div>`;
        }
    }
    
    updateUI(data) {
        this.currentPathSpan.textContent = data.currentPath || 'Root';
        this.breadcrumb.textContent = `Path: ${data.currentPath || '/'}`;
        // Enable back button if we have path history or if we're not at root
        this.backBtn.disabled = this.pathHistory.length === 0 && !data.currentPath;
    }
    
    renderFileList(items) {
        if (items.length === 0) {
            this.fileList.innerHTML = '<div class="loading">No files found in this directory</div>';
            return;
        }
        
        // Sort items: folders first, then audio files
        items.sort((a, b) => {
            if (a.type !== b.type) {
                return a.type === 'folder' ? -1 : 1;
            }
            return a.name.localeCompare(b.name);
        });
        
        this.fileList.innerHTML = '';
        
        items.forEach((item, index) => {
            const fileItem = document.createElement('div');
            fileItem.className = 'file-item';
            fileItem.dataset.index = index;
            fileItem.dataset.type = item.type;
            fileItem.dataset.path = item.path;
            
            const icon = document.createElement('span');
            icon.className = `file-icon ${item.type}-icon`;
            icon.textContent = item.type === 'folder' ? '📁' : '🎵';
            
            const name = document.createElement('span');
            name.className = 'file-name';
            name.textContent = item.name;
            
            fileItem.appendChild(icon);
            fileItem.appendChild(name);
            
            fileItem.addEventListener('click', () => this.selectFile(fileItem, item));
            fileItem.addEventListener('dblclick', () => this.activateFile(item));
            
            this.fileList.appendChild(fileItem);
        });
        
        // Auto-select first item
        if (items.length > 0) {
            const firstItem = this.fileList.querySelector('.file-item');
            this.selectFileElement(firstItem);
        }
    }
    
    selectFile(element, item) {
        // Remove previous selection
        this.fileList.querySelectorAll('.file-item').forEach(el => {
            el.classList.remove('selected');
        });
        
        // Add selection to current item
        element.classList.add('selected');
        this.selectedFile = item;
        
        // If it's an audio file, load it immediately
        if (item.type === 'audio') {
            this.loadAudioFile(item);
        }
        // For folders, just select them - require double-click or Enter to navigate
        
        // Hide copy button when no audio is selected
        this.copyBtn.style.display = item.type === 'audio' ? 'block' : 'none';
    }
    
    selectFileElement(element) {
        if (!element) return;
        
        const type = element.dataset.type;
        const path = element.dataset.path;
        
        // Create item object from element data
        const item = {
            type: type,
            path: path,
            name: element.querySelector('.file-name').textContent
        };
        
        if (type === 'audio') {
            // We need to reconstruct the full item data for audio files
            item.audioFile = path;
            item.jsonFile = path.replace('.flac', '.json');
        }
        // For folders, no additional properties needed
        
        this.selectFile(element, item);
    }
    
    navigateFiles(direction) {
        const items = this.fileList.querySelectorAll('.file-item');
        const selected = this.fileList.querySelector('.file-item.selected');
        
        if (!selected || items.length === 0) return;
        
        const currentIndex = Array.from(items).indexOf(selected);
        let newIndex = currentIndex + direction;
        
        if (newIndex < 0) newIndex = items.length - 1;
        if (newIndex >= items.length) newIndex = 0;
        
        this.selectFileElement(items[newIndex]);
        
        // Scroll into view
        items[newIndex].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    
    activateSelectedFile() {
        if (this.selectedFile) {
            this.activateFile(this.selectedFile);
        }
    }
    
    activateFile(item) {
        if (item.type === 'folder') {
            this.pathHistory.push(this.currentPath);
            this.loadDirectory(item.path);
        } else if (item.type === 'audio') {
            this.loadAudioFile(item);
        }
    }
    
    async loadAudioFile(item) {
        try {
            // Load audio
            this.audioPlayer.src = `/audio/${item.audioFile}`;
            this.currentFileSpan.textContent = item.name;
            
            // Load transcript if available
            if (item.jsonFile) {
                const response = await fetch(`/api/transcript?file=${encodeURIComponent(item.jsonFile)}`);
                if (response.ok) {
                    const transcript = await response.json();
                    this.currentTranscript = transcript;
                    this.displayTranscript(transcript);
                    this.copyBtn.style.display = 'block';
                } else {
                    this.transcriptContent.textContent = 'Transcript not available';
                    this.currentTranscript = null;
                    this.copyBtn.style.display = 'none';
                }
            } else {
                this.transcriptContent.textContent = 'No transcript file found';
            }
            
        } catch (error) {
            console.error('Error loading audio file:', error);
            this.transcriptContent.textContent = 'Error loading transcript';
        }
    }
    
    displayTranscript(transcript) {
        // Handle different transcript formats
        let text = '';
        
        if (typeof transcript === 'string') {
            text = transcript;
        } else if (transcript.annotation && Array.isArray(transcript.annotation)) {
            // Handle the annotation format with timestamps
            text = transcript.annotation.map(item => {
                const start = this.formatTime(item.start);
                const end = this.formatTime(item.end);
                return `[${start} - ${end}] ${item.text}`;
            }).join('\n\n');
        } else if (transcript.text) {
            text = transcript.text;
        } else if (transcript.transcript) {
            text = transcript.transcript;
        } else if (Array.isArray(transcript)) {
            text = transcript.map(item => item.text || item).join('\n');
        } else {
            text = JSON.stringify(transcript, null, 2);
        }
        
        this.transcriptContent.textContent = text;
    }
    
    formatTime(seconds) {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }
    
    goBack() {
        if (this.pathHistory.length > 0) {
            const previousPath = this.pathHistory.pop();
            this.loadDirectory(previousPath);
        }
    }
    
    // Bookmark functionality
    loadBookmarks() {
        const saved = localStorage.getItem('audioFileBrowserBookmarks');
        return saved ? JSON.parse(saved) : {};
    }
    
    saveBookmarks() {
        localStorage.setItem('audioFileBrowserBookmarks', JSON.stringify(this.bookmarks));
    }
    
    addBookmark() {
        const name = prompt('Enter bookmark name:', this.currentPath || 'Root');
        if (name) {
            this.bookmarks[name] = this.currentPath;
            this.saveBookmarks();
            this.updateBookmarkSelect();
        }
    }
    
    updateBookmarkSelect() {
        this.bookmarkSelect.innerHTML = '<option value="">Jump to bookmark...</option>';
        Object.keys(this.bookmarks).forEach(name => {
            const option = document.createElement('option');
            option.value = this.bookmarks[name];
            option.textContent = name;
            this.bookmarkSelect.appendChild(option);
        });
    }
    
    jumpToBookmark(path) {
        if (path !== '') {
            this.pathHistory.push(this.currentPath);
            this.loadDirectory(path);
            this.bookmarkSelect.value = '';
        }
    }
    
    // Copy functionality for spreadsheet
    async copyToClipboard() {
        if (!this.selectedFile || !this.currentTranscript) {
            alert('No audio file selected or transcript not loaded');
            return;
        }
        
        try {
            // Get absolute path from server
            const pathResponse = await fetch(`/api/absolutePath?file=${encodeURIComponent(this.selectedFile.audioFile)}`);
            const pathData = await pathResponse.json();
            
            const absolutePath = pathData.absolutePath || this.selectedFile.name;
            const duration = this.currentTranscript.duration || 'N/A';
            
            // Extract all text from annotations
            let fullText = '';
            if (this.currentTranscript.annotation && Array.isArray(this.currentTranscript.annotation)) {
                fullText = this.currentTranscript.annotation.map(item => item.text).join(' ');
            }
            
            // Create tab-separated values for spreadsheet
            const tsvData = `${absolutePath}\t${duration}\t${fullText}`;
            
            // Copy to clipboard
            await navigator.clipboard.writeText(tsvData);
            
            // Show temporary success message
            const originalText = this.copyBtn.textContent;
            this.copyBtn.textContent = '✓ Copied!';
            this.copyBtn.style.background = '#28a745';
            
            setTimeout(() => {
                this.copyBtn.textContent = originalText;
                this.copyBtn.style.background = '#28a745';
            }, 2000);
            
        } catch (err) {
            console.error('Failed to copy to clipboard:', err);
            alert('Failed to copy to clipboard. Please try again.');
        }
    }
}

// Initialize the application when the page loads
document.addEventListener('DOMContentLoaded', () => {
    new AudioFileBrowser();
});