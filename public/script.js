class AudioFileBrowser {
    normalizePath(pathStr) {
        if (!pathStr) return '';
        return pathStr
            .replace(/\\/g, '/')
            .replace(/\/+/g, '/')
            .replace(/^\//, '')
            .replace(/\/$/, '');
    }
    
    constructor() {
        this.currentPath = '';
        this.pathHistory = [];
        this.currentItems = [];
        this.selectedFile = null;
        this.currentTranscript = null;
        this.currentMeta = null;
        this.transcriptSegments = [];
        this.activeTranscriptSegmentIndex = -1;
        this.bookmarks = this.loadBookmarks();
        this.sessionId = localStorage.getItem('audioFileBrowserSession');
        this.username = localStorage.getItem('audioFileBrowserUsername');
        
        if (!this.sessionId) {
            window.location.href = '/login.html';
            return;
        }
        
        this.initializeElements();
        this.bindEvents();
        
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
        this.saveBtn = document.getElementById('saveBtn');
        this.logoutBtn = document.getElementById('logoutBtn');
        this.userInfo = document.getElementById('userInfo');
        this.navigationHint = document.getElementById('navigationHint');
        this.hintClose = document.getElementById('hintClose');
        
        this.annotationArea = document.getElementById('annotationArea');
        this.clearAnnotationBtn = document.getElementById('clearAnnotationBtn');
        this.evaluationNotes = document.getElementById('evaluationNotes');

        this.metricsPanel = document.getElementById('metricsPanel');
        this.dualTranscript = document.getElementById('dualTranscript');
        this.singleTranscript = document.getElementById('singleTranscript');
        this.transcriptGT = document.getElementById('transcriptGT');
        this.transcriptEL = document.getElementById('transcriptEL');

        this.progressContainer = document.getElementById('progressContainer');
        this.progressText = document.getElementById('progressText');
        this.progressFill = document.getElementById('progressFill');

        this.incorrectGT = document.getElementById('incorrectGT');
        this.incorrectEL = document.getElementById('incorrectEL');
    }
    
    bindEvents() {
        this.backBtn.addEventListener('click', () => this.goBack());
        this.bookmarkBtn.addEventListener('click', () => this.addBookmark());
        this.bookmarkSelect.addEventListener('change', (e) => this.jumpToBookmark(e.target.value));
        this.copyBtn.addEventListener('click', () => this.copyToClipboard());
        this.saveBtn.addEventListener('click', () => this.saveAnnotation());
        this.logoutBtn.addEventListener('click', () => this.logout());
        this.hintClose.addEventListener('click', () => this.dismissHint());
        this.clearAnnotationBtn.addEventListener('click', () => this.clearAnnotation());
        this.audioPlayer.addEventListener('timeupdate', () => this.updateTranscriptHighlight());
        this.audioPlayer.addEventListener('seeked', () => this.updateTranscriptHighlight());
        this.audioPlayer.addEventListener('loadedmetadata', () => this.updateTranscriptHighlight());
        
        document.addEventListener('keydown', (e) => {
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
    
    async loadDirectory(dirPath) {
        try {
            this.fileList.innerHTML = '<div class="loading">Loading files...</div>';
            
            const response = await fetch(`/api/browse?path=${encodeURIComponent(dirPath)}`, {
                headers: { 'x-session-id': this.sessionId }
            });
            
            const data = await response.json();
            
            if (!response.ok) {
                if (response.status === 401) { this.handleAuthError(); return; }
                if (response.status === 404 && dirPath) {
                    this.pathHistory = [];
                    localStorage.removeItem('audioFileBrowserLastPath');
                    await this.loadDirectory('');
                    return;
                }
                throw new Error(data.error || 'Failed to load directory');
            }
            
            this.currentPath = data.currentPath;
            this.updateUI(data);
            this.renderFileList(data.items);
            this.updateProgress(data);
            
            localStorage.setItem('audioFileBrowserLastPath', this.currentPath);
            
        } catch (error) {
            console.error('LoadDirectory error:', error);
            this.fileList.innerHTML = `<div class="error">Error: ${error.message}</div>`;
        }
    }

    updateProgress(data) {
        if (data.totalCount !== undefined && data.savedCount !== undefined) {
            this.progressContainer.style.display = 'flex';
            const pct = data.totalCount > 0 ? (data.savedCount / data.totalCount * 100) : 0;
            this.progressText.textContent = `${data.savedCount} / ${data.totalCount}`;
            this.progressFill.style.width = `${pct}%`;
        } else if (data.items && data.items.length > 0 && data.items[0].type === 'folder') {
            // At root: show aggregate if available
            let totalSaved = 0, totalCount = 0;
            data.items.forEach(f => {
                totalCount += f.fileCount || 0;
                totalSaved += f.savedCount || 0;
            });
            if (totalCount > 0) {
                this.progressContainer.style.display = 'flex';
                const pct = totalSaved / totalCount * 100;
                this.progressText.textContent = `${totalSaved} / ${totalCount}`;
                this.progressFill.style.width = `${pct}%`;
            }
        } else {
            this.progressContainer.style.display = 'none';
        }
    }
    
    updateUI(data) {
        this.currentPathSpan.textContent = data.currentPath || 'Root';
        this.breadcrumb.textContent = `Path: ${data.currentPath || '/'}`;
        this.backBtn.disabled = this.pathHistory.length === 0 && !data.currentPath;
    }
    
    renderFileList(items) {
        this.currentItems = items;

        if (items.length === 0) {
            this.fileList.innerHTML = '<div class="loading">No files found in this directory</div>';
            return;
        }
        
        items.sort((a, b) => {
            if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
            return a.name.localeCompare(b.name);
        });
        
        this.fileList.innerHTML = '';
        
        items.forEach((item, index) => {
            const fileItem = document.createElement('div');
            fileItem.className = 'file-item';
            fileItem.dataset.index = index;
            fileItem.dataset.type = item.type;
            fileItem.dataset.path = item.path;
            
            const serial = document.createElement('span');
            serial.className = 'file-serial';
            serial.textContent = (index + 1).toString().padStart(3, '0');
            
            const icon = document.createElement('span');
            icon.className = `file-icon ${item.type}-icon`;
            icon.textContent = item.type === 'folder' ? '📁' : '🎵';
            
            const name = document.createElement('span');
            name.className = 'file-name';
            name.textContent = item.name;

            if (item.type === 'audio' && item.saved) {
                const savedIndicator = document.createElement('span');
                savedIndicator.className = 'saved-indicator';
                savedIndicator.textContent = '✓';
                savedIndicator.title = 'Annotation saved';
                name.appendChild(savedIndicator);
            }

            // WER badge for audio files
            if (item.type === 'audio' && item.wer !== undefined) {
                const werBadge = document.createElement('span');
                werBadge.className = 'wer-badge ' + this.werClass(item.wer);
                werBadge.textContent = item.wer.toFixed(2);
                werBadge.title = `WER: ${item.wer.toFixed(4)}`;
                name.appendChild(werBadge);
            }
            
            if (item.type === 'folder' && item.fileCount !== undefined) {
                const count = document.createElement('span');
                count.className = 'file-count';
                count.textContent = `${item.fileCount} files`;
                name.appendChild(count);
                if (item.savedCount !== undefined) {
                    const savedCount = document.createElement('span');
                    savedCount.className = 'file-count saved-count';
                    savedCount.textContent = `${item.savedCount} done`;
                    name.appendChild(savedCount);
                }
            }
            
            const actions = document.createElement('div');
            actions.className = 'file-actions';
            
            const copyBtn = document.createElement('button');
            copyBtn.className = 'copy-filename-btn';
            copyBtn.innerHTML = '📋';
            copyBtn.title = 'Copy filename';
            copyBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.copyFilename(item, copyBtn);
            });
            actions.appendChild(copyBtn);
            
            fileItem.appendChild(serial);
            fileItem.appendChild(icon);
            fileItem.appendChild(name);
            fileItem.appendChild(actions);
            
            fileItem.addEventListener('click', () => this.selectFile(fileItem, item));
            fileItem.addEventListener('dblclick', () => this.activateFile(item));
            
            this.fileList.appendChild(fileItem);
        });
        
        if (items.length > 0) {
            const firstItem = this.fileList.querySelector('.file-item');
            this.selectFileElement(firstItem);
        }
    }

    werClass(wer) {
        if (wer > 0.3) return 'wer-bad';
        if (wer > 0.15) return 'wer-mid';
        return 'wer-good';
    }

    metricColor(value, thresholds) {
        if (value > thresholds.bad) return 'metric-bad';
        if (value > thresholds.mid) return 'metric-mid';
        return 'metric-good';
    }
    
    selectFile(element, item) {
        this.fileList.querySelectorAll('.file-item').forEach(el => el.classList.remove('selected'));
        element.classList.add('selected');
        this.selectedFile = item;
        
        if (item.type === 'audio') {
            this.loadAudioFile(item);
            this.clearAnnotationSilent();
        }
        
        const isAudio = item.type === 'audio';
        this.annotationArea.style.display = isAudio ? 'block' : 'none';
        if (!isAudio) {
            this.metricsPanel.style.display = 'none';
            this.dualTranscript.style.display = 'none';
            this.singleTranscript.style.display = 'block';
        }
    }
    
    selectFileElement(element) {
        if (!element) return;
        const index = Number(element.dataset.index);
        const item = Number.isInteger(index) ? this.currentItems[index] : null;
        if (!item) return;
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
        items[newIndex].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    
    activateSelectedFile() {
        if (this.selectedFile) this.activateFile(this.selectedFile);
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
        const requestedClipId = item.name;
        const requestedSplitFolder = item.splitFolder || this.currentPath;

        try {
            this.audioPlayer.src = `/audio/${item.audioFile}?session=${encodeURIComponent(this.sessionId)}`;
            this.currentFileSpan.textContent = item.name;

            // Fetch metadata from CSV
            const metaRes = await fetch(`/api/sample-meta?clipId=${encodeURIComponent(item.name)}`, {
                headers: { 'x-session-id': this.sessionId }
            });

            if (this.selectedFile?.name !== requestedClipId) return;

            if (metaRes.ok) {
                this.currentMeta = await metaRes.json();
                this.displayMetrics(this.currentMeta);
                this.displayDualTranscript(this.currentMeta);
            } else {
                this.currentMeta = null;
                this.metricsPanel.style.display = 'none';
                // Fall back to single transcript from JSON
                await this.loadSingleTranscript(item, requestedClipId, requestedSplitFolder);
            }

            if (this.selectedFile?.name !== requestedClipId) return;
            await this.loadSavedAnnotation(requestedSplitFolder, requestedClipId);
            
        } catch (error) {
            console.error('Error loading audio file:', error);
            this.transcriptContent.textContent = 'Error loading transcript';
        }
    }

    async loadSingleTranscript(item, requestedClipId, requestedSplitFolder) {
        this.dualTranscript.style.display = 'none';
        this.singleTranscript.style.display = 'block';

        if (item.jsonFile) {
            const response = await fetch(`/api/transcript?file=${encodeURIComponent(item.jsonFile)}`, {
                headers: { 'x-session-id': this.sessionId }
            });
            if (this.selectedFile?.name !== requestedClipId) return;

            if (response.ok) {
                const transcript = await response.json();
                this.currentTranscript = transcript;
                this.displayTranscript(transcript);
                this.updateTranscriptHighlight();
            } else {
                this.transcriptContent.textContent = 'Transcript not available';
                this.currentTranscript = null;
            }
        }
    }

    displayMetrics(meta) {
        this.metricsPanel.style.display = 'flex';

        const werEl = document.getElementById('metricWER');
        const cerEl = document.getElementById('metricCER');
        const snrEl = document.getElementById('metricSNR');
        const silEl = document.getElementById('metricSilence');
        const wordsEl = document.getElementById('metricWords');

        werEl.textContent = `WER: ${meta.wer.toFixed(3)}`;
        werEl.className = 'metric-badge ' + this.metricColor(meta.wer, { bad: 0.3, mid: 0.15 });

        cerEl.textContent = `CER: ${meta.cer.toFixed(3)}`;
        cerEl.className = 'metric-badge ' + this.metricColor(meta.cer, { bad: 0.2, mid: 0.1 });

        snrEl.textContent = `SNR: ${meta.snr_vad.toFixed(1)} dB`;
        // SNR: higher is better, invert logic
        snrEl.className = 'metric-badge ' + (meta.snr_vad < 15 ? 'metric-bad' : meta.snr_vad < 25 ? 'metric-mid' : 'metric-good');

        silEl.textContent = `Silence: ${meta.silence_percentage.toFixed(1)}%`;
        silEl.className = 'metric-badge ' + this.metricColor(meta.silence_percentage, { bad: 20, mid: 10 });

        wordsEl.textContent = `Words: ${meta.unique_words}`;
        wordsEl.className = 'metric-badge metric-neutral';
    }

    displayDualTranscript(meta) {
        if (meta.transcript || meta.elevenLabs) {
            this.dualTranscript.style.display = 'grid';
            this.singleTranscript.style.display = 'none';
            this.renderClickableWords(this.transcriptGT, meta.transcript || '', this.incorrectGT);
            this.renderClickableWords(this.transcriptEL, meta.elevenLabs || '', this.incorrectEL);
            this.currentTranscript = { text: meta.transcript };
        } else {
            this.dualTranscript.style.display = 'none';
            this.singleTranscript.style.display = 'block';
            this.transcriptContent.textContent = 'No transcript available';
        }
    }

    renderClickableWords(container, text, targetTextarea) {
        container.innerHTML = '';
        if (!text) { container.textContent = '(empty)'; return; }

        const words = text.split(/(\s+)/);
        words.forEach(token => {
            if (/^\s+$/.test(token)) {
                container.appendChild(document.createTextNode(token));
                return;
            }
            const span = document.createElement('span');
            span.className = 'clickable-word';
            span.textContent = token;
            span.addEventListener('click', () => {
                span.classList.toggle('word-marked');
                if (span.classList.contains('word-marked')) {
                    const current = targetTextarea.value.trim();
                    targetTextarea.value = current ? current + ', ' + token : token;
                } else {
                    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    targetTextarea.value = targetTextarea.value
                        .replace(new RegExp(',?\\s*' + escaped), '')
                        .replace(/^,\s*/, '')
                        .trim();
                }
            });
            container.appendChild(span);
        });
    }
    
    displayTranscript(transcript) {
        let text = '';
        this.transcriptSegments = [];
        this.activeTranscriptSegmentIndex = -1;
        
        if (typeof transcript === 'string') {
            text = transcript;
        } else if (transcript.annotation && Array.isArray(transcript.annotation)) {
            this.transcriptContent.innerHTML = '';
            transcript.annotation.forEach((item) => {
                const startSec = Number(item.start);
                const endSec = Number(item.end);
                const isTimed = Number.isFinite(startSec) && Number.isFinite(endSec);
                const segmentEl = document.createElement('div');
                segmentEl.className = 'transcript-segment';
                const start = this.formatTime(isTimed ? startSec : 0);
                const end = this.formatTime(isTimed ? endSec : 0);
                segmentEl.textContent = `[${start} - ${end}] ${item.text || ''}`;
                this.transcriptContent.appendChild(segmentEl);
                this.transcriptSegments.push({ element: segmentEl, start: isTimed ? startSec : null, end: isTimed ? endSec : null });
            });
            return;
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

    updateTranscriptHighlight() {
        if (!this.transcriptSegments.length) return;
        const currentTime = this.audioPlayer.currentTime || 0;
        const newIndex = this.transcriptSegments.findIndex(segment => (
            Number.isFinite(segment.start) && Number.isFinite(segment.end) &&
            currentTime >= segment.start && currentTime <= segment.end
        ));
        if (newIndex === this.activeTranscriptSegmentIndex) return;
        if (this.activeTranscriptSegmentIndex >= 0) {
            this.transcriptSegments[this.activeTranscriptSegmentIndex].element.classList.remove('active');
        }
        this.activeTranscriptSegmentIndex = newIndex;
        if (newIndex >= 0) {
            const activeEl = this.transcriptSegments[newIndex].element;
            activeEl.classList.add('active');
            activeEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
    }

    // ── Annotation form helpers ──────────────────────────────────────────────

    setRadioValue(name, value) {
        if (!value) return;
        const safeValue = String(value).trim();
        if (!safeValue) return;
        document.querySelectorAll(`input[name="${name}"]`).forEach(radio => {
            radio.checked = radio.value === safeValue;
        });
    }

    setCheckboxValues(name, values) {
        if (!Array.isArray(values)) return;
        document.querySelectorAll(`input[name="${name}"]`).forEach(cb => {
            cb.checked = values.includes(cb.value);
        });
    }

    applySavedAnnotation(annotation) {
        const evaluation = annotation?.evaluation || {};
        this.clearAnnotationSilent();

        if (evaluation.overallQuality !== undefined) {
            this.setRadioValue('overallQuality', evaluation.overallQuality);
            this.setRadioValue('transcriptAccuracy', evaluation.transcriptAccuracy);
            this.setRadioValue('audioQuality', evaluation.audioQuality);
            this.setCheckboxValues('issueFlags', evaluation.issueFlags);
            this.incorrectGT.value = evaluation.incorrectGT || '';
            this.incorrectEL.value = evaluation.incorrectEL || '';
            this.evaluationNotes.value = evaluation.notes || '';
        } else {
            // Legacy format – map old fields to new ones as best we can
            if (evaluation.correct === 'Yes') this.setRadioValue('overallQuality', 'Good');
            else if (evaluation.correct === 'No') this.setRadioValue('overallQuality', 'Poor');
            this.evaluationNotes.value = evaluation.notes || '';
        }
    }

    async loadSavedAnnotation(splitFolder, clipId) {
        try {
            const response = await fetch(`/api/annotation?splitFolder=${encodeURIComponent(splitFolder)}&clipId=${encodeURIComponent(clipId)}`, {
                headers: { 'x-session-id': this.sessionId }
            });
            if (this.selectedFile?.name !== clipId) return;
            if (!response.ok) {
                if (response.status === 401) { this.handleAuthError(); return; }
                return;
            }
            const data = await response.json();
            if (!data.saved || !data.annotation) return;
            if (this.selectedFile?.name !== clipId) return;
            this.applySavedAnnotation(data.annotation);
            this.markSelectedAsSaved();
        } catch (error) {
            console.error('Failed to load saved annotation:', error);
        }
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
        } else if (this.currentPath) {
            const pathParts = this.currentPath.split('/').filter(part => part.length > 0);
            if (pathParts.length > 0) {
                pathParts.pop();
                this.loadDirectory(pathParts.join('/'));
            } else {
                this.loadDirectory('');
            }
        }
    }
    
    // ── Bookmarks ────────────────────────────────────────────────────────────

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
    
    jumpToBookmark(p) {
        if (p !== '') {
            this.pathHistory.push(this.currentPath);
            this.loadDirectory(p);
            this.bookmarkSelect.value = '';
        }
    }
    
    // ── Copy / collect data ──────────────────────────────────────────────────

    getTranscriptText() {
        if (this.currentMeta?.transcript) return this.currentMeta.transcript;
        if (!this.currentTranscript) return '';
        if (this.currentTranscript.annotation && Array.isArray(this.currentTranscript.annotation)) {
            return this.currentTranscript.annotation.map(item => item.text).join(' ');
        }
        if (typeof this.currentTranscript === 'string') return this.currentTranscript;
        if (this.currentTranscript.text) return this.currentTranscript.text;
        if (this.currentTranscript.transcript) return this.currentTranscript.transcript;
        if (Array.isArray(this.currentTranscript)) return this.currentTranscript.map(item => item.text || item).join(' ');
        return '';
    }

    collectAnnotationData() {
        if (!this.selectedFile) return null;

        const issueFlags = Array.from(document.querySelectorAll('input[name="issueFlags"]:checked')).map(cb => cb.value);

        return {
            splitFolder: this.selectedFile.splitFolder || this.currentPath,
            clipId: this.selectedFile.name,
            audioFile: this.selectedFile.audioFile || null,
            jsonFile: this.selectedFile.jsonFile || null,
            duration: this.currentTranscript?.duration || null,
            text: this.getTranscriptText(),
            evaluation: {
                overallQuality: document.querySelector('input[name="overallQuality"]:checked')?.value || '',
                transcriptAccuracy: document.querySelector('input[name="transcriptAccuracy"]:checked')?.value || '',
                audioQuality: document.querySelector('input[name="audioQuality"]:checked')?.value || '',
                issueFlags,
                incorrectGT: this.incorrectGT.value || '',
                incorrectEL: this.incorrectEL.value || '',
                notes: this.evaluationNotes.value || ''
            }
        };
    }

    async saveAnnotation() {
        if (!this.selectedFile || this.selectedFile.type !== 'audio') {
            alert('Select an audio clip first');
            return;
        }

        const payload = this.collectAnnotationData();
        if (!payload || !payload.splitFolder) {
            alert('Unable to determine split folder for this clip');
            return;
        }

        try {
            const response = await fetch('/api/annotation', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-session-id': this.sessionId },
                body: JSON.stringify(payload)
            });

            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'Failed to save annotation');

            this.markSelectedAsSaved();
            this.incrementProgress();

            const originalText = this.saveBtn.textContent;
            this.saveBtn.textContent = '✓ Saved';
            this.saveBtn.style.background = '#28a745';
            setTimeout(() => { this.saveBtn.textContent = originalText; this.saveBtn.style.background = '#17a2b8'; }, 1500);
        } catch (error) {
            console.error('Save annotation error:', error);
            alert(`Failed to save annotation: ${error.message}`);
        }
    }

    incrementProgress() {
        const text = this.progressText.textContent;
        const match = text.match(/(\d+)\s*\/\s*(\d+)/);
        if (match) {
            const saved = parseInt(match[1], 10) + 1;
            const total = parseInt(match[2], 10);
            this.progressText.textContent = `${saved} / ${total}`;
            this.progressFill.style.width = `${total > 0 ? saved / total * 100 : 0}%`;
        }
    }

    markSelectedAsSaved() {
        if (!this.selectedFile || this.selectedFile.type !== 'audio') return;
        this.selectedFile.saved = true;
        const selectedElement = this.fileList.querySelector('.file-item.selected');
        if (!selectedElement) return;
        const index = Number(selectedElement.dataset.index);
        if (Number.isInteger(index) && this.currentItems[index]) this.currentItems[index].saved = true;
        const nameEl = selectedElement.querySelector('.file-name');
        if (!nameEl) return;
        if (!nameEl.querySelector('.saved-indicator')) {
            const savedIndicator = document.createElement('span');
            savedIndicator.className = 'saved-indicator';
            savedIndicator.textContent = '✓';
            savedIndicator.title = 'Annotation saved';
            nameEl.appendChild(savedIndicator);
        }
    }

    async copyToClipboard() {
        if (!this.selectedFile) { alert('No audio file selected'); return; }
        
        try {
            const pathResponse = await fetch(`/api/absolutePath?file=${encodeURIComponent(this.selectedFile.audioFile)}`, {
                headers: { 'x-session-id': this.sessionId }
            });
            const pathData = await pathResponse.json();
            const absolutePath = this.normalizePath(pathData.absolutePath || this.selectedFile.name);

            const ad = this.collectAnnotationData();
            const meta = this.currentMeta || {};
            const flags = (ad.evaluation.issueFlags || []).join('; ');

            const tsvData = [
                absolutePath,
                meta.wer !== undefined ? meta.wer.toFixed(4) : '',
                meta.cer !== undefined ? meta.cer.toFixed(4) : '',
                ad.evaluation.overallQuality,
                ad.evaluation.transcriptAccuracy,
                ad.evaluation.audioQuality,
                flags,
                ad.evaluation.incorrectGT,
                ad.evaluation.incorrectEL,
                ad.evaluation.notes
            ].join('\t');
            
            await navigator.clipboard.writeText(tsvData);
            
            const originalText = this.copyBtn.textContent;
            this.copyBtn.textContent = '✓ Copied!';
            this.copyBtn.style.background = '#28a745';
            setTimeout(() => { this.copyBtn.textContent = originalText; this.copyBtn.style.background = '#007bff'; }, 2000);
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
            await fetch('/api/logout', { method: 'POST', headers: { 'x-session-id': this.sessionId } });
        } catch (error) {
            console.error('Logout error:', error);
        } finally {
            localStorage.removeItem('audioFileBrowserSession');
            localStorage.removeItem('audioFileBrowserUsername');
            window.location.href = '/login.html';
        }
    }
    
    checkHintVisibility() {
        if (localStorage.getItem('audioFileBrowserHintDismissed') === 'true') {
            this.navigationHint.classList.add('hidden');
            this.fileList.style.height = 'calc(100% - 60px)';
        }
    }
    
    dismissHint() {
        this.navigationHint.classList.add('hidden');
        localStorage.setItem('audioFileBrowserHintDismissed', 'true');
        this.fileList.style.height = 'calc(100% - 60px)';
    }
    
    clearAnnotation() {
        if (confirm('Clear all evaluation fields?')) this.clearAnnotationSilent();
    }
    
    clearAnnotationSilent() {
        document.querySelectorAll('input[name="overallQuality"]').forEach(r => r.checked = false);
        document.querySelectorAll('input[name="transcriptAccuracy"]').forEach(r => r.checked = false);
        document.querySelectorAll('input[name="audioQuality"]').forEach(r => r.checked = false);
        document.querySelectorAll('input[name="issueFlags"]').forEach(cb => cb.checked = false);
        this.incorrectGT.value = '';
        this.incorrectEL.value = '';
        this.evaluationNotes.value = '';
        document.querySelectorAll('.clickable-word.word-marked').forEach(el => el.classList.remove('word-marked'));
    }
    
    async copyFilename(item, buttonElement) {
        try {
            let filename;
            if (item.type === 'audio') {
                const pathResponse = await fetch(`/api/absolutePath?file=${encodeURIComponent(item.audioFile)}`, {
                    headers: { 'x-session-id': this.sessionId }
                });
                if (pathResponse.ok) {
                    const pathData = await pathResponse.json();
                    filename = this.normalizePath(pathData.absolutePath);
                } else {
                    filename = this.normalizePath(item.name);
                }
            } else {
                filename = this.normalizePath(item.path || item.name);
            }
            
            await navigator.clipboard.writeText(filename);
            const originalContent = buttonElement.innerHTML;
            buttonElement.innerHTML = '✓';
            buttonElement.classList.add('copied');
            setTimeout(() => { buttonElement.innerHTML = originalContent; buttonElement.classList.remove('copied'); }, 1500);
        } catch (error) {
            console.error('Failed to copy filename:', error);
            buttonElement.innerHTML = '✗';
            buttonElement.style.color = '#dc3545';
            setTimeout(() => { buttonElement.innerHTML = '📋'; buttonElement.style.color = ''; }, 1500);
        }
    }
}

document.addEventListener('DOMContentLoaded', () => { new AudioFileBrowser(); });
