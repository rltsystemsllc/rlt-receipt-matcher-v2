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
  'sheets': 'SHEETS_TOKENS',
  'ringcentral': 'RINGCENTRAL_TOKENS'
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
    logger.info(`${service} tokens saved to file`, { path: filePath });
    
    // Generate base64 for env var
    const base64Token = Buffer.from(JSON.stringify(tokenData)).toString('base64');
    const envVarName = TOKEN_ENV_VARS[service] || `${service.toUpperCase()}_TOKENS`;
    
    // Log instructions for Railway
    logger.info('='.repeat(60));
    logger.info(`📋 TO PERSIST ${service.toUpperCase()} TOKENS IN RAILWAY:`);
    logger.info(`   1. Go to Railway → Variables`);
    logger.info(`   2. Add: ${envVarName}`);
    logger.info(`   3. Value (copy this entire string):`);
    logger.info('='.repeat(60));
    console.log(`\n${envVarName}=${base64Token}\n`);
    logger.info('='.repeat(60));
    
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
  
  // First, check environment variable
  const envToken = process.env[envVarName];
  if (envToken) {
    try {
      const decoded = Buffer.from(envToken, 'base64').toString('utf8');
      const tokens = JSON.parse(decoded);
      logger.info(`${service} tokens loaded from environment variable`, { 
        envVar: envVarName,
        savedAt: tokens.savedAt 
      });
      return tokens;
    } catch (error) {
      logger.warn(`Failed to parse ${service} tokens from env var`, { error: error.message });
    }
  }
  
  // Fall back to file
  try {
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath, 'utf8');
      const tokens = JSON.parse(data);
      logger.info(`${service} tokens loaded from file`, { path: filePath });
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
  
  // Check env var first
  if (process.env[envVarName]) {
    return true;
  }
  
  // Check file
  return fs.existsSync(filePath);
}

/**
 * Delete tokens (file only - can't delete env vars at runtime)
 */
function deleteTokens(service, filePath) {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      logger.info(`${service} tokens deleted from file`);
    }
    
    const envVarName = TOKEN_ENV_VARS[service] || `${service.toUpperCase()}_TOKENS`;
    if (process.env[envVarName]) {
      logger.warn(`${service} tokens still exist in env var ${envVarName} - remove manually from Railway`);
    }
    
    return true;
  } catch (error) {
    logger.error(`Failed to delete ${service} tokens`, { error: error.message });
    return false;
  }
}

module.exports = {
  saveTokens,
  loadTokens,
  hasTokens,
  deleteTokens,
  TOKEN_ENV_VARS
};

