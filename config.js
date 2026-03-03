// Configuration file for the Audio File Browser
// You can modify this file for local testing without affecting the deployed version

const config = {
    // Base directory for audio files
    // For local testing, you can change this to your local path
    // For production deployment, this will default to the Windows server path
    BASE_DIR: process.env.AUDIO_BASE_DIR || '../STT_D3_updated_samples',
    
    // Server port
    PORT: process.env.PORT || 3002,
    
    // Session timeout (in milliseconds)
    SESSION_TIMEOUT: 24 * 60 * 60 * 1000, // 24 hours
    
    // Enable debug logging
    DEBUG: process.env.NODE_ENV !== 'production'
};

module.exports = config;
