/**
 * CED (Consolidated Electrical Distributors) Receipt Parser
 * Specialized parsing for CED invoices and receipts
 */

const { parseCurrency, parseDate } = require('../../utils/helpers');
const logger = require('../../utils/logger');

class CedParser {
  /**
   * Parse CED receipt/invoice text (usually PDF)
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
        accountNumber: null,
        lineItems: [],
        confidence: 'medium'
      };

      // CED invoice total patterns
      const totalPatterns = [
        /(?:invoice\s*)?total[:\s]*\$?([\d,]+\.?\d*)/i,
        /amount\s*due[:\s]*\$?([\d,]+\.?\d*)/i,
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
      const subtotalMatch = text.match(/(?:merchandise\s*)?subtotal[:\s]*\$?([\d,]+\.?\d*)/i);
      if (subtotalMatch) {
        result.subtotal = parseCurrency(subtotalMatch[1]);
      }

      // Tax
      const taxMatch = text.match(/(?:sales\s*)?tax[:\s]*\$?([\d,]+\.?\d*)/i);
      if (taxMatch) {
        result.tax = parseCurrency(taxMatch[1]);
      }

      // Invoice date
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

      // PO Number (common for electrical contractors)
      const poMatch = text.match(/(?:p\.?o\.?|purchase\s*order)\s*(?:#|number)?[:\s]*([\w\-]+)/i);
      if (poMatch) {
        result.poNumber = poMatch[1];
      }

      // Account Number
      const accountMatch = text.match(/account\s*(?:#|number)?[:\s]*(\d+)/i);
      if (accountMatch) {
        result.accountNumber = accountMatch[1];
      }

      // Payment method
      const cardMatch = text.match(/(visa|mastercard|amex|discover)[^\d]*(\d{4})/i);
      if (cardMatch) {
        result.paymentMethod = cardMatch[1].toUpperCase();
        result.cardLast4 = cardMatch[2];
      }

      // Extract line items (electrical parts)
      result.lineItems = this.extractLineItems(text);

      // Calculate confidence
      if (result.total && result.date && (result.invoiceNumber || result.poNumber)) {
        result.confidence = 'high';
      } else if (result.total && result.date) {
        result.confidence = 'medium';
      } else {
        result.confidence = 'low';
      }

      if (result.total || result.lineItems.length > 0) {
        logger.info('CED parser extracted receipt', {
          total: result.total,
          items: result.lineItems.length,
          invoiceNumber: result.invoiceNumber,
          confidence: result.confidence
        });
        return result;
      }

      return null;
    } catch (error) {
      logger.error('CED parsing failed', { error: error.message });
      return null;
    }
  }

  /**
   * Parse HTML content
   */
  parseHtml(htmlContent, extracted) {
    // CED usually sends PDFs, so fall back to text parsing
    return this.parse(extracted.text, 'html');
  }

  /**
   * Extract line items from CED invoice
   * CED invoices typically have part numbers, descriptions, quantities, and prices
   */
  extractLineItems(text) {
    const items = [];
    const lines = text.split('\n');

    // CED item patterns - typically:
    // Part# | Description | Qty | Unit Price | Ext Price
    const patterns = [
      // Full pattern with part number
      /^\s*(\w{3,15})\s+(.{10,50}?)\s+(\d+)\s+\$?([\d,]+\.\d{2})\s+\$?([\d,]+\.\d{2})/,
      // Simpler pattern
      /^\s*(.{10,50}?)\s+(\d+)\s+@?\s*\$?([\d,]+\.\d{2})/
    ];

    for (const line of lines) {
      for (const pattern of patterns) {
        const match = line.match(pattern);
        if (match) {
          if (match.length === 6) {
            // Full pattern
            items.push({
              sku: match[1].trim(),
              description: match[2].trim(),
              quantity: parseInt(match[3], 10),
              unitPrice: parseCurrency(match[4]),
              totalPrice: parseCurrency(match[5])
            });
          } else if (match.length === 4) {
            // Simpler pattern
            items.push({
              description: match[1].trim(),
              quantity: parseInt(match[2], 10),
              unitPrice: parseCurrency(match[3]),
              totalPrice: parseCurrency(match[3]) * parseInt(match[2], 10)
            });
          }
          break; // Move to next line after match
        }
      }
    }

    // Also look for electrical-specific items
    const electricalPatterns = [
      /(\d+)\s*(?:ft|feet|')\s+(.+?wire.+?)\s+\$?([\d,]+\.\d{2})/i,
      /(\d+)\s+(?:box|boxes)\s+(.+?)\s+\$?([\d,]+\.\d{2})/i,
      /(\d+)\s+(.+?breaker.+?)\s+\$?([\d,]+\.\d{2})/i
    ];

    for (const line of lines) {
      for (const pattern of electricalPatterns) {
        const match = line.match(pattern);
        if (match) {
          items.push({
            description: `${match[1]} ${match[2].trim()}`,
            quantity: parseInt(match[1], 10),
            totalPrice: parseCurrency(match[3])
          });
          break;
        }
      }
    }

    return items.slice(0, 50);
  }
}

// Singleton instance
const cedParser = new CedParser();

module.exports = cedParser;


