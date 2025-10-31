# Audio File Browser

A web server for browsing and playing audio files with their transcriptions.

## Features

- Browse folders and subfolders with smooth navigation
- Play FLAC audio files with transcript display
- Bookmark folders for quick access
- Copy audio data (filename, duration, transcript) for spreadsheet import
- Keyboard shortcuts for efficient navigation
- Responsive design

## Setup

1. Install dependencies:
```bash
npm install
```

2. Update the base directory path in `server.js`:
```javascript
const BASE_DIR = './data';
```

3. Start the server:
```bash
npm start
```

4. Open your browser and go to `http://localhost:3002`

## Usage

- **Navigation**: Click folders to enter them, use the Back button or Backspace key to go back
- **Audio Selection**: Click on audio files to select and play them
- **Bookmarks**: Click the ⭐ button to bookmark current folder, use dropdown to jump to bookmarks
- **Copy Data**: Click the 📋 Copy button to copy filename, duration, and transcript text (tab-separated for spreadsheet import)
- **Keyboard Shortcuts**:
  - Arrow Up/Down: Navigate through files
  - Enter: Open selected folder or play selected audio
  - Backspace: Go back to parent directory

## File Structure

The server expects pairs of files:
- `filename.flac` - Audio file
- `filename.json` - Transcript file

The JSON file can contain transcript data in various formats (text, transcript property, or array of objects).