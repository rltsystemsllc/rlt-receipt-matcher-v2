/**
 * Home Depot Receipt Parser
 * Specialized parsing for Home Depot receipts (usually PDF)
 */

const { parseCurrency, parseDate, extractCardLast4 } = require('../../utils/helpers');
const logger = require('../../utils/logger');

class HomeDepotParser {
  /**
   * Parse Home Depot receipt text
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
        cardLast4: null,
        paymentMethod: null,
        storeNumber: null,
        lineItems: [],
        confidence: 'medium'
      };

      // Home Depot specific patterns
      // Order Total
      const totalMatch = text.match(/(?:order\s*total|total)[:\s]*\$?([\d,]+\.?\d*)/i);
      if (totalMatch) {
        result.total = parseCurrency(totalMatch[1]);
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

      // Order Date - Home Depot format
      const datePatterns = [
        /order\s*date[:\s]*(\d{1,2}\/\d{1,2}\/\d{2,4})/i,
        /date[:\s]*(\d{1,2}\/\d{1,2}\/\d{2,4})/i,
        /(\d{1,2}\/\d{1,2}\/\d{2,4})/
      ];

      for (const pattern of datePatterns) {
        const match = text.match(pattern);
        if (match) {
          result.date = parseDate(match[1]);
          if (result.date) break;
        }
      }

      // Order Number
      const orderMatch = text.match(/order\s*#?[:\s]*(\w[\w\-]*\w)/i);
      if (orderMatch) {
        result.orderNumber = orderMatch[1];
      }

      // Store Number
      const storeMatch = text.match(/store\s*#?[:\s]*(\d+)/i);
      if (storeMatch) {
        result.storeNumber = storeMatch[1];
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
      if (result.total && result.date && result.orderNumber) {
        result.confidence = 'high';
      } else if (result.total && result.date) {
        result.confidence = 'medium';
      } else {
        result.confidence = 'low';
      }

      if (result.total || result.lineItems.length > 0) {
        logger.info('Home Depot parser extracted receipt', {
          total: result.total,
          items: result.lineItems.length,
          confidence: result.confidence
        });
        return result;
      }

      return null;
    } catch (error) {
      logger.error('Home Depot parsing failed', { error: error.message });
      return null;
    }
  }

  /**
   * Parse HTML content (less common for Home Depot)
   */
  parseHtml(htmlContent, extracted) {
    // Fall back to text parsing from extracted data
    return this.parse(extracted.text, 'html');
  }

  /**
   * Extract line items from Home Depot receipt
   */
  extractLineItems(text) {
    const items = [];
    const lines = text.split('\n');

    // Home Depot SKU pattern: typically 6-8 digit number
    const skuPattern = /^\s*(\d{6,8})\s+(.+?)\s+(\d+)\s+\$?([\d,]+\.\d{2})/;

    // Alternative pattern without SKU
    const altPattern = /^\s*(.+?)\s+(\d+)\s+@\s*\$?([\d,]+\.\d{2})\s+\$?([\d,]+\.\d{2})/;

    for (const line of lines) {
      // Try SKU pattern first
      let match = line.match(skuPattern);
      if (match) {
        items.push({
          sku: match[1],
          description: match[2].trim(),
          quantity: parseInt(match[3], 10),
          totalPrice: parseCurrency(match[4])
        });
        continue;
      }

      // Try alternative pattern
      match = line.match(altPattern);
      if (match) {
        items.push({
          description: match[1].trim(),
          quantity: parseInt(match[2], 10),
          unitPrice: parseCurrency(match[3]),
          totalPrice: parseCurrency(match[4])
        });
      }
    }

    return items;
  }
}

// Singleton instance
const homeDepotParser = new HomeDepotParser();

module.exports = homeDepotParser;


