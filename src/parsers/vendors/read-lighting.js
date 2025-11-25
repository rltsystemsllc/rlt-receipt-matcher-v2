/**
 * Read Lighting Receipt Parser
 * Specialized parsing for Read Lighting invoices and receipts
 */

const { parseCurrency, parseDate } = require('../../utils/helpers');
const logger = require('../../utils/logger');

class ReadLightingParser {
  /**
   * Parse Read Lighting receipt/invoice text
   */
  parse(text, sourceType) {
    try {
      const result = {
        total: null,
        subtotal: null,
        tax: null,
        date: null,
        orderNumber: null,
        invoiceNumber: null,
        poNumber: null,
        cardLast4: null,
        paymentMethod: null,
        lineItems: [],
        confidence: 'medium'
      };

      // Read Lighting invoice patterns
      const totalPatterns = [
        /(?:invoice\s*)?total[:\s]*\$?([\d,]+\.?\d*)/i,
        /amount\s*due[:\s]*\$?([\d,]+\.?\d*)/i,
        /grand\s*total[:\s]*\$?([\d,]+\.?\d*)/i,
        /balance\s*due[:\s]*\$?([\d,]+\.?\d*)/i
      ];

      for (const pattern of totalPatterns) {
        const match = text.match(pattern);
        if (match) {
          result.total = parseCurrency(match[1]);
          if (result.total) break;
        }
      }

      // Subtotal
      const subtotalMatch = text.match(/subtotal[:\s]*\$?([\d,]+\.?\d*)/i);
      if (subtotalMatch) {
        result.subtotal = parseCurrency(subtotalMatch[1]);
      }

      // Tax
      const taxMatch = text.match(/(?:sales\s*)?tax[:\s]*\$?([\d,]+\.?\d*)/i);
      if (taxMatch) {
        result.tax = parseCurrency(taxMatch[1]);
      }

      // Date patterns
      const datePatterns = [
        /invoice\s*date[:\s]*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i,
        /date[:\s]*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i,
        /(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/
      ];

      for (const pattern of datePatterns) {
        const match = text.match(pattern);
        if (match) {
          result.date = parseDate(match[1]);
          if (result.date) break;
        }
      }

      // Invoice Number
      const invoiceMatch = text.match(/invoice\s*(?:#|number|no\.?)?[:\s]*(\w+)/i);
      if (invoiceMatch) {
        result.invoiceNumber = invoiceMatch[1];
      }

      // Order Number
      const orderMatch = text.match(/order\s*(?:#|number)?[:\s]*(\w+)/i);
      if (orderMatch) {
        result.orderNumber = orderMatch[1];
      }

      // PO Number
      const poMatch = text.match(/(?:p\.?o\.?|purchase\s*order)\s*(?:#|number)?[:\s]*([\w\-]+)/i);
      if (poMatch) {
        result.poNumber = poMatch[1];
      }

      // Payment method
      const cardMatch = text.match(/(visa|mastercard|amex|discover)[^\d]*(\d{4})/i);
      if (cardMatch) {
        result.paymentMethod = cardMatch[1].toUpperCase();
        result.cardLast4 = cardMatch[2];
      }

      // Extract line items
      result.lineItems = this.extractLineItems(text);

      // Calculate confidence
      if (result.total && result.date && (result.invoiceNumber || result.orderNumber)) {
        result.confidence = 'high';
      } else if (result.total && result.date) {
        result.confidence = 'medium';
      } else {
        result.confidence = 'low';
      }

      if (result.total || result.lineItems.length > 0) {
        logger.info('Read Lighting parser extracted receipt', {
          total: result.total,
          items: result.lineItems.length,
          invoiceNumber: result.invoiceNumber,
          confidence: result.confidence
        });
        return result;
      }

      return null;
    } catch (error) {
      logger.error('Read Lighting parsing failed', { error: error.message });
      return null;
    }
  }

  /**
   * Parse HTML content
   */
  parseHtml(htmlContent, extracted) {
    // Fall back to text parsing
    return this.parse(extracted.text, 'html');
  }

  /**
   * Extract line items from invoice
   */
  extractLineItems(text) {
    const items = [];
    const lines = text.split('\n');

    // Common invoice patterns
    const patterns = [
      // Part# | Description | Qty | Unit Price | Ext Price
      /^\s*(\w{3,15})\s+(.{10,50}?)\s+(\d+)\s+\$?([\d,]+\.\d{2})\s+\$?([\d,]+\.\d{2})/,
      // Description | Qty | Price
      /^\s*(.{10,50}?)\s+(\d+)\s+@?\s*\$?([\d,]+\.\d{2})/,
      // Simpler: Description $Price
      /^\s*(.{5,60}?)\s+\$?([\d,]+\.\d{2})\s*$/
    ];

    for (const line of lines) {
      for (const pattern of patterns) {
        const match = line.match(pattern);
        if (match) {
          if (match.length === 6) {
            // Full pattern with part number
            items.push({
              sku: match[1].trim(),
              description: match[2].trim(),
              quantity: parseInt(match[3], 10),
              unitPrice: parseCurrency(match[4]),
              totalPrice: parseCurrency(match[5])
            });
          } else if (match.length === 4) {
            // Description, Qty, Price
            items.push({
              description: match[1].trim(),
              quantity: parseInt(match[2], 10),
              totalPrice: parseCurrency(match[3])
            });
          } else if (match.length === 3) {
            // Simple description + price
            const description = match[1].trim();
            // Skip summary lines
            if (!/^(subtotal|total|tax|shipping|discount)/i.test(description)) {
              items.push({
                description,
                quantity: 1,
                totalPrice: parseCurrency(match[2])
              });
            }
          }
          break;
        }
      }
    }

    return items.slice(0, 50);
  }
}

// Singleton instance
const readLightingParser = new ReadLightingParser();

module.exports = readLightingParser;

