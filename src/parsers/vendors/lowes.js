/**
 * Lowe's Receipt Parser
 * Specialized parsing for Lowe's receipts (usually HTML or image)
 */

const cheerio = require('cheerio');
const { parseCurrency, parseDate, extractCardLast4 } = require('../../utils/helpers');
const logger = require('../../utils/logger');

class LowesParser {
  /**
   * Parse Lowe's receipt text
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

      // Lowe's specific patterns
      // Total - multiple formats
      const totalPatterns = [
        /order\s*total[:\s]*\$?([\d,]+\.?\d*)/i,
        /total\s*(?:amount)?[:\s]*\$?([\d,]+\.?\d*)/i,
        /grand\s*total[:\s]*\$?([\d,]+\.?\d*)/i
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
      const taxMatch = text.match(/(?:estimated\s*)?(?:sales\s*)?tax[:\s]*\$?([\d,]+\.?\d*)/i);
      if (taxMatch) {
        result.tax = parseCurrency(taxMatch[1]);
      }

      // Date patterns
      const datePatterns = [
        /order\s*(?:date|placed)[:\s]*(\w+\s+\d{1,2},?\s*\d{4})/i,
        /(?:date|placed)[:\s]*(\d{1,2}\/\d{1,2}\/\d{2,4})/i,
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
      const orderMatch = text.match(/order\s*(?:#|number)?[:\s]*(\d{9,})/i);
      if (orderMatch) {
        result.orderNumber = orderMatch[1];
      }

      // Store Number
      const storeMatch = text.match(/store\s*(?:#|number)?[:\s]*(\d+)/i);
      if (storeMatch) {
        result.storeNumber = storeMatch[1];
      }

      // Payment - Lowe's often shows "ending in XXXX"
      const cardPatterns = [
        /(?:card\s*)?ending\s*in\s*(\d{4})/i,
        /(visa|mastercard|amex|discover)[^\d]*(\d{4})/i
      ];

      for (const pattern of cardPatterns) {
        const match = text.match(pattern);
        if (match) {
          if (match[2]) {
            result.paymentMethod = match[1].toUpperCase();
            result.cardLast4 = match[2];
          } else {
            result.cardLast4 = match[1];
          }
          break;
        }
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
        logger.info("Lowe's parser extracted receipt", {
          total: result.total,
          items: result.lineItems.length,
          confidence: result.confidence
        });
        return result;
      }

      return null;
    } catch (error) {
      logger.error("Lowe's parsing failed", { error: error.message });
      return null;
    }
  }

  /**
   * Parse HTML content (common for Lowe's)
   */
  parseHtml(htmlContent, extracted) {
    try {
      const $ = cheerio.load(htmlContent);
      const result = {
        total: null,
        subtotal: null,
        tax: null,
        date: null,
        orderNumber: null,
        cardLast4: null,
        lineItems: [],
        confidence: 'medium'
      };

      // Look for order summary tables
      $('table').each((i, table) => {
        const tableText = $(table).text();

        // Check for total
        if (/total/i.test(tableText)) {
          const totalMatch = tableText.match(/(?:order\s*)?total[:\s]*\$?([\d,]+\.?\d*)/i);
          if (totalMatch) {
            result.total = parseCurrency(totalMatch[1]);
          }
        }
      });

      // Fall back to extracted data
      if (!result.total && extracted.amounts.labeled.total) {
        result.total = extracted.amounts.labeled.total;
      }

      if (!result.date && extracted.dates.length > 0) {
        result.date = extracted.dates[0];
      }

      if (!result.orderNumber && extracted.orderInfo.orderNumber) {
        result.orderNumber = extracted.orderInfo.orderNumber;
      }

      if (!result.cardLast4 && extracted.orderInfo.cardLast4) {
        result.cardLast4 = extracted.orderInfo.cardLast4;
      }

      // Extract line items from tables
      result.lineItems = this.extractLineItemsFromHtml($, extracted.tables);

      if (result.total && result.date) {
        result.confidence = 'high';
        return result;
      }

      // Fall back to text parsing
      return this.parse(extracted.text, 'html');
    } catch (error) {
      logger.error("Lowe's HTML parsing failed", { error: error.message });
      return this.parse(extracted.text, 'html');
    }
  }

  /**
   * Extract line items from text
   */
  extractLineItems(text) {
    const items = [];
    const lines = text.split('\n');

    // Lowe's item pattern: Item# Description Qty Price
    const itemPattern = /^(?:item\s*#?\s*)?(\d+)?\s*(.{3,50}?)\s+(\d+)\s+\$?([\d,]+\.\d{2})/i;

    for (const line of lines) {
      const match = line.match(itemPattern);
      if (match) {
        const description = match[2].trim();

        // Skip summary lines
        if (/^(subtotal|total|tax|shipping|discount)/i.test(description)) {
          continue;
        }

        items.push({
          sku: match[1] || null,
          description,
          quantity: parseInt(match[3], 10),
          totalPrice: parseCurrency(match[4])
        });
      }
    }

    return items;
  }

  /**
   * Extract line items from HTML tables
   */
  extractLineItemsFromHtml($, tables) {
    const items = [];

    // Look for product tables
    $('table').each((i, table) => {
      const rows = $(table).find('tr');

      rows.each((j, row) => {
        const cells = $(row).find('td');
        if (cells.length >= 2) {
          let description = null;
          let price = null;
          let quantity = 1;

          cells.each((k, cell) => {
            const text = $(cell).text().trim();

            // Check for price
            const priceMatch = text.match(/\$?([\d,]+\.\d{2})/);
            if (priceMatch) {
              price = parseCurrency(priceMatch[1]);
            }
            // Check for quantity
            else if (/^(?:qty:?\s*)?(\d+)$/i.test(text)) {
              quantity = parseInt(text.replace(/\D/g, ''), 10);
            }
            // Otherwise might be description
            else if (text.length > 5 && text.length < 100) {
              description = text;
            }
          });

          if (description && price && !/^(subtotal|total|tax)/i.test(description)) {
            items.push({
              description,
              quantity,
              totalPrice: price
            });
          }
        }
      });
    });

    return items;
  }
}

// Singleton instance
const lowesParser = new LowesParser();

module.exports = lowesParser;




