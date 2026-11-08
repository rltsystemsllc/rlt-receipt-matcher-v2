/**
 * Texts Bobby (and Jessica) a picture of each draft invoice.
 */

const { pdfToPng } = require('pdf-to-png-converter');
const logger = require('../utils/logger');

let ringcentral = null;
try {
  ringcentral = require('../bot2/ringcentral');
} catch (e) {
  logger.warn('Billing Agent: RingCentral not available', { error: e.message });
}

const MMS_LIMIT_BYTES = 1.2 * 1024 * 1024; // RingCentral caps MMS around 1.5 MB total

/**
 * First page of the PDF as a PNG small enough for MMS.
 */
async function pdfToMmsImage(pdfBuffer) {
  for (const scale of [2, 1.5, 1.1, 0.8]) {
    const pages = await pdfToPng(pdfBuffer, { viewportScale: scale, pagesToProcess: [1] });
    const img = pages[0]?.content;
    if (img && img.length <= MMS_LIMIT_BYTES) return img;
  }
  return null;
}

async function textInvoiceImage(message, pdfBuffer, docNumber) {
  if (!ringcentral) throw new Error('RingCentral not available');
  let image = null;
  try {
    image = await pdfToMmsImage(pdfBuffer);
  } catch (e) {
    logger.warn('Billing Agent: PDF render failed', { error: e.message });
  }
  if (!image) return ringcentral.sendGroupSMS(message + '\n\n(Invoice picture unavailable — open it in QBO)');
  return ringcentral.sendGroupMMS(message, image, `invoice-${docNumber}.png`);
}

async function text(message) {
  if (!ringcentral) throw new Error('RingCentral not available');
  return ringcentral.sendGroupSMS(message);
}

module.exports = { pdfToMmsImage, textInvoiceImage, text };
