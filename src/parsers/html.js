/**
 * HTML Parser
 * Extracts structured data from HTML email content
 */

const cheerio = require('cheerio');
const logger = require('../utils/logger');
const { parseCurrency, parseDate } = require('../utils/helpers');

class HtmlParser {
  /**
   * Extract structured data from HTML
   */
  extract(htmlContent) {
    const $ = cheerio.load(htmlContent);

    // Get plain text for pattern matching
    const text = $('body').text().replace(/\s+/g, ' ').trim();

    // Try to find common receipt elements
    const data = {
      text,
      tables: this.extractTables($),
      amounts: this.extractAmounts($, text),
      dates: this.extractDates(text),
      orderInfo: this.extractOrderInfo(text)
    };

    return data;
  }

  /**
   * Extract table data (often contains line items)
   */
  extractTables($) {
    const tables = [];

    $('table').each((i, table) => {
      const rows = [];
      $(table).find('tr').each((j, tr) => {
        const cells = [];
        $(tr).find('td, th').each((k, cell) => {
          cells.push($(cell).text().trim());
        });
        if (cells.length > 0) {
          rows.push(cells);
        }
      });
      if (rows.length > 0) {
        tables.push(rows);
      }
    });

    return tables;
  }

  /**
   * Extract dollar amounts from text
   */
  extractAmounts($, text) {
    const amounts = [];

    // Pattern for dollar amounts
    const pattern = /\$[\d,]+\.?\d*/g;
    const matches = text.match(pattern) || [];

    for (const match of matches) {
      const value = parseCurrency(match);
      if (value !== null) {
        amounts.push(value);
      }
    }

    // Also look for labeled amounts
    const labeledAmounts = {};

    // Total
    const totalMatch = text.match(/(?:order\s*)?total[:\s]*\$?([\d,]+\.?\d*)/i);
    if (totalMatch) {
      labeledAmounts.total = parseCurrency(totalMatch[1]);
    }

    // Subtotal
    const subtotalMatch = text.match(/sub\s*total[:\s]*\$?([\d,]+\.?\d*)/i);
    if (subtotalMatch) {
      labeledAmounts.subtotal = parseCurrency(subtotalMatch[1]);
    }

    // Tax
    const taxMatch = text.match(/(?:sales\s*)?tax[:\s]*\$?([\d,]+\.?\d*)/i);
    if (taxMatch) {
      labeledAmounts.tax = parseCurrency(taxMatch[1]);
    }

    // Shipping
    const shippingMatch = text.match(/shipping[:\s]*\$?([\d,]+\.?\d*)/i);
    if (shippingMatch) {
      labeledAmounts.shipping = parseCurrency(shippingMatch[1]);
    }

    return {
      all: amounts,
      labeled: labeledAmounts
    };
  }

  /**
   * Extract dates from text
   */
  extractDates(text) {
    const dates = [];

    // Common date patterns
    const patterns = [
      /(\d{1,2}\/\d{1,2}\/\d{2,4})/g,
      /(\d{1,2}-\d{1,2}-\d{2,4})/g,
      /(\w+\s+\d{1,2},?\s*\d{4})/g
    ];

    for (const pattern of patterns) {
      const matches = text.match(pattern) || [];
      for (const match of matches) {
        const parsed = parseDate(match);
        if (parsed && !dates.includes(parsed)) {
          dates.push(parsed);
        }
      }
    }

    return dates;
  }

  /**
   * Extract order/invoice information
   */
  extractOrderInfo(text) {
    const info = {};

    // Order number
    const orderMatch = text.match(/order\s*(?:#|number)?[:\s]*([\w\-]+)/i);
    if (orderMatch) {
      info.orderNumber = orderMatch[1];
    }

    // Invoice number
    const invoiceMatch = text.match(/invoice\s*(?:#|number)?[:\s]*([\w\-]+)/i);
    if (invoiceMatch) {
      info.invoiceNumber = invoiceMatch[1];
    }

    // Card info
    const cardMatch = text.match(/(?:visa|mastercard|amex|discover|card)[^\d]*(\d{4})/i);
    if (cardMatch) {
      info.cardLast4 = cardMatch[1];
    }

    return info;
  }

  /**
   * Convert HTML to clean text
   */
  toText(htmlContent) {
    const $ = cheerio.load(htmlContent);

    // Remove script and style elements
    $('script, style').remove();

    // Get text and normalize whitespace
    return $('body').text()
      .replace(/\s+/g, ' ')
      .trim();
  }
}

// Singleton instance
const htmlParser = new HtmlParser();

module.exports = htmlParser;




