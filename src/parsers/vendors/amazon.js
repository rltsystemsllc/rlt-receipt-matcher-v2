/**
 * Amazon Receipt Parser
 * Specialized parsing for Amazon order confirmations and receipts
 */

const cheerio = require('cheerio');
const { parseCurrency, parseDate } = require('../../utils/helpers');
const logger = require('../../utils/logger');

class AmazonParser {
  /**
   * Parse Amazon receipt text
   */
  parse(text, sourceType) {
    try {
      const result = {
        total: null,
        subtotal: null,
        tax: null,
        shipping: null,
        date: null,
        orderNumber: null,
        cardLast4: null,
        paymentMethod: null,
        lineItems: [],
        confidence: 'medium'
      };

      // Amazon order total patterns
      const totalPatterns = [
        /order\s*total[:\s]*\$?([\d,]+\.?\d*)/i,
        /grand\s*total[:\s]*\$?([\d,]+\.?\d*)/i,
        /total\s*for\s*this\s*order[:\s]*\$?([\d,]+\.?\d*)/i
      ];

      for (const pattern of totalPatterns) {
        const match = text.match(pattern);
        if (match) {
          result.total = parseCurrency(match[1]);
          if (result.total) break;
        }
      }

      // Subtotal
      const subtotalMatch = text.match(/(?:item[s]?\s*)?subtotal[:\s]*\$?([\d,]+\.?\d*)/i);
      if (subtotalMatch) {
        result.subtotal = parseCurrency(subtotalMatch[1]);
      }

      // Tax
      const taxMatch = text.match(/(?:estimated\s*)?tax[:\s]*\$?([\d,]+\.?\d*)/i);
      if (taxMatch) {
        result.tax = parseCurrency(taxMatch[1]);
      }

      // Shipping
      const shippingMatch = text.match(/shipping(?:\s*&\s*handling)?[:\s]*\$?([\d,]+\.?\d*)/i);
      if (shippingMatch) {
        result.shipping = parseCurrency(shippingMatch[1]);
      }

      // Amazon date formats
      const datePatterns = [
        /order\s*placed[:\s]*(\w+\s+\d{1,2},?\s*\d{4})/i,
        /ordered?\s*on[:\s]*(\w+\s+\d{1,2},?\s*\d{4})/i,
        /(\w+\s+\d{1,2},?\s*\d{4})/
      ];

      for (const pattern of datePatterns) {
        const match = text.match(pattern);
        if (match) {
          result.date = parseDate(match[1]);
          if (result.date) break;
        }
      }

      // Amazon order number (format: XXX-XXXXXXX-XXXXXXX)
      const orderMatch = text.match(/order\s*(?:#|number)?[:\s]*([\d\-]{15,})/i);
      if (orderMatch) {
        result.orderNumber = orderMatch[1];
      }

      // Payment - Amazon shows "ending in XXXX"
      const cardMatch = text.match(/(?:card\s*)?ending\s*in\s*(\d{4})/i);
      if (cardMatch) {
        result.cardLast4 = cardMatch[1];
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
        logger.info('Amazon parser extracted receipt', {
          total: result.total,
          items: result.lineItems.length,
          confidence: result.confidence
        });
        return result;
      }

      return null;
    } catch (error) {
      logger.error('Amazon parsing failed', { error: error.message });
      return null;
    }
  }

  /**
   * Parse HTML content (very common for Amazon)
   */
  parseHtml(htmlContent, extracted) {
    try {
      const $ = cheerio.load(htmlContent);
      const result = {
        total: null,
        subtotal: null,
        tax: null,
        shipping: null,
        date: null,
        orderNumber: null,
        cardLast4: null,
        lineItems: [],
        confidence: 'medium'
      };

      // Amazon emails often have structured tables
      // Look for order summary
      $('table').each((i, table) => {
        const tableText = $(table).text();

        // Order total
        if (/order\s*total/i.test(tableText)) {
          const totalMatch = tableText.match(/order\s*total[:\s]*\$?([\d,]+\.?\d*)/i);
          if (totalMatch) {
            result.total = parseCurrency(totalMatch[1]);
          }
        }

        // Order number
        if (/order\s*#/i.test(tableText)) {
          const orderMatch = tableText.match(/order\s*#?\s*([\d\-]{15,})/i);
          if (orderMatch) {
            result.orderNumber = orderMatch[1];
          }
        }
      });

      // Look for items in the email
      result.lineItems = this.extractLineItemsFromHtml($);

      // Fall back to extracted data
      if (!result.total && extracted.amounts.labeled.total) {
        result.total = extracted.amounts.labeled.total;
      }

      if (!result.date && extracted.dates.length > 0) {
        result.date = extracted.dates[0];
      }

      if (!result.cardLast4 && extracted.orderInfo.cardLast4) {
        result.cardLast4 = extracted.orderInfo.cardLast4;
      }

      if (result.total && result.date) {
        result.confidence = 'high';
        return result;
      }

      // Fall back to text parsing
      return this.parse(extracted.text, 'html');
    } catch (error) {
      logger.error('Amazon HTML parsing failed', { error: error.message });
      return this.parse(extracted.text, 'html');
    }
  }

  /**
   * Extract line items from text
   */
  extractLineItems(text) {
    const items = [];
    const lines = text.split('\n');

    // Amazon item pattern variations
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      // Skip empty lines
      if (!line) continue;

      // Look for price on same or next line
      const priceMatch = line.match(/\$?([\d,]+\.\d{2})/);

      if (priceMatch) {
        const price = parseCurrency(priceMatch[1]);

        // Get description (might be on previous line)
        let description = line.replace(/\$?[\d,]+\.\d{2}/, '').trim();

        if (description.length < 5 && i > 0) {
          description = lines[i - 1].trim();
        }

        // Skip summary lines
        if (!/^(subtotal|total|tax|shipping|discount|order)/i.test(description)) {
          if (description.length > 5) {
            items.push({
              description: description.substring(0, 100),
              quantity: 1,
              totalPrice: price
            });
          }
        }
      }
    }

    return items.slice(0, 20); // Limit items
  }

  /**
   * Extract line items from HTML
   */
  extractLineItemsFromHtml($) {
    const items = [];

    // Amazon often uses tables for items
    $('table tr').each((i, row) => {
      const cells = $(row).find('td');

      if (cells.length >= 2) {
        let description = null;
        let price = null;

        cells.each((j, cell) => {
          const text = $(cell).text().trim();
          const priceMatch = text.match(/\$?([\d,]+\.\d{2})/);

          if (priceMatch) {
            price = parseCurrency(priceMatch[1]);
          } else if (text.length > 10 && text.length < 200) {
            description = text;
          }
        });

        // Also check for images with alt text (product names)
        if (!description) {
          const img = $(row).find('img[alt]').first();
          if (img.length) {
            description = img.attr('alt');
          }
        }

        if (description && price) {
          items.push({
            description: description.substring(0, 100),
            quantity: 1,
            totalPrice: price
          });
        }
      }
    });

    return items.slice(0, 20);
  }
}

// Singleton instance
const amazonParser = new AmazonParser();

module.exports = amazonParser;


