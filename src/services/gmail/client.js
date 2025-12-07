/**
 * Gmail API Client
 * Handles authentication and provides Gmail API access
 */

const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const config = require('../../config');
const logger = require('../../utils/logger');
const tokenStore = require('../token-store');

class GmailClient {
  constructor() {
    this.oauth2Client = null;
    this.gmail = null;
    this.authenticated = false;
  }

  /**
   * Initialize OAuth2 client
   */
  initialize() {
    if (this.oauth2Client) return;

    this.oauth2Client = new google.auth.OAuth2(
      config.gmail.clientId,
      config.gmail.clientSecret,
      config.gmail.redirectUri
    );

    // Set up token refresh handler
    this.oauth2Client.on('tokens', (tokens) => {
      if (tokens.refresh_token) {
        this.saveTokens(tokens);
      }
    });
  }

  /**
   * Get OAuth authorization URL
   */
  getAuthUrl(scopes = null) {
    this.initialize();

    const defaultScopes = [
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.modify',
      'https://www.googleapis.com/auth/gmail.labels'
    ];

    return this.oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: scopes || defaultScopes,
      prompt: 'consent'
    });
  }

  /**
   * Handle OAuth callback
   */
  async handleCallback(code, tokenPath = null) {
    this.initialize();

    try {
      const { tokens } = await this.oauth2Client.getToken(code);
      this.oauth2Client.setCredentials(tokens);
      
      // Save tokens
      this.saveTokens(tokens, tokenPath);
      
      // Initialize Gmail API
      this.gmail = google.gmail({ version: 'v1', auth: this.oauth2Client });
      this.authenticated = true;
      
      logger.info('Gmail authenticated successfully');
      return true;
    } catch (error) {
      logger.error('Gmail OAuth callback failed', { error: error.message });
      throw error;
    }
  }

  /**
   * Authenticate using saved tokens
   */
  async authenticate() {
    this.initialize();

    try {
      const tokens = this.loadTokens();
      
      if (!tokens) {
        logger.warn('No Gmail tokens found');
        return false;
      }

      this.oauth2Client.setCredentials(tokens);
      
      // Check if token needs refresh
      if (tokens.expiry_date && tokens.expiry_date < Date.now()) {
        logger.info('Gmail token expired, refreshing...');
        const { credentials } = await this.oauth2Client.refreshAccessToken();
        this.saveTokens(credentials);
      }
      
      // Initialize Gmail API
      this.gmail = google.gmail({ version: 'v1', auth: this.oauth2Client });
      this.authenticated = true;
      
      logger.info('Gmail authenticated from saved tokens');
      return true;
    } catch (error) {
      logger.error('Gmail authentication failed', { error: error.message });
      return false;
    }
  }

  /**
   * Check if authenticated
   */
  checkAuth() {
    return this.authenticated && this.gmail !== null;
  }

  /**
   * Check if authenticated (alias)
   */
  isAuthenticated() {
    return this.checkAuth();
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
   * Save tokens to file and env var
   */
  saveTokens(tokens, tokenPath = null) {
    const savePath = path.resolve(tokenPath || config.gmail.tokenPath);
    
    // Determine service name based on token path
    const serviceName = tokenPath && tokenPath.includes('sheets') ? 'sheets' : 'gmail';
    
    // Merge with existing tokens to preserve refresh_token
    const existingTokens = tokenStore.loadTokens(serviceName, savePath) || {};
    
    const mergedTokens = {
      ...existingTokens,
      ...tokens
    };
    
    // Use token store (saves to file + logs env var for Railway)
    tokenStore.saveTokens(serviceName, mergedTokens, savePath);
  }

  /**
   * Load tokens from env var or file
   */
  loadTokens(tokenPath = null) {
    const loadPath = path.resolve(tokenPath || config.gmail.tokenPath);
    
    // Determine service name based on token path
    const serviceName = tokenPath && tokenPath.includes('sheets') ? 'sheets' : 'gmail';
    
    return tokenStore.loadTokens(serviceName, loadPath);
  }

  /**
   * Get authentication status
   */
  getStatus() {
    const tokens = this.loadTokens();
    
    return {
      hasTokens: !!tokens,
      authenticated: this.authenticated,
      email: config.gmail.userEmail,
      tokenExpiry: tokens?.expiry_date ? new Date(tokens.expiry_date) : null
    };
  }
}

// Singleton instance
const client = new GmailClient();

module.exports = client;
