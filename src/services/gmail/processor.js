/**
 * Gmail Email Processor
 * Coordinates email processing pipeline
 */

const gmailFetcher = require('./fetcher');
const parserRouter = require('../../parsers');
const { createReceipt, addAttachment, addProcessingNote } = require('../../models/receipt');
const logger = require('../../utils/logger');

class GmailProcessor {
  /**
   * Process all unread receipt emails
   */
  async processNewEmails() {
    try {
      // Fetch unread receipt emails
      const emails = await gmailFetcher.fetchUnreadReceipts();

      if (emails.length === 0) {
        return { processed: 0, receipts: [] };
      }

      logger.info(`Processing ${emails.length} emails`);

      const results = [];

      for (const email of emails) {
        try {
          const receipt = await this.processEmail(email);
          if (receipt) {
            results.push(receipt);
          }
        } catch (error) {
          logger.error('Failed to process email', {
            emailId: email.id,
            subject: email.subject,
            error: error.message
          });
          await gmailFetcher.markAsError(email.id, error.message);
        }
      }

      return {
        processed: emails.length,
        receipts: results
      };
    } catch (error) {
      logger.error('Email processing batch failed', { error: error.message });
      throw error;
    }
  }

  /**
   * Process a single email into a receipt
   */
  async processEmail(email) {
    logger.gmail('processing email', {
      id: email.id,
      subject: email.subject,
      vendor: email.vendor?.name || 'Unknown'
    });

    // Create base receipt
    const receipt = createReceipt({
      sourceType: 'email',
      emailId: email.id,
      emailSubject: email.subject,
      receivedAt: email.date,
      vendorId: email.vendor?.vendorId,
      vendorName: email.vendor?.name,
      vendorDisplayName: email.vendor?.displayName,
      categoryName: email.vendor?.category || 'Materials & Supplies'
    });

    // Determine how to parse based on vendor and content
    let parsed = null;

    // Try PDF attachments first (most accurate)
    if (email.attachments.length > 0) {
      parsed = await this.processAttachments(email, receipt);
    }

    // Fall back to email body parsing
    if (!parsed) {
      parsed = await this.processEmailBody(email, receipt);
    }

    if (!parsed) {
      addProcessingNote(receipt, 'Could not extract receipt data from email');
      logger.warn('Could not parse receipt from email', { emailId: email.id });
      return null;
    }

    // Merge parsed data into receipt
    Object.assign(receipt.transaction, {
      date: parsed.date,
      total: parsed.total,
      subtotal: parsed.subtotal,
      tax: parsed.tax
    });

    Object.assign(receipt.payment, {
      method: parsed.paymentMethod,
      cardLast4: parsed.cardLast4
    });

    Object.assign(receipt.reference, {
      orderNumber: parsed.orderNumber,
      invoiceNumber: parsed.invoiceNumber
    });

    if (parsed.jobName) {
      receipt.job.name = parsed.jobName;
    }

    if (parsed.lineItems) {
      receipt.lineItems = parsed.lineItems;
    }

    // Mark email as processed
    await gmailFetcher.markAsProcessed(email.id);

    logger.receipt('parsed', receipt);

    return receipt;
  }

  /**
   * Process email attachments
   */
  async processAttachments(email, receipt) {
    for (const attachment of email.attachments) {
      // Check for PDF receipts
      if (attachment.mimeType === 'application/pdf' ||
          attachment.filename.toLowerCase().endsWith('.pdf')) {

        try {
          const data = await gmailFetcher.downloadAttachment(
            attachment.messageId,
            attachment.id
          );

          // Add attachment to receipt
          addAttachment(receipt, {
            type: 'pdf',
            filename: attachment.filename,
            mimeType: attachment.mimeType,
            data: data.toString('base64'),
            size: attachment.size
          });

          // Parse PDF
          const parsed = await parserRouter.parsePdf(data, email.vendor);
          if (parsed) {
            addProcessingNote(receipt, `Parsed from PDF: ${attachment.filename}`);
            return parsed;
          }
        } catch (error) {
          logger.error('Failed to process PDF attachment', {
            filename: attachment.filename,
            error: error.message
          });
        }
      }

      // Check for image receipts (Lowe's sometimes does this)
      if (attachment.mimeType.startsWith('image/')) {
        try {
          const data = await gmailFetcher.downloadAttachment(
            attachment.messageId,
            attachment.id
          );

          // Add attachment to receipt
          addAttachment(receipt, {
            type: 'image',
            filename: attachment.filename,
            mimeType: attachment.mimeType,
            data: data.toString('base64'),
            size: attachment.size
          });

          // Parse image with OCR
          const parsed = await parserRouter.parseImage(data, email.vendor);
          if (parsed) {
            addProcessingNote(receipt, `Parsed from image: ${attachment.filename}`);
            return parsed;
          }
        } catch (error) {
          logger.error('Failed to process image attachment', {
            filename: attachment.filename,
            error: error.message
          });
        }
      }
    }

    return null;
  }

  /**
   * Process email body content
   */
  async processEmailBody(email, receipt) {
    // Try HTML first (usually more structured)
    if (email.body.html) {
      try {
        const parsed = await parserRouter.parseHtml(email.body.html, email.vendor);
        if (parsed) {
          addProcessingNote(receipt, 'Parsed from HTML email body');
          return parsed;
        }
      } catch (error) {
        logger.error('Failed to parse HTML body', { error: error.message });
      }
    }

    // Fall back to plain text
    if (email.body.text) {
      try {
        const parsed = await parserRouter.parseText(email.body.text, email.vendor);
        if (parsed) {
          addProcessingNote(receipt, 'Parsed from plain text email body');
          return parsed;
        }
      } catch (error) {
        logger.error('Failed to parse text body', { error: error.message });
      }
    }

    return null;
  }
}

// Singleton instance
const gmailProcessor = new GmailProcessor();

module.exports = gmailProcessor;


