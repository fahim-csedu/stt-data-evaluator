// Configuration file for the Audio File Browser
// You can modify this file for local testing without affecting the deployed version

const config = {
    // Base directory for audio files
    // For local testing, you can change this to your local path
    // For production deployment, this will default to the Windows server path
    BASE_DIR: process.env.AUDIO_BASE_DIR || 'D:\\STT_D3_500_hrs',
    
    // Server port
    PORT: process.env.PORT || 3002,
    
    // Session timeout (in milliseconds)
    SESSION_TIMEOUT: 24 * 60 * 60 * 1000, // 24 hours
    
    // Enable debug logging
    DEBUG: process.env.NODE_ENV !== 'production',

    // Annotator split CSVs: maps virtual folder name -> CSV file path
    SPLIT_CSVS: {
        'annotator1': 'split_annotator1.csv',
        'annotator2': 'split_annotator2.csv',
    },
};

module.exports = config;
