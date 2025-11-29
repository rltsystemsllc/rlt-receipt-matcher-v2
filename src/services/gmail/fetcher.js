/**
 * Gmail Email Fetcher
 * Fetches unread receipt emails from Gmail
 */

const gmailClient = require('./client');
const config = require('../../config');
const logger = require('../../utils/logger');
const { detectVendor } = require('../../config/vendors');

class GmailFetcher {
  constructor() {
    this.processedLabelId = null;
  }

  /**
   * Ensure the processed label exists in Gmail
   */
  async ensureProcessedLabel() {
    if (this.processedLabelId) {
      return this.processedLabelId;
    }

    const gmail = gmailClient.getApi();

    try {
      // Try to find existing label
      const labelsResponse = await gmail.users.labels.list({ userId: 'me' });
      const existingLabel = labelsResponse.data.labels.find(
        label => label.name === config.gmail.processedLabel
      );

      if (existingLabel) {
        this.processedLabelId = existingLabel.id;
        return this.processedLabelId;
      }

      // Create new label
      const createResponse = await gmail.users.labels.create({
        userId: 'me',
        requestBody: {
          name: config.gmail.processedLabel,
          labelListVisibility: 'labelShow',
          messageListVisibility: 'show'
        }
      });

      this.processedLabelId = createResponse.data.id;
      logger.gmail('created label', { label: config.gmail.processedLabel });

      return this.processedLabelId;
    } catch (error) {
      logger.error('Failed to ensure processed label', { error: error.message });
      throw error;
    }
  }

  /**
   * Build Gmail search query for receipt emails
   */
  buildSearchQuery() {
    // Search for unread emails that might be receipts
    // Excludes already processed emails
    const vendorKeywords = [
      'home depot',
      'lowes',
      "lowe's",
      'amazon',
      'ced',
      'menards',
      'ace hardware',
      'grainger',
      'receipt',
      'order confirmation',
      'invoice',
      'your order'
    ];

    const orQuery = vendorKeywords.map(k => `"${k}"`).join(' OR ');

    return `is:unread -label:${config.gmail.processedLabel} (${orQuery})`;
  }

  /**
   * Fetch unread receipt emails
   */
  async fetchUnreadReceipts(maxResults = 50) {
    if (!gmailClient.checkAuth()) {
      throw new Error('Gmail client not authenticated');
    }

    const gmail = gmailClient.getApi();

    try {
      // Search for receipt emails
      const searchResponse = await gmail.users.messages.list({
        userId: 'me',
        q: this.buildSearchQuery(),
        maxResults
      });

      const messages = searchResponse.data.messages || [];

      if (messages.length === 0) {
        logger.gmail('no new receipts found', {});
        return [];
      }

      logger.gmail('found potential receipts', { count: messages.length });

      // Fetch full message details
      const emails = await Promise.all(
        messages.map(msg => this.fetchMessage(msg.id))
      );

      return emails.filter(email => email !== null);
    } catch (error) {
      logger.error('Failed to fetch unread receipts', { error: error.message });
      throw error;
    }
  }

  /**
   * Fetch a single message with full details
   */
  async fetchMessage(messageId) {
    const gmail = gmailClient.getApi();

    try {
      const response = await gmail.users.messages.get({
        userId: 'me',
        id: messageId,
        format: 'full'
      });

      const message = response.data;
      const headers = this.parseHeaders(message.payload.headers);

      const email = {
        id: message.id,
        threadId: message.threadId,
        from: headers.from,
        to: headers.to,
        subject: headers.subject,
        date: headers.date,
        snippet: message.snippet,
        body: {
          text: null,
          html: null
        },
        attachments: [],
        vendor: null
      };

      // Extract body content
      this.extractBody(message.payload, email);

      // Extract attachments info
      this.extractAttachments(message.payload, email, messageId);

      // Detect vendor
      email.vendor = detectVendor(email);

      return email;
    } catch (error) {
      logger.error('Failed to fetch message', { messageId, error: error.message });
      return null;
    }
  }

  /**
   * Parse email headers into object
   */
  parseHeaders(headers) {
    const result = {};
    const headerMap = {
      'From': 'from',
      'To': 'to',
      'Subject': 'subject',
      'Date': 'date'
    };

    for (const header of headers) {
      const key = headerMap[header.name];
      if (key) {
        result[key] = header.value;
      }
    }

    return result;
  }

  /**
   * Extract body content from message payload
   */
  extractBody(payload, email) {
    if (!payload) return;

    // Direct body
    if (payload.body && payload.body.data) {
      const content = Buffer.from(payload.body.data, 'base64').toString('utf8');
      if (payload.mimeType === 'text/plain') {
        email.body.text = content;
      } else if (payload.mimeType === 'text/html') {
        email.body.html = content;
      }
    }

    // Check parts
    if (payload.parts) {
      for (const part of payload.parts) {
        if (part.mimeType === 'text/plain' && part.body.data) {
          email.body.text = Buffer.from(part.body.data, 'base64').toString('utf8');
        } else if (part.mimeType === 'text/html' && part.body.data) {
          email.body.html = Buffer.from(part.body.data, 'base64').toString('utf8');
        } else if (part.parts) {
          // Nested multipart
          this.extractBody(part, email);
        }
      }
    }
  }

  /**
   * Extract attachment information from message payload
   */
  extractAttachments(payload, email, messageId) {
    if (!payload) return;

    if (payload.parts) {
      for (const part of payload.parts) {
        if (part.filename && part.body.attachmentId) {
          email.attachments.push({
            id: part.body.attachmentId,
            messageId: messageId,
            filename: part.filename,
            mimeType: part.mimeType,
            size: part.body.size
          });
        }

        // Check nested parts
        if (part.parts) {
          this.extractAttachments(part, email, messageId);
        }
      }
    }
  }

  /**
   * Download an attachment
   */
  async downloadAttachment(messageId, attachmentId) {
    const gmail = gmailClient.getApi();

    try {
      const response = await gmail.users.messages.attachments.get({
        userId: 'me',
        messageId,
        id: attachmentId
      });

      // Return as Buffer
      return Buffer.from(response.data.data, 'base64');
    } catch (error) {
      logger.error('Failed to download attachment', { messageId, attachmentId, error: error.message });
      throw error;
    }
  }

  /**
   * Mark email as processed (add label)
   */
  async markAsProcessed(messageId) {
    const gmail = gmailClient.getApi();
    const labelId = await this.ensureProcessedLabel();

    try {
      await gmail.users.messages.modify({
        userId: 'me',
        id: messageId,
        requestBody: {
          addLabelIds: [labelId],
          removeLabelIds: ['UNREAD']
        }
      });

      logger.gmail('marked as processed', { messageId });
    } catch (error) {
      logger.error('Failed to mark message as processed', { messageId, error: error.message });
      throw error;
    }
  }

  /**
   * Mark email as having an error (for retry later)
   */
  async markAsError(messageId, errorMessage) {
    // For now, just log it - could add an error label later
    logger.gmail('processing error', { messageId, error: errorMessage });
  }
}

// Singleton instance
const gmailFetcher = new GmailFetcher();

module.exports = gmailFetcher;




