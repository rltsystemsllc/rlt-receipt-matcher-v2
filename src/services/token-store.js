/**
 * Token Storage Service
 * Stores OAuth tokens in environment variables (for Railway) or files (for local dev)
 * 
 * This solves the problem of Railway's stateless deployments wiping token files.
 * Tokens are stored as base64-encoded JSON in environment variables.
 */

const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

// Environment variable names for each service
const TOKEN_ENV_VARS = {
  'quickbooks': 'QBO_TOKENS',
  'gmail': 'GMAIL_TOKENS',
  'sheets': 'SHEETS_TOKENS'
};

/**
 * Save tokens - stores in file and logs env var for Railway
 */
function saveTokens(service, tokens, filePath) {
  try {
    // Always save to file for local dev
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    // Add timestamp
    const tokenData = {
      ...tokens,
      savedAt: new Date().toISOString()
    };
    
    fs.writeFileSync(filePath, JSON.stringify(tokenData, null, 2));
    logger.info(`${service} tokens saved to file`);
    
    // Generate base64 for env var
    const base64Token = Buffer.from(JSON.stringify(tokenData)).toString('base64');
    const envVarName = TOKEN_ENV_VARS[service] || `${service.toUpperCase()}_TOKENS`;
    
    // Log instructions for Railway (visible in deployment logs)
    console.log('\n' + '='.repeat(70));
    console.log(`📋 COPY THIS TO RAILWAY VARIABLES TO PERSIST ${service.toUpperCase()} TOKENS:`);
    console.log('='.repeat(70));
    console.log(`${envVarName}=${base64Token}`);
    console.log('='.repeat(70) + '\n');
    
    return true;
  } catch (error) {
    logger.error(`Failed to save ${service} tokens`, { error: error.message });
    return false;
  }
}

/**
 * Load tokens - checks env var first, then file
 */
function loadTokens(service, filePath) {
  const envVarName = TOKEN_ENV_VARS[service] || `${service.toUpperCase()}_TOKENS`;
  
  // First, check environment variable (Railway persistent storage)
  const envToken = process.env[envVarName];
  if (envToken) {
    try {
      const decoded = Buffer.from(envToken, 'base64').toString('utf8');
      const tokens = JSON.parse(decoded);
      logger.info(`${service} tokens loaded from env var ${envVarName}`);
      return tokens;
    } catch (error) {
      logger.warn(`Failed to parse ${service} tokens from env var`, { error: error.message });
    }
  }
  
  // Fall back to file (local development)
  try {
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath, 'utf8');
      const tokens = JSON.parse(data);
      logger.info(`${service} tokens loaded from file`);
      return tokens;
    }
  } catch (error) {
    logger.warn(`Failed to load ${service} tokens from file`, { error: error.message });
  }
  
  return null;
}

/**
 * Check if tokens exist (in env var or file)
 */
function hasTokens(service, filePath) {
  const envVarName = TOKEN_ENV_VARS[service] || `${service.toUpperCase()}_TOKENS`;
  return !!process.env[envVarName] || fs.existsSync(filePath);
}

module.exports = {
  saveTokens,
  loadTokens,
  hasTokens,
  TOKEN_ENV_VARS
};
