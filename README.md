# Audio File Browser

A web server for browsing and playing audio files with their transcriptions.

## Features

- **Authentication system** with demo accounts for secure access
- Browse folders and subfolders with smooth navigation
- Play FLAC audio files with transcript display
- Bookmark folders for quick access
- Copy audio data (absolute path, duration, transcript) for spreadsheet import
- Keyboard shortcuts for efficient navigation
- Responsive design

## Setup

1. Install dependencies:
```bash
npm install
```

2. **Configuration**: The server uses a configuration system:
   - **Production**: Uses `config.js` with the default path `D:\STT D3\STT D3\deliverables3\`
   - **Local Development**: Create `config.local.js` for your local testing environment

   For local development, copy the example:
   ```bash
   cp config.local.example.js config.local.js
   ```
   Then edit `config.local.js` to point to your local audio files directory.

3. Start the server:
```bash
npm start
```

4. Open your browser and go to `http://localhost:3002` (or the port specified in your config)

## Configuration

The application uses a flexible configuration system:

### Production Configuration (`config.js`)
- Default path: `D:\STT D3\STT D3\deliverables3\`
- Port: 3002
- This file is committed to version control

### Local Development Configuration (`config.local.js`)
- Copy from `config.local.example.js`
- Customize for your local environment
- This file is ignored by git (won't be committed)
- Takes precedence over `config.js` when present

### Environment Variables
You can also use environment variables:
- `AUDIO_BASE_DIR`: Override the base directory path
- `PORT`: Override the server port
- `NODE_ENV=production`: Disable debug logging

## Authentication

The application requires login credentials to access the audio file browser. Contact the administrator for access credentials.

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