// Example local configuration file
// Copy this to config.local.js and modify for your local testing environment
// config.local.js is ignored by git, so your local changes won't be committed

const config = {
    // Local testing path - change this to your local directory
    BASE_DIR: './data',  // or 'C:\\Users\\YourName\\Documents\\AudioFiles\\'

    // Local development port
    PORT: 3002,

    // Session timeout
    SESSION_TIMEOUT: 24 * 60 * 60 * 1000, // 24 hours

    // Enable debug logging for local development
    DEBUG: true
};

module.exports = config;