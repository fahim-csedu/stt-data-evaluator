# Audio File Browser

A web server for browsing and playing audio files with their transcriptions.

## Features

- Browse folders and subfolders
- Play FLAC audio files
- Display JSON transcripts alongside audio
- Smooth navigation with keyboard shortcuts
- Responsive design

## Setup

1. Install dependencies:
```bash
npm install
```

2. Update the base directory path in `server.js`:
```javascript
const BASE_DIR = 'D:\\STT D3\\STT D3\\deliverables3\\';
```

3. Start the server:
```bash
npm start
```

4. Open your browser and go to `http://localhost:3000`

## Usage

- **Navigation**: Click folders to enter them, use the Back button or Backspace key to go back
- **Audio Selection**: Click on audio files to select and play them
- **Keyboard Shortcuts**:
  - Arrow Up/Down: Navigate through files
  - Enter: Open selected folder or play selected audio
  - Backspace: Go back to parent directory

## File Structure

The server expects pairs of files:
- `filename.flac` - Audio file
- `filename.json` - Transcript file

The JSON file can contain transcript data in various formats (text, transcript property, or array of objects).