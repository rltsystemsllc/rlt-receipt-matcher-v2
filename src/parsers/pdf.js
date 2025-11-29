/**
 * PDF Parser
 * Extracts text content from PDF files
 */

const pdfParse = require('pdf-parse');
const logger = require('../utils/logger');

class PdfParser {
  /**
   * Extract text from a PDF buffer
   */
  async extractText(pdfBuffer) {
    try {
      const options = {
        // Limit to reasonable page count for receipts
        max: 10
      };

      const data = await pdfParse(pdfBuffer, options);

      logger.info('PDF text extracted', {
        pages: data.numpages,
        textLength: data.text.length
      });

      return data.text;
    } catch (error) {
      logger.error('PDF text extraction failed', { error: error.message });
      throw error;
    }
  }

  /**
   * Extract text with page separation
   */
  async extractTextByPage(pdfBuffer) {
    try {
      const pages = [];

      const options = {
        max: 10,
        pagerender: async function(pageData) {
          const textContent = await pageData.getTextContent();
          const text = textContent.items.map(item => item.str).join(' ');
          pages.push(text);
          return text;
        }
      };

      await pdfParse(pdfBuffer, options);

      return pages;
    } catch (error) {
      logger.error('PDF page extraction failed', { error: error.message });
      throw error;
    }
  }
}

// Singleton instance
const pdfParser = new PdfParser();

module.exports = pdfParser;




