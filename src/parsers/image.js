/**
 * Image Parser (OCR)
 * Extracts text from images using Tesseract.js
 */

const Tesseract = require('tesseract.js');
const config = require('../config');
const logger = require('../utils/logger');

class ImageParser {
  constructor() {
    this.worker = null;
  }

  /**
   * Initialize Tesseract worker
   */
  async initWorker() {
    if (this.worker) {
      return this.worker;
    }

    if (!config.processing.enableOcr) {
      throw new Error('OCR is disabled in configuration');
    }

    try {
      this.worker = await Tesseract.createWorker('eng');
      logger.info('Tesseract OCR worker initialized');
      return this.worker;
    } catch (error) {
      logger.error('Failed to initialize Tesseract worker', { error: error.message });
      throw error;
    }
  }

  /**
   * Extract text from image buffer
   */
  async extractText(imageBuffer) {
    try {
      const worker = await this.initWorker();

      logger.info('Starting OCR extraction');

      const { data } = await worker.recognize(imageBuffer);

      logger.info('OCR extraction complete', {
        confidence: data.confidence,
        textLength: data.text.length
      });

      return data.text;
    } catch (error) {
      logger.error('OCR extraction failed', { error: error.message });
      throw error;
    }
  }

  /**
   * Extract text with detailed layout information
   */
  async extractWithLayout(imageBuffer) {
    try {
      const worker = await this.initWorker();

      const { data } = await worker.recognize(imageBuffer);

      return {
        text: data.text,
        confidence: data.confidence,
        words: data.words.map(word => ({
          text: word.text,
          confidence: word.confidence,
          bbox: word.bbox
        })),
        lines: data.lines.map(line => ({
          text: line.text,
          confidence: line.confidence,
          bbox: line.bbox
        }))
      };
    } catch (error) {
      logger.error('OCR layout extraction failed', { error: error.message });
      throw error;
    }
  }

  /**
   * Cleanup worker when shutting down
   */
  async terminate() {
    if (this.worker) {
      await this.worker.terminate();
      this.worker = null;
      logger.info('Tesseract worker terminated');
    }
  }
}

// Singleton instance
const imageParser = new ImageParser();

module.exports = imageParser;




