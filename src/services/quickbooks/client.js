/**
 * QuickBooks Online API Client
 * Handles authentication and API requests to QuickBooks
 */

const OAuthClient = require('intuit-oauth');
const fs = require('fs');
const path = require('path');
const config = require('../../config');
const logger = require('../../utils/logger');

class QuickBooksClient {
  constructor() {
    this.oauthClient = null;
    this.companyId = null;
    this.baseUrl = null;
    this.initialized = false;
  }

  /**
   * Initialize the OAuth client
   */
  initialize() {
    if (this.initialized) return;

    const environment = config.quickbooks.environment === 'production' 
      ? 'production' 
      : 'sandbox';

    this.oauthClient = new OAuthClient({
      clientId: config.quickbooks.clientId,
      clientSecret: config.quickbooks.clientSecret,
      environment: environment,
      redirectUri: config.quickbooks.redirectUri
    });

    this.baseUrl = environment === 'production'
      ? 'https://quickbooks.api.intuit.com/v3/company'
      : 'https://sandbox-quickbooks.api.intuit.com/v3/company';

    this.initialized = true;
  }

  /**
   * Get the OAuth authorization URL
   */
  getAuthUrl() {
    this.initialize();
    
    return this.oauthClient.authorizeUri({
      scope: [OAuthClient.scopes.Accounting],
      state: 'rlt-receipt-matcher'
    });
  }

  /**
   * Handle OAuth callback and save tokens
   */
  async handleCallback(url) {
    this.initialize();

    try {
      const authResponse = await this.oauthClient.createToken(url);
      const tokens = authResponse.getJson();

      // Extract realmId from callback URL if not present in tokens
      try {
        const parsed = new URL(url);
        const realmIdFromUrl = parsed.searchParams.get('realmId');
        if (!tokens.realmId && realmIdFromUrl) {
          tokens.realmId = realmIdFromUrl;
        }
      } catch (e) {
        logger.warn('Could not parse realmId from callback URL', { error: e.message });
      }
      
      // Save tokens to file
      this.saveTokens(tokens);
      
      this.companyId = tokens.realmId || this.companyId || config.quickbooks.realmId || null;
      
      logger.info('QuickBooks authenticated successfully', { 
        companyId: this.companyId 
      });
      
      return true;
    } catch (error) {
      logger.error('QuickBooks OAuth callback failed', { 
        error: error.message 
      });
      throw error;
    }
  }

  /**
   * Authenticate using saved tokens
   */
  async authenticate() {
    this.initialize();

    logger.info('QBO authenticate() called');

    try {
      const tokens = this.loadTokens();
      
      if (!tokens) {
        logger.warn('No QuickBooks tokens found');
        return false;
      }

      // If the stored tokens are missing realmId, try to backfill from config
      if (!tokens.realmId && config.quickbooks.realmId) {
        tokens.realmId = config.quickbooks.realmId;
      }

      // Set the tokens on the OAuth client
      this.oauthClient.setToken(tokens);
      this.companyId = tokens.realmId || this.companyId || config.quickbooks.realmId || null;

      // Check if token is expired and refresh if needed
      if (this.oauthClient.isAccessTokenValid()) {
        logger.info('QuickBooks authenticated from saved tokens', { 
          companyId: this.companyId 
        });
        return true;
      }

      // Token expired, try to refresh
      logger.info('QuickBooks access token expired, refreshing...');
      
      const refreshResponse = await this.oauthClient.refresh();
      const newTokens = refreshResponse.getJson();
      
      // Preserve the realmId
      newTokens.realmId = this.companyId;
      
      this.saveTokens(newTokens);
      
      logger.info('QuickBooks token refreshed successfully');
      return true;
      
    } catch (error) {
      logger.error('QuickBooks authentication failed', { 
        error: error.message 
      });
      return false;
    }
  }

