/**
 * QuickBooks Online API Client
 * Handles OAuth and API connection to QuickBooks
 */

const OAuthClient = require('intuit-oauth');
const fs = require('fs').promises;
const path = require('path');
const config = require('../../config');
const logger = require('../../utils/logger');

class QuickBooksClient {
  constructor() {
    this.oauthClient = null;
    this.isAuthenticated = false;
    this.companyId = null;
  }

  /**
   * Initialize OAuth client
   */
  initialize() {
    this.oauthClient = new OAuthClient({
      clientId: config.quickbooks.clientId,
      clientSecret: config.quickbooks.clientSecret,
      environment: config.quickbooks.environment,
      redirectUri: config.quickbooks.redirectUri
    });

    return this;
  }

  /**
   * Generate OAuth authorization URL
   */
  getAuthUrl() {
    if (!this.oauthClient) {
      this.initialize();
    }

    return this.oauthClient.authorizeUri({
      scope: config.quickbooks.scopes,
      state: 'rlt-receipt-matcher'
    });
  }

  /**
   * Exchange authorization code for tokens
   */
  async handleCallback(url) {
    if (!this.oauthClient) {
      this.initialize();
    }

    try {
      const authResponse = await this.oauthClient.createToken(url);
      const tokens = authResponse.getJson();

      // Extract company ID from response
      this.companyId = this.oauthClient.getToken().realmId;

      await this.saveTokens({
        ...tokens,
        realmId: this.companyId
      });

      this.isAuthenticated = true;
      logger.qbo('authenticated', { companyId: this.companyId });

      return true;
    } catch (error) {
      logger.error('QuickBooks OAuth callback failed', { error: error.message });
      throw error;
    }
  }

  /**
   * Load saved tokens and authenticate
   */
  async authenticate() {
    if (!this.oauthClient) {
      this.initialize();
    }

    try {
      const tokens = await this.loadTokens();

      if (!tokens) {
        logger.warn('No QuickBooks tokens found. Please authenticate via /auth/quickbooks');
        return false;
      }

      this.oauthClient.setToken(tokens);
      this.companyId = tokens.realmId || config.quickbooks.realmId;

      // Check if token needs refresh
      if (this.oauthClient.isAccessTokenValid()) {
        this.isAuthenticated = true;
        logger.qbo('authenticated from saved tokens', { companyId: this.companyId });
        return true;
      }

      // Try to refresh
      return await this.refreshTokens();
    } catch (error) {
      logger.error('QuickBooks authentication failed', { error: error.message });
      return false;
    }
  }

  /**
   * Refresh access tokens
   */
  async refreshTokens() {
    try {
      const authResponse = await this.oauthClient.refresh();
      const tokens = authResponse.getJson();

      await this.saveTokens({
        ...tokens,
        realmId: this.companyId
      });

      this.isAuthenticated = true;
      logger.qbo('tokens refreshed', {});

      return true;
    } catch (error) {
      logger.error('QuickBooks token refresh failed', { error: error.message });
      this.isAuthenticated = false;
      return false;
    }
  }

  /**
   * Save tokens to file
   */
  async saveTokens(tokens) {
    try {
      const tokenDir = path.dirname(config.quickbooks.tokenPath);
      await fs.mkdir(tokenDir, { recursive: true });
      await fs.writeFile(config.quickbooks.tokenPath, JSON.stringify(tokens, null, 2));
      logger.info('QuickBooks tokens saved');
    } catch (error) {
      logger.error('Failed to save QuickBooks tokens', { error: error.message });
      throw error;
    }
  }

  /**
   * Load tokens from file
   */
  async loadTokens() {
    // First check for environment variable (for Railway deployment)
    if (process.env.QBO_TOKEN_JSON) {
      try {
        return JSON.parse(process.env.QBO_TOKEN_JSON);
      } catch {
        logger.warn('Failed to parse QBO_TOKEN_JSON env var');
      }
    }
    
    // Fall back to file (local development)
    try {
      const data = await fs.readFile(config.quickbooks.tokenPath, 'utf8');
      return JSON.parse(data);
    } catch {
      return null;
    }
  }

  /**
   * Make authenticated API request
   */
  async makeApiCall(method, endpoint, body = null) {
    if (!this.isAuthenticated) {
      throw new Error('QuickBooks client not authenticated');
    }

    // Ensure token is valid
    if (!this.oauthClient.isAccessTokenValid()) {
      const refreshed = await this.refreshTokens();
      if (!refreshed) {
        throw new Error('Failed to refresh QuickBooks token');
      }
    }

    const baseUrl = config.quickbooks.environment === 'sandbox'
      ? 'https://sandbox-quickbooks.api.intuit.com'
      : 'https://quickbooks.api.intuit.com';

    const url = `${baseUrl}/v3/company/${this.companyId}${endpoint}`;

    try {
      let response;

      if (method === 'GET') {
        response = await this.oauthClient.makeApiCall({
          url,
          method: 'GET'
        });
      } else {
        response = await this.oauthClient.makeApiCall({
          url,
          method,
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(body)
        });
      }

      // Handle response - getJson() only works for token responses
      // For API calls, response.body contains the JSON or response.json
      if (response && typeof response.getJson === 'function') {
        return response.getJson();
      } else if (response && response.body) {
        // Response body might be string or object
        if (typeof response.body === 'string') {
          return JSON.parse(response.body);
        }
        return response.body;
      } else if (response && response.json) {
        return response.json;
      }
      
      return response;
    } catch (error) {
      logger.error('QuickBooks API call failed', {
        endpoint,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Check if client is authenticated
   */
  checkAuth() {
    return this.isAuthenticated && this.companyId !== null;
  }

  /**
   * Get company ID
   */
  getCompanyId() {
    return this.companyId;
  }
}

// Singleton instance
const qboClient = new QuickBooksClient();

module.exports = qboClient;


