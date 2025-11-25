/**
 * Generic Receipt Parser
 * Fallback parser when vendor-specific parser isn't available
 */

const { parseCurrency, parseDate, extractCardLast4, extractJobName } = require('../../utils/helpers');
const logger = require('../../utils/logger');

class GenericParser {
  /**
   * Parse text content (from PDF, plain text, or OCR)
   */
  parse(text, sourceType, vendor = null) {
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
        jobName: null,
        lineItems: [],
        confidence: 'low'
      };

      // Use vendor extractors if available
      const extractors = vendor?.extractors || this.getDefaultExtractors();

      // Extract total
      if (extractors.total) {
        const totalMatch = text.match(extractors.total);
        if (totalMatch) {
          result.total = parseCurrency(totalMatch[1]);
        }
      }

      // Fallback total extraction
      if (!result.total) {
        result.total = this.extractLargestAmount(text);
      }

      // Extract date
      if (extractors.date) {
        const dateMatch = text.match(extractors.date);
        if (dateMatch) {
          result.date = parseDate(dateMatch[1]);
        }
      }

      // Fallback date extraction
      if (!result.date) {
        result.date = this.extractMostRecentDate(text);
      }

      // Extract order number
      if (extractors.orderNumber) {
        const orderMatch = text.match(extractors.orderNumber);
        if (orderMatch) {
          result.orderNumber = orderMatch[1];
        }
      }

      // Extract invoice number
      if (extractors.invoiceNumber) {
        const invoiceMatch = text.match(extractors.invoiceNumber);
        if (invoiceMatch) {
          result.invoiceNumber = invoiceMatch[1];
        }
      }

      // Extract card info
      if (extractors.cardLast4) {
        const cardMatch = text.match(extractors.cardLast4);
        if (cardMatch) {
          result.cardLast4 = cardMatch[1];
        }
      }

      // Fallback card extraction
      if (!result.cardLast4) {
        result.cardLast4 = extractCardLast4(text);
      }

      // Detect payment method
      result.paymentMethod = this.detectPaymentMethod(text);

      // Extract job name
      result.jobName = extractJobName(text);

      // Extract line items (basic)
      result.lineItems = this.extractLineItems(text);

      // Calculate confidence
      result.confidence = this.calculateConfidence(result);

      if (result.total && result.date) {
        logger.info('Generic parser extracted receipt data', {
          total: result.total,
          date: result.date,
          confidence: result.confidence
        });
        return result;
      }

