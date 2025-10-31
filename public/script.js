class AudioFileBrowser {
    constructor() {
        this.currentPath = '';
        this.pathHistory = [];
        this.selectedFile = null;
        this.currentTranscript = null;
        this.bookmarks = this.loadBookmarks();
        this.sessionId = localStorage.getItem('audioFileBrowserSession');
        this.username = localStorage.getItem('audioFileBrowserUsername');
        
        console.log('AudioFileBrowser constructor - Session ID:', this.sessionId);
        console.log('AudioFileBrowser constructor - Username:', this.username);
        
        // Check authentication
        if (!this.sessionId) {
            console.log('No session ID found, redirecting to login');
            window.location.href = '/login.html';
            return;
        }
        
        this.initializeElements();
        this.bindEvents();
        
        // Load from saved path or start at root
        const savedPath = localStorage.getItem('audioFileBrowserLastPath') || '';
        this.loadDirectory(savedPath);
        
        this.updateBookmarkSelect();
        this.updateUserInfo();
        this.checkHintVisibility();
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
        this.logoutBtn = document.getElementById('logoutBtn');
        this.userInfo = document.getElementById('userInfo');
        this.navigationHint = document.getElementById('navigationHint');
        this.hintClose = document.getElementById('hintClose');
        
        // Annotation elements
        this.annotationArea = document.getElementById('annotationArea');
        this.clearAnnotationBtn = document.getElementById('clearAnnotationBtn');
        this.evaluationNotes = document.getElementById('evaluationNotes');
    }
    
    bindEvents() {
        this.backBtn.addEventListener('click', () => this.goBack());
        this.bookmarkBtn.addEventListener('click', () => this.addBookmark());
        this.bookmarkSelect.addEventListener('change', (e) => this.jumpToBookmark(e.target.value));
        this.copyBtn.addEventListener('click', () => this.copyToClipboard());
        this.logoutBtn.addEventListener('click', () => this.logout());
        this.hintClose.addEventListener('click', () => this.dismissHint());
        this.clearAnnotationBtn.addEventListener('click', () => this.clearAnnotation());
        
        // Keyboard navigation
        document.addEventListener('keydown', (e) => {
            // Check if user is typing in an input field
            const isTyping = e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable;
            
            if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                if (!isTyping) {
                    e.preventDefault();
                    this.navigateFiles(e.key === 'ArrowUp' ? -1 : 1);
                }
            } else if (e.key === 'Enter') {
                if (!isTyping) {
                    this.activateSelectedFile();
                }
            } else if (e.key === 'Backspace' && !this.backBtn.disabled && !isTyping) {
                e.preventDefault();
                this.goBack();
            }
        });
    }
    
    async loadDirectory(path) {
        try {
            console.log('Loading directory:', path, 'with session:', this.sessionId);
            this.fileList.innerHTML = '<div class="loading">Loading files...</div>';
            
            const response = await fetch(`/api/browse?path=${encodeURIComponent(path)}`, {
                headers: {
                    'x-session-id': this.sessionId
                }
            });
            
            console.log('Browse response status:', response.status);
            const data = await response.json();
            console.log('Browse response data:', data);
            
            if (!response.ok) {
                if (response.status === 401) {
                    console.log('Authentication error, handling...');
                    this.handleAuthError();
                    return;
                }
                throw new Error(data.error || 'Failed to load directory');
            }
            
            this.currentPath = data.currentPath;
            this.updateUI(data);
            this.renderFileList(data.items);
            
            // Save current path to localStorage
            localStorage.setItem('audioFileBrowserLastPath', this.currentPath);
            
        } catch (error) {
            console.error('LoadDirectory error:', error);
            this.fileList.innerHTML = `<div class="error">Error: ${error.message}</div>`;
        }
    }
    
    updateUI(data) {
        this.currentPathSpan.textContent = data.currentPath || 'Root';
        this.breadcrumb.textContent = `Path: ${data.currentPath || '/'}`;
        // Enable back button if we have path history OR if we're not at root (can go up one level)
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
            // Clear annotation form when selecting new audio
            this.clearAnnotationSilent();
        }
        // For folders, just select them - require double-click or Enter to navigate
        
        // Show/hide annotation area based on selection
        const isAudio = item.type === 'audio';
        this.annotationArea.style.display = isAudio ? 'block' : 'none';
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
            // Load audio with session ID in query parameter
            this.audioPlayer.src = `/audio/${item.audioFile}?session=${encodeURIComponent(this.sessionId)}`;
            this.currentFileSpan.textContent = item.name;
            
            // Load transcript if available
            if (item.jsonFile) {
                const response = await fetch(`/api/transcript?file=${encodeURIComponent(item.jsonFile)}`, {
                    headers: {
                        'x-session-id': this.sessionId
                    }
                });
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
            // Use path history if available
            const previousPath = this.pathHistory.pop();
            this.loadDirectory(previousPath);
        } else if (this.currentPath) {
            // If no path history but we're in a nested folder, go up one level
            const pathParts = this.currentPath.split('/').filter(part => part.length > 0);
            if (pathParts.length > 0) {
                pathParts.pop(); // Remove the last part
                const parentPath = pathParts.join('/');
                this.loadDirectory(parentPath);
            } else {
                // Go to root
                this.loadDirectory('');
            }
        }
    }
    
    // Bookmark functionality
    loadBookmarks() {
        const bookmarkKey = `audioFileBrowserBookmarks_${this.username || 'default'}`;
        const saved = localStorage.getItem(bookmarkKey);
        return saved ? JSON.parse(saved) : {};
    }
    
    saveBookmarks() {
        const bookmarkKey = `audioFileBrowserBookmarks_${this.username || 'default'}`;
        localStorage.setItem(bookmarkKey, JSON.stringify(this.bookmarks));
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
            console.log('Fetching absolute path for:', this.selectedFile.audioFile);
            const pathResponse = await fetch(`/api/absolutePath?file=${encodeURIComponent(this.selectedFile.audioFile)}`, {
                headers: {
                    'x-session-id': this.sessionId
                }
            });
            
            console.log('Path response status:', pathResponse.status);
            const pathData = await pathResponse.json();
            console.log('Path response data:', pathData);
            
            const absolutePath = pathData.absolutePath || this.selectedFile.name;
            console.log('Using absolute path:', absolutePath);
            const duration = this.currentTranscript.duration || 'N/A';
            
            // Extract all text from annotations
            let fullText = '';
            if (this.currentTranscript.annotation && Array.isArray(this.currentTranscript.annotation)) {
                fullText = this.currentTranscript.annotation.map(item => item.text).join(' ');
            }
            
            // Get evaluation data from radio buttons
            const correct = document.querySelector('input[name="correct"]:checked')?.value || '';
            const wordMissing = document.querySelector('input[name="wordMissing"]:checked')?.value || '';
            const spellingMistake = document.querySelector('input[name="spellingMistake"]:checked')?.value || '';
            const languageContent = document.querySelector('input[name="languageContent"]:checked')?.value || '';
            
            // Get radio button values
            const wordAccuracy = document.querySelector('input[name="wordAccuracy"]:checked')?.value || '';
            const grammarSyntax = document.querySelector('input[name="grammarSyntax"]:checked')?.value || '';
            const properNounRecognition = document.querySelector('input[name="properNounRecognition"]:checked')?.value || '';
            const punctuationFormatting = document.querySelector('input[name="punctuationFormatting"]:checked')?.value || '';
            const audioQuality = document.querySelector('input[name="audioQuality"]:checked')?.value || '';
            
            const evaluationNotes = this.evaluationNotes.value || '';
            
            // Create tab-separated values for spreadsheet (matching the exact template order)
            // Corrected Order: 1.Filename(Absolute Path) 2.Duration 3.Text 4.Correct 5.Word Missing 6.Spelling Mistake 7.Word Accuracy 8.Grammar & Syntax 9.Proper Noun Recognition 10.Punctuation & Formatting 11.Audio Quality 12.Language Content 13.Notes
            const tsvData = `${absolutePath}\t${duration}\t${fullText}\t${correct}\t${wordMissing}\t${spellingMistake}\t${wordAccuracy}\t${grammarSyntax}\t${properNounRecognition}\t${punctuationFormatting}\t${audioQuality}\t${languageContent}\t${evaluationNotes}`;
            
            // Debug: Log the data being copied (remove in production)
            console.log('Copying data:', {
                filename: absolutePath,
                duration: duration,
                correct: correct,
                wordMissing: wordMissing,
                spellingMistake: spellingMistake,
                wordAccuracy: wordAccuracy,
                grammarSyntax: grammarSyntax,
                properNounRecognition: properNounRecognition,
                punctuationFormatting: punctuationFormatting,
                audioQuality: audioQuality,
                languageContent: languageContent,
                notes: evaluationNotes
            });
            
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
    
    updateUserInfo() {
        if (this.userInfo && this.username) {
            this.userInfo.textContent = `Logged in as: ${this.username}`;
        }
    }
    
    handleAuthError() {
        localStorage.removeItem('audioFileBrowserSession');
        localStorage.removeItem('audioFileBrowserUsername');
        window.location.href = '/login.html';
    }
    
    async logout() {
        try {
            await fetch('/api/logout', {
                method: 'POST',
                headers: {
                    'x-session-id': this.sessionId
                }
            });
        } catch (error) {
            console.error('Logout error:', error);
        } finally {
            localStorage.removeItem('audioFileBrowserSession');
            localStorage.removeItem('audioFileBrowserUsername');
            window.location.href = '/login.html';
        }
    }
    
    // Hint management
    checkHintVisibility() {
        const hintDismissed = localStorage.getItem('audioFileBrowserHintDismissed');
        if (hintDismissed === 'true') {
            this.navigationHint.classList.add('hidden');
            // Adjust file list height when hint is hidden
            this.fileList.style.height = 'calc(100% - 60px)';
        }
    }
    
    dismissHint() {
        this.navigationHint.classList.add('hidden');
        localStorage.setItem('audioFileBrowserHintDismissed', 'true');
        // Adjust file list height when hint is hidden
        this.fileList.style.height = 'calc(100% - 60px)';
    }
    
    // Clear annotation form with confirmation
    clearAnnotation() {
        if (confirm('Are you sure you want to clear all evaluation fields?')) {
            this.clearAnnotationSilent();
        }
    }
    
    // Clear annotation form without confirmation (used when selecting new audio)
    clearAnnotationSilent() {
        // Clear all radio buttons
        document.querySelectorAll('input[name="correct"]').forEach(radio => radio.checked = false);
        document.querySelectorAll('input[name="wordMissing"]').forEach(radio => radio.checked = false);
        document.querySelectorAll('input[name="spellingMistake"]').forEach(radio => radio.checked = false);
        document.querySelectorAll('input[name="languageContent"]').forEach(radio => radio.checked = false);
        document.querySelectorAll('input[name="wordAccuracy"]').forEach(radio => radio.checked = false);
        document.querySelectorAll('input[name="grammarSyntax"]').forEach(radio => radio.checked = false);
        document.querySelectorAll('input[name="properNounRecognition"]').forEach(radio => radio.checked = false);
        document.querySelectorAll('input[name="punctuationFormatting"]').forEach(radio => radio.checked = false);
        document.querySelectorAll('input[name="audioQuality"]').forEach(radio => radio.checked = false);
        
        // Clear notes
        this.evaluationNotes.value = '';
    }
}

// Initialize the application when the page loads
document.addEventListener('DOMContentLoaded', () => {
    new AudioFileBrowser();
});