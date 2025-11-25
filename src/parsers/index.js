/**
 * Parser Router
 * Routes parsing requests to appropriate parsers based on content type and vendor
 */

const pdfParser = require('./pdf');
const htmlParser = require('./html');
const imageParser = require('./image');
const vendorParsers = require('./vendors');
const logger = require('../utils/logger');

class ParserRouter {
  /**
   * Parse PDF content
   */
  async parsePdf(pdfBuffer, vendor) {
    try {
      // Extract text from PDF
      const text = await pdfParser.extractText(pdfBuffer);

      if (!text || text.trim().length === 0) {
        logger.warn('PDF extraction returned empty text');
        return null;
      }

      // Try vendor-specific parser first
      if (vendor && vendorParsers[vendor.vendorId]) {
        const result = vendorParsers[vendor.vendorId].parse(text, 'pdf');
        if (result) {
          return result;
        }
      }

      // Fall back to generic parsing
      return vendorParsers.generic.parse(text, 'pdf', vendor);
    } catch (error) {
      logger.error('PDF parsing failed', { error: error.message });
      return null;
    }
  }

  /**
   * Parse HTML content
   */
  async parseHtml(htmlContent, vendor) {
    try {
      // Extract structured data from HTML
      const extracted = htmlParser.extract(htmlContent);

      // Try vendor-specific parser first
      if (vendor && vendorParsers[vendor.vendorId]) {
        const result = vendorParsers[vendor.vendorId].parseHtml(htmlContent, extracted);
        if (result) {
          return result;
        }
      }

      // Fall back to generic parsing
      return vendorParsers.generic.parseHtml(htmlContent, extracted, vendor);
    } catch (error) {
      logger.error('HTML parsing failed', { error: error.message });
      return null;
    }
  }

  /**
   * Parse plain text content
   */
  async parseText(textContent, vendor) {
    try {
      // Try vendor-specific parser first
      if (vendor && vendorParsers[vendor.vendorId]) {
        const result = vendorParsers[vendor.vendorId].parse(textContent, 'text');
        if (result) {
          return result;
        }
      }

      // Fall back to generic parsing
      return vendorParsers.generic.parse(textContent, 'text', vendor);
    } catch (error) {
      logger.error('Text parsing failed', { error: error.message });
      return null;
    }
  }

  /**
   * Parse image content with OCR
   */
  async parseImage(imageBuffer, vendor) {
    try {
      // Extract text using OCR
      const text = await imageParser.extractText(imageBuffer);

      if (!text || text.trim().length === 0) {
        logger.warn('Image OCR returned empty text');
        return null;
      }

      // Try vendor-specific parser first
      if (vendor && vendorParsers[vendor.vendorId]) {
        const result = vendorParsers[vendor.vendorId].parse(text, 'image');
        if (result) {
          return result;
        }
      }

      // Fall back to generic parsing
      return vendorParsers.generic.parse(text, 'image', vendor);
    } catch (error) {
      logger.error('Image parsing failed', { error: error.message });
      return null;
    }
  }
}

// Singleton instance
const parserRouter = new ParserRouter();

module.exports = parserRouter;


