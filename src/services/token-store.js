/**
 * Token Store Service
 * 
 * Handles OAuth token persistence
 * - Saves to local files
 * - Logs env var value for Railway persistence
 */

const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

/**
 * Save tokens to file and log for Railway env var
 */
function saveTokens(serviceName, tokens, tokenPath) {
  if (!tokens) return;
  
  try {
    // Ensure directory exists
    const dir = path.dirname(tokenPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    // Save to file
    const tokenData = JSON.stringify(tokens, null, 2);
    fs.writeFileSync(tokenPath, tokenData, 'utf8');
    
    // Log env var for Railway (copy this to Railway env vars)
    const envVarName = `${serviceName.toUpperCase()}_TOKENS`;
    logger.info(`Tokens saved for ${serviceName}`, { 
      path: tokenPath,
      envVarName,
      envVarValue: JSON.stringify(tokens)
    });
    
    // Also set in process.env for current runtime
    process.env[envVarName] = JSON.stringify(tokens);
    
  } catch (error) {
    logger.error(`Failed to save tokens for ${serviceName}`, { error: error.message });
  }
}

/**
 * Load tokens from env var or file
 */
function loadTokens(serviceName, tokenPath) {
  const envVarName = `${serviceName.toUpperCase()}_TOKENS`;
  
  // First try environment variable (Railway)
  if (process.env[envVarName]) {
    try {
      const tokens = JSON.parse(process.env[envVarName]);
      logger.info(`Tokens loaded from env var for ${serviceName}`);
      return tokens;
    } catch (e) {
      logger.warn(`Failed to parse env tokens for ${serviceName}`, { error: e.message });
    }
  }
  
  // Then try file
  if (fs.existsSync(tokenPath)) {
    try {
      const data = fs.readFileSync(tokenPath, 'utf8');
      const tokens = JSON.parse(data);
      logger.info(`Tokens loaded from file for ${serviceName}`, { path: tokenPath });
      return tokens;
    } catch (e) {
      logger.warn(`Failed to load file tokens for ${serviceName}`, { error: e.message });
    }
  }
  
  return null;
}

/**
 * Clear tokens
 */
function clearTokens(serviceName, tokenPath) {
  const envVarName = `${serviceName.toUpperCase()}_TOKENS`;
  delete process.env[envVarName];
  
  if (fs.existsSync(tokenPath)) {
    fs.unlinkSync(tokenPath);
  }
  
  logger.info(`Tokens cleared for ${serviceName}`);
}

module.exports = {
  saveTokens,
  loadTokens,
  clearTokens
};