      return null;
    } catch (error) {
      logger.error('Generic parsing failed', { error: error.message });
      return null;
    }
  }

  /**
   * Parse HTML content
   */
  parseHtml(htmlContent, extracted, vendor = null) {
    const result = {
      total: null,
      subtotal: null,
      tax: null,
      date: null,
      orderNumber: null,
      invoiceNumber: null,
      cardLast4: null,
      paymentMethod: null,
      jobName: null,
      lineItems: [],
      confidence: 'low'
    };

    // Use extracted amounts
    if (extracted.amounts.labeled.total) {
      result.total = extracted.amounts.labeled.total;
    } else if (extracted.amounts.all.length > 0) {
      result.total = Math.max(...extracted.amounts.all);
    }

    if (extracted.amounts.labeled.subtotal) {
      result.subtotal = extracted.amounts.labeled.subtotal;
    }

    if (extracted.amounts.labeled.tax) {
      result.tax = extracted.amounts.labeled.tax;
    }

    // Use extracted dates
    if (extracted.dates.length > 0) {
      result.date = extracted.dates[0];
    }

    // Use extracted order info
    if (extracted.orderInfo.orderNumber) {
      result.orderNumber = extracted.orderInfo.orderNumber;
    }

    if (extracted.orderInfo.invoiceNumber) {
      result.invoiceNumber = extracted.orderInfo.invoiceNumber;
    }

    if (extracted.orderInfo.cardLast4) {
      result.cardLast4 = extracted.orderInfo.cardLast4;
    }

    // Try to extract line items from tables
    result.lineItems = this.extractLineItemsFromTables(extracted.tables);

    // Calculate confidence
    result.confidence = this.calculateConfidence(result);

    if (result.total && result.date) {
      return result;
    }

    return null;
  }

  /**
   * Get default extraction patterns
   */
  getDefaultExtractors() {
    return {
      total: /(?:order\s*)?(?:grand\s*)?total[:\s]*\$?([\d,]+\.?\d*)/i,
      date: /(?:date|ordered?)[:\s]*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i,
      orderNumber: /(?:order|confirmation)\s*(?:#|number)?[:\s]*([\w\-]+)/i,
      invoiceNumber: /invoice\s*(?:#|number)?[:\s]*([\w\-]+)/i,
      cardLast4: /(?:card|visa|mastercard|amex|discover)[^\d]*(\d{4})/i
    };
  }

  /**
   * Extract the largest dollar amount (likely the total)
   */
  extractLargestAmount(text) {
    const pattern = /\$?([\d,]+\.\d{2})\b/g;
    const amounts = [];

    let match;
    while ((match = pattern.exec(text)) !== null) {
      const amount = parseCurrency(match[1]);
      if (amount !== null && amount > 0) {
        amounts.push(amount);
      }
    }

    if (amounts.length === 0) return null;

    // Return the largest amount (usually the total)
    return Math.max(...amounts);
  }

  /**
   * Extract the most likely receipt date
   */
  extractMostRecentDate(text) {
    const patterns = [
      /(\d{1,2}\/\d{1,2}\/\d{2,4})/g,
      /(\d{1,2}-\d{1,2}-\d{2,4})/g,
      /(\w+\s+\d{1,2},?\s*\d{4})/g
    ];

    const dates = [];

    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(text)) !== null) {
        const parsed = parseDate(match[1]);
        if (parsed) {
          dates.push(parsed);
        }
      }
    }

    if (dates.length === 0) return null;

    // Sort and return most recent
    dates.sort((a, b) => new Date(b) - new Date(a));
    return dates[0];
  }

  /**
   * Detect payment method from text
   */
  detectPaymentMethod(text) {
    const methods = [
      { pattern: /visa/i, method: 'VISA' },
      { pattern: /mastercard|master\s*card/i, method: 'MasterCard' },
      { pattern: /amex|american\s*express/i, method: 'Amex' },
      { pattern: /discover/i, method: 'Discover' },
      { pattern: /debit/i, method: 'Debit' },
      { pattern: /cash/i, method: 'Cash' },
      { pattern: /check/i, method: 'Check' }
    ];

    for (const { pattern, method } of methods) {
      if (pattern.test(text)) {
        return method;
      }
    }

    return null;
  }

  /**
   * Extract line items from text (basic implementation)
   */
  extractLineItems(text) {
    const items = [];

    // Look for patterns like: "Item Name $12.34" or "123456 Item Name 2 $12.34"
    const patterns = [
      /^[\s]*(\d+)?\s*(.+?)\s+(\d+)\s+\$?([\d,]+\.\d{2})\s*$/gm,
      /^[\s]*(.+?)\s+\$?([\d,]+\.\d{2})\s*$/gm
    ];

    const lines = text.split('\n');

    for (const line of lines) {
      // Simple pattern: "Description $Amount"
      const simpleMatch = line.match(/^(.+?)\s+\$?([\d,]+\.\d{2})\s*$/);
      if (simpleMatch) {
        const description = simpleMatch[1].trim();
        const price = parseCurrency(simpleMatch[2]);

        // Skip if it looks like a total or summary line
        if (!/^(total|subtotal|tax|shipping|discount)/i.test(description)) {
          items.push({
            description,
            quantity: 1,
            totalPrice: price
          });
        }
      }
    }

    return items.slice(0, 50); // Limit to 50 items
  }

  /**
   * Extract line items from HTML tables
   */
  extractLineItemsFromTables(tables) {
    const items = [];

    for (const rows of tables) {
      // Skip tables with less than 2 rows (need header + data)
      if (rows.length < 2) continue;

      // Try to identify item rows
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (row.length < 2) continue;

        // Look for price in the row
        let price = null;
        let description = null;

        for (const cell of row) {
          const priceMatch = cell.match(/\$?([\d,]+\.\d{2})/);
          if (priceMatch) {
            price = parseCurrency(priceMatch[1]);
          } else if (cell.length > 3 && !price) {
            description = cell;
          }
        }

        if (description && price) {
          items.push({
            description,
            quantity: 1,
            totalPrice: price
          });
        }
      }
    }

    return items.slice(0, 50);
  }

  /**
   * Calculate confidence score for extracted data
   */
  calculateConfidence(result) {
    let score = 0;

    if (result.total) score += 2;
    if (result.date) score += 2;
    if (result.orderNumber || result.invoiceNumber) score += 1;
    if (result.cardLast4) score += 1;
    if (result.lineItems.length > 0) score += 1;

    if (score >= 5) return 'high';
    if (score >= 3) return 'medium';
    return 'low';
  }
}

// Singleton instance
const genericParser = new GenericParser();

module.exports = genericParser;