  /**
   * Make an API call to QuickBooks
   */
  async makeApiCall(method, endpoint, body = null) {
    if (!this.companyId) {
      throw new Error('QuickBooks not authenticated');
    }

    // Ensure we have a valid token
    if (!this.oauthClient.isAccessTokenValid()) {
      await this.refreshToken();
    }

    const url = `${this.baseUrl}/${this.companyId}${endpoint}`;
    
    const options = {
      method: method.toUpperCase(),
      headers: {
        'Authorization': `Bearer ${this.oauthClient.getToken().access_token}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      }
    };

    if (body && (method === 'POST' || method === 'PUT')) {
      options.body = JSON.stringify(body);
    }

    logger.qbo(`${method} ${endpoint}`, { 
      hasBody: !!body 
    });

    try {
      const response = await fetch(url, options);
      
      if (!response.ok) {
        const errorText = await response.text();
        let errorMessage = `QuickBooks API error: ${response.status}`;
        
        // Log full error for debugging
        logger.error('QuickBooks API raw error', {
          status: response.status,
          statusText: response.statusText,
          url: url,
          errorText: errorText.substring(0, 500)
        });
        
        try {
          const errorJson = JSON.parse(errorText);
          if (errorJson.Fault?.Error?.[0]?.Detail) {
            errorMessage = errorJson.Fault.Error[0].Detail;
          } else if (errorJson.Fault?.Error?.[0]?.Message) {
            errorMessage = errorJson.Fault.Error[0].Message;
          }
          // Log parsed error details
          if (errorJson.Fault?.Error) {
            logger.error('QuickBooks Fault details', { errors: errorJson.Fault.Error });
          }
        } catch {
          errorMessage = errorText || errorMessage;
        }
        
        throw new Error(errorMessage);
      }

      const data = await response.json();
      return data;
      
    } catch (error) {
      logger.error('QuickBooks API call failed', {
        method,
        endpoint,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Refresh the access token
   */
  async refreshToken() {
    try {
      logger.info('Refreshing QuickBooks access token...');
      
      const refreshResponse = await this.oauthClient.refresh();
      const newTokens = refreshResponse.getJson();
      
      // Preserve the realmId
      newTokens.realmId = this.companyId;
      
      this.saveTokens(newTokens);
      
      logger.info('QuickBooks token refreshed');
      return true;
      
    } catch (error) {
      logger.error('Failed to refresh QuickBooks token', { 
        error: error.message 
      });
      throw error;
    }
  }

  /**
   * Get the company ID
   */
  getCompanyId() {
    return this.companyId;
  }

  /**
   * Save tokens to file
   */
  saveTokens(tokens) {
    const tokenPath = path.resolve(config.quickbooks.tokenPath);
    const tokenDir = path.dirname(tokenPath);
    
    if (!fs.existsSync(tokenDir)) {
      fs.mkdirSync(tokenDir, { recursive: true });
    }
    
    // Add createdAt timestamp for token expiry validation
    const tokensToSave = {
      ...tokens,
      // Preserve/ensure realmId (fallback to current companyId or env)
      realmId: tokens.realmId || this.companyId || config.quickbooks.realmId || null,
      createdAt: Date.now()
    };
    
    fs.writeFileSync(tokenPath, JSON.stringify(tokensToSave, null, 2));
    logger.info('QuickBooks tokens saved');
  }

  /**
   * Load tokens from file
   */
  loadTokens() {
    const tokenPath = path.resolve(config.quickbooks.tokenPath);
    
    if (!fs.existsSync(tokenPath)) {
      return null;
    }
    
    try {
      const data = fs.readFileSync(tokenPath, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      logger.error('Failed to load QuickBooks tokens', { 
        error: error.message 
      });
      return null;
    }
  }

  /**
   * Check if authenticated
   */
  isAuthenticated() {
    logger.info('isAuthenticated check', { 
      hasCompanyId: !!this.companyId, 
      companyId: this.companyId,
      hasOauthClient: !!this.oauthClient 
    });
    
    // If companyId missing but tokens exist, try to set from tokens/config
    if (!this.companyId) {
      const tokens = this.loadTokens();
      if (tokens?.realmId) {
        this.companyId = tokens.realmId;
      } else if (config.quickbooks.realmId) {
        this.companyId = config.quickbooks.realmId;
      }
    }
    
    if (!this.companyId || !this.oauthClient) {
      logger.warn('Auth check failed: missing companyId or oauthClient');
      return false;
    }
    
    // Try the SDK method first
    const sdkValid = this.oauthClient.isAccessTokenValid();
    logger.info('SDK token validation', { isValid: sdkValid });
    
    if (sdkValid) {
      return true;
    }
    
    // Fallback: manually check token expiry from saved tokens
    const tokens = this.loadTokens();
    if (tokens && tokens.createdAt && tokens.expires_in) {
      const expiresAt = tokens.createdAt + (tokens.expires_in * 1000);
      const now = Date.now();
      const isValid = now < expiresAt;
      logger.info('Manual token validation', { expiresAt, now, isValid, createdAt: tokens.createdAt });
      if (isValid) {
        return true;
      }
    }
    
    // If we have a refresh token, we're still "authenticated" (can refresh)
    const hasRefreshToken = !!tokens?.refresh_token;
    logger.info('Refresh token check', { hasRefreshToken });
    return hasRefreshToken && this.companyId !== null;
  }

  /**
   * Check auth (alias for isAuthenticated)
   */
  checkAuth() {
    return this.isAuthenticated();
  }

  /**
   * Get authentication status for dashboard
   */
  getStatus() {
    const tokens = this.loadTokens();
    
    return {
      authenticated: this.isAuthenticated(),
      companyId: this.companyId,
      hasTokens: !!tokens,
      tokenExpiry: tokens?.expires_in ? new Date(Date.now() + tokens.expires_in * 1000) : null
    };
  }
}

// Singleton instance
const client = new QuickBooksClient();

module.exports = client;
