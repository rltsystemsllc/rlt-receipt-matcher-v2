/**
 * Invoice Extractor for License Tool
 * Uses OCR to extract data from scanned invoices
 */

const Tesseract = require('tesseract.js');
const logger = require('../utils/logger');

/**
 * Extract data from invoice image using OCR
 */
async function extractFromInvoice(imageBuffer) {
  try {
    logger.info('Starting OCR extraction from invoice...');
    
    // Run OCR
    const result = await Tesseract.recognize(imageBuffer, 'eng', {
      logger: m => {
        if (m.status === 'recognizing text') {
          logger.info(`OCR Progress: ${Math.round(m.progress * 100)}%`);
        }
      }
    });

    const text = result.data.text;
    logger.info('OCR complete, extracting fields...');

    // Extract structured data from OCR text
    const extracted = parseInvoiceText(text);
    
    return {
      success: true,
      rawText: text,
      ...extracted
    };

  } catch (error) {
    logger.error('Invoice extraction failed', { error: error.message });
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Parse invoice text to extract structured data
 */
function parseInvoiceText(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const fullText = text.toLowerCase();
  
  const extracted = {
    projectName: null,
    location: null,
    contractAmount: null,
    startDate: null,
    endDate: null,
    squareFootage: null,
    scopeItems: [],
    confidence: {}
  };

  // === EXTRACT PROJECT NAME / CUSTOMER ===
  // Look for common patterns
  const namePatterns = [
    /(?:customer|client|bill\s*to|sold\s*to|project)[:\s]*([A-Z][A-Za-z\s\-\.]+)/i,
    /(?:job|project)\s*(?:name|#)?[:\s]*([A-Z][A-Za-z0-9\s\-\.]+)/i,
    /^([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){0,3})\s*(?:residence|home|house|renovation|remodel)/im
  ];
  
  for (const pattern of namePatterns) {
    const match = text.match(pattern);
    if (match && match[1] && match[1].length > 3) {
      extracted.projectName = cleanText(match[1]);
      extracted.confidence.projectName = 'medium';
      break;
    }
  }

  // === EXTRACT ADDRESS / LOCATION ===
  // Hawaii addresses often have specific patterns
  const addressPatterns = [
    /(\d+\s+[A-Za-z\s]+(?:St|Street|Rd|Road|Dr|Drive|Ave|Avenue|Ln|Lane|Way|Blvd|Hwy)[\.?]?\s*(?:,?\s*[A-Za-z]+)?)/i,
    /((?:Kihei|Wailea|Lahaina|Kahului|Paia|Makena|Haiku|Kula|Wailuku|Maui)[,\s]+(?:HI|Hawaii)?[\s\d]*)/i,
    /(?:address|location|site)[:\s]*([^\n]+)/i
  ];

  for (const pattern of addressPatterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      extracted.location = cleanText(match[1]);
      extracted.confidence.location = 'medium';
      break;
    }
  }

  // === EXTRACT AMOUNT ===
  // Look for total, amount due, invoice total
  const amountPatterns = [
    /(?:total|amount\s*due|invoice\s*total|grand\s*total|balance\s*due)[:\s]*\$?([\d,]+\.?\d*)/i,
    /\$\s*([\d,]+\.?\d{2})\s*$/m,  // Dollar amount at end of line
    /(?:total)[:\s]*\$?([\d,]+)/i
  ];

  for (const pattern of amountPatterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      const amount = parseFloat(match[1].replace(/,/g, ''));
      if (amount > 100 && amount < 10000000) { // Reasonable range
        extracted.contractAmount = amount;
        extracted.confidence.contractAmount = 'high';
        break;
      }
    }
  }

  // === EXTRACT DATE ===
  const datePatterns = [
    /(?:date|invoice\s*date|job\s*date)[:\s]*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i,
    /(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/,
    /([A-Z][a-z]+\s+\d{1,2},?\s*\d{4})/  // "January 15, 2024"
  ];

  for (const pattern of datePatterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      extracted.startDate = parseDate(match[1]);
      extracted.confidence.startDate = 'medium';
      break;
    }
  }

  // === EXTRACT SQUARE FOOTAGE ===
  const sqftMatch = text.match(/(\d{1,2},?\d{3})\s*(?:sf|sq\.?\s*ft|square\s*feet)/i);
  if (sqftMatch) {
    extracted.squareFootage = sqftMatch[1].replace(/,/g, '');
    extracted.confidence.squareFootage = 'high';
  }

  // === DETECT SCOPE ITEMS from line items ===
  const scopeKeywords = {
    'Underground Conduit / Groundwork': ['underground', 'conduit', 'trench', 'groundwork', 'excavat', 'backfill'],
    'Service / Panel Installation': ['panel', 'service', 'meter', 'main', 'breaker', 'load center', '200a', '100a', '400a'],
    'Rough-In Wiring': ['rough', 'rough-in', 'roughin', 'wire', 'wiring', 'romex', 'nm-b'],
    'Finish Trim': ['finish', 'trim', 'device', 'cover', 'plate'],
    'Pool / Spa Electrical': ['pool', 'spa', 'jacuzzi', 'aqualink', 'pump'],
    'A/C Wiring & Disconnects': ['a/c', 'ac ', 'hvac', 'air condition', 'disconnect', 'mini split', 'condenser'],
    'Audio/Video / Smart Home': ['audio', 'video', 'smart', 'lutron', 'speaker', 'media', 'av '],
    'LED Tape Lighting': ['led tape', 'tape light', 'strip light', 'under cabinet', 'soffit'],
    'Low Voltage / Data / Security': ['low voltage', 'data', 'cat5', 'cat6', 'security', 'camera', 'alarm'],
    'Fire Suppression': ['fire', 'suppression', 'sprinkler', 'smoke'],
    'EV Charging': ['ev ', 'charger', 'electric vehicle', 'tesla', 'nema 14'],
    'Generator / Transfer Switch': ['generator', 'transfer switch', 'backup', 'standby'],
    'Appliance Wiring': ['appliance', 'range', 'oven', 'dryer', 'water heater', 'disposal'],
    'Lighting Layout & Install': ['light', 'fixture', 'recessed', 'can light', 'chandelier', 'sconce', 'pendant'],
    'Receptacles & Switches': ['receptacle', 'outlet', 'switch', 'gfci', 'gfi', 'dimmer'],
    'Commercial / Tenant Improvements': ['commercial', 'tenant', 'office', 'retail', 'store']
  };

  for (const [scopeItem, keywords] of Object.entries(scopeKeywords)) {
    for (const keyword of keywords) {
      if (fullText.includes(keyword.toLowerCase())) {
        if (!extracted.scopeItems.includes(scopeItem)) {
          extracted.scopeItems.push(scopeItem);
        }
        break;
      }
    }
  }

  // === DETECT PROJECT TYPE ===
  if (fullText.includes('new build') || fullText.includes('new construction') || fullText.includes('new home')) {
    extracted.projectType = 'New Build - Residential';
  } else if (fullText.includes('commercial') || fullText.includes('office') || fullText.includes('retail')) {
    if (fullText.includes('renovation') || fullText.includes('remodel')) {
      extracted.projectType = 'Renovation - Commercial';
    } else {
      extracted.projectType = 'New Build - Commercial';
    }
  } else if (fullText.includes('renovation') || fullText.includes('remodel') || fullText.includes('upgrade')) {
    extracted.projectType = 'Renovation - Residential';
  } else if (fullText.includes('panel') && fullText.includes('upgrade')) {
    extracted.projectType = 'Panel Upgrade';
  } else if (fullText.includes('service call') || fullText.includes('repair')) {
    extracted.projectType = 'Service Call';
  }

  return extracted;
}

/**
 * Clean extracted text
 */
function cleanText(text) {
  if (!text) return null;
  return text
    .replace(/\s+/g, ' ')
    .replace(/[^\w\s\-\.,]/g, '')
    .trim();
}

/**
 * Parse date string to YYYY-MM format
 */
function parseDate(dateStr) {
  if (!dateStr) return null;
  
  try {
    // Try various formats
    let date;
    
    // MM/DD/YYYY or MM-DD-YYYY
    const slashMatch = dateStr.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
    if (slashMatch) {
      let year = slashMatch[3];
      if (year.length === 2) {
        year = year > '50' ? '19' + year : '20' + year;
      }
      date = new Date(year, parseInt(slashMatch[1]) - 1, slashMatch[2]);
    }
    
    // Month DD, YYYY
    const monthMatch = dateStr.match(/([A-Za-z]+)\s+(\d{1,2}),?\s*(\d{4})/);
    if (monthMatch) {
      date = new Date(dateStr);
    }

    if (date && !isNaN(date.getTime())) {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      return `${year}-${month}`;
    }
  } catch {
    // Ignore parse errors
  }
  
  return null;
}

module.exports = {
  extractFromInvoice,
  parseInvoiceText
};

