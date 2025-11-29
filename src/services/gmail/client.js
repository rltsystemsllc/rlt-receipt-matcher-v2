/**
 * Gmail API Client
 * Handles OAuth and API connection to Gmail
 */

const { google } = require('googleapis');
const fs = require('fs').promises;
const path = require('path');
const config = require('../../config');
const logger = require('../../utils/logger');

class GmailClient {
  constructor() {
    this.oauth2Client = null;
    this.gmail = null;
    this.isAuthenticated = false;
  }

  /**
   * Initialize OAuth2 client
   */
  initialize() {
    this.oauth2Client = new google.auth.OAuth2(
      config.gmail.clientId,
      config.gmail.clientSecret,
      config.gmail.redirectUri
    );

    // Set up token refresh handler
    this.oauth2Client.on('tokens', async (tokens) => {
      logger.info('Gmail tokens refreshed');
      await this.saveTokens(tokens);
    });

    return this;
  }

  /**
   * Generate OAuth authorization URL
   */
  getAuthUrl() {
    if (!this.oauth2Client) {
      this.initialize();
    }

    return this.oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: config.gmail.scopes,
      prompt: 'consent' // Force consent to get refresh token
    });
  }

  /**
   * Exchange authorization code for tokens
   */
  async handleCallback(code) {
    if (!this.oauth2Client) {
      this.initialize();
    }

    try {
      const { tokens } = await this.oauth2Client.getToken(code);
      this.oauth2Client.setCredentials(tokens);
      await this.saveTokens(tokens);

      this.gmail = google.gmail({ version: 'v1', auth: this.oauth2Client });
      this.isAuthenticated = true;

      logger.gmail('authenticated', { email: config.gmail.userEmail });
      return true;
    } catch (error) {
      logger.error('Gmail OAuth callback failed', { error: error.message });
      throw error;
    }
  }

  /**
   * Load saved tokens and authenticate
   */
  async authenticate() {
    if (!this.oauth2Client) {
      this.initialize();
    }

    try {
      const tokens = await this.loadTokens();

      if (!tokens) {
        logger.warn('No Gmail tokens found. Please authenticate via /auth/gmail');
        return false;
      }

      this.oauth2Client.setCredentials(tokens);
      this.gmail = google.gmail({ version: 'v1', auth: this.oauth2Client });
      this.isAuthenticated = true;

      logger.gmail('authenticated from saved tokens', {});
      return true;
    } catch (error) {
      logger.error('Gmail authentication failed', { error: error.message });
      return false;
    }
  }

  /**
   * Save tokens to file
   */
  async saveTokens(tokens) {
    try {
      const tokenDir = path.dirname(config.gmail.tokenPath);
      await fs.mkdir(tokenDir, { recursive: true });

      // Merge with existing tokens to preserve refresh_token
      let existingTokens = {};
      try {
        const existing = await fs.readFile(config.gmail.tokenPath, 'utf8');
        existingTokens = JSON.parse(existing);
      } catch {
        // No existing tokens
      }

      const mergedTokens = { ...existingTokens, ...tokens };
      await fs.writeFile(config.gmail.tokenPath, JSON.stringify(mergedTokens, null, 2));

      logger.info('Gmail tokens saved');
    } catch (error) {
      logger.error('Failed to save Gmail tokens', { error: error.message });
      throw error;
    }
  }

  /**
   * Load tokens from env var (Railway) or file (local)
   */
  async loadTokens() {
    // First check for environment variable (for Railway deployment)
    if (process.env.GMAIL_TOKEN_JSON) {
      try {
        return JSON.parse(process.env.GMAIL_TOKEN_JSON);
      } catch {
        logger.warn('Failed to parse GMAIL_TOKEN_JSON env var');
      }
    }
    
    // Fall back to file (local development)
    try {
      const data = await fs.readFile(config.gmail.tokenPath, 'utf8');
      return JSON.parse(data);
    } catch {
      return null;
    }
  }

  /**
   * Get Gmail API instance
   */
  getApi() {
    if (!this.gmail) {
      throw new Error('Gmail client not authenticated');
    }
    return this.gmail;
  }

  /**
   * Check if client is authenticated
   */
  checkAuth() {
    return this.isAuthenticated && this.gmail !== null;
  }

  /**
   * Get current user's email profile
   */
  async getProfile() {
    if (!this.checkAuth()) {
      throw new Error('Gmail client not authenticated');
    }

    const response = await this.gmail.users.getProfile({
      userId: 'me'
    });

    return response.data;
  }
}

// Singleton instance
const gmailClient = new GmailClient();

module.exports = gmailClient;




