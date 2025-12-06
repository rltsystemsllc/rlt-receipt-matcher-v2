/**
 * OpenAI Vision Receipt Parser
 * 
 * Uses GPT-4o-mini to extract structured data from receipt images:
 * - Vendor name
 * - Total amount (with tax)
 * - Date
 * - Job name (if printed on receipt)
 * - Line items (optional)
 */

const logger = require('../utils/logger');

// OpenAI client - will be initialized with API key
let openai = null;

/**
 * Initialize the OpenAI client
 */
function initialize() {
  if (openai) return;
  
  const OpenAI = require('openai');
  openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
  });
  
  logger.info('OpenAI client initialized');
}

/**
 * Parse a receipt image using GPT-4o-mini vision
 * 
 * @param {Buffer|string} imageData - Image buffer or base64 string
 * @returns {Object} Parsed receipt data
 */
async function parseReceipt(imageData) {
  initialize();
  
  try {
    // Convert to base64 if needed
    let base64Image;
    if (Buffer.isBuffer(imageData)) {
      base64Image = imageData.toString('base64');
    } else if (typeof imageData === 'string' && !imageData.startsWith('data:')) {
      base64Image = imageData;
    } else {
      base64Image = imageData.replace(/^data:image\/\w+;base64,/, '');
    }

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are a receipt parser for an electrical contracting business in Hawaii. 
Extract data from receipts/invoices and return JSON.

Look for job/project names in these common locations:
- "Job:", "Job Name:", "Project:", "PO#:", "Purchase Order:"
- "Customer:", "Ship To:", "Deliver To:" fields
- Handwritten notes on the receipt
- Account reference fields

Common job name patterns:
- Residence names (e.g., "Wailea Residence", "Smith Residence")
- Street addresses
- Commercial project names
- "Panel upgrade", "Service call", etc.

Return ONLY valid JSON, no markdown.`
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `Extract from this receipt:
1. vendor - Store/company name
2. amount - Total amount WITH TAX (not subtotal)
3. date - Transaction date (YYYY-MM-DD format)
4. jobName - Job/project name if found (null if not found)
5. items - Array of items purchased (brief descriptions)
6. confidence - Your confidence in the job name (high/medium/low/none)

Return JSON format:
{
  "vendor": "string",
  "amount": number,
  "date": "YYYY-MM-DD",
  "jobName": "string or null",
  "items": ["item1", "item2"],
  "confidence": "high|medium|low|none"
}`
            },
            {
              type: 'image_url',
              image_url: {
                url: `data:image/jpeg;base64,${base64Image}`,
                detail: 'high'
              }
            }
          ]
        }
      ],
      max_tokens: 500,
      temperature: 0.1 // Low temperature for consistent extraction
    });

    // Parse the response
    const content = response.choices[0].message.content;
    
    // Clean up response (remove markdown if present)
    let jsonStr = content.trim();
    if (jsonStr.startsWith('```json')) {
      jsonStr = jsonStr.slice(7);
    }
    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.slice(3);
    }
    if (jsonStr.endsWith('```')) {
      jsonStr = jsonStr.slice(0, -3);
    }
    jsonStr = jsonStr.trim();

    const parsed = JSON.parse(jsonStr);

    logger.info('Receipt parsed successfully', {
      vendor: parsed.vendor,
      amount: parsed.amount,
      jobName: parsed.jobName,
      confidence: parsed.confidence
    });

    return {
      vendor: parsed.vendor || 'Unknown',
      amount: parseFloat(parsed.amount) || 0,
      date: parsed.date || new Date().toISOString().split('T')[0],
      jobName: parsed.jobName || null,
      items: parsed.items || [],
      confidence: parsed.confidence || 'none',
      raw: parsed
    };

  } catch (error) {
    logger.error('Receipt parsing failed', { error: error.message });
    
    // Return empty result on failure
    return {
      vendor: 'Unknown',
      amount: 0,
      date: new Date().toISOString().split('T')[0],
      jobName: null,
      items: [],
      confidence: 'none',
      error: error.message
    };
  }
}

/**
 * Parse multiple receipts in batch
 */
async function parseMultiple(images) {
  const results = [];
  
  for (const image of images) {
    const result = await parseReceipt(image);
    results.push(result);
    
    // Small delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  
  return results;
}

/**
 * Suggest a job match based on items purchased
 */
async function suggestJobFromItems(items, recentJobs) {
  initialize();
  
  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'You help match electrical supply purchases to construction jobs.'
        },
        {
          role: 'user',
          content: `Items purchased: ${items.join(', ')}

Recent active jobs:
${recentJobs.map(j => `- ${j.name}: ${j.description || 'No description'}`).join('\n')}

Which job are these items most likely for? Return just the job name, or "UNKNOWN" if unclear.`
        }
      ],
      max_tokens: 50,
      temperature: 0.3
    });

    return response.choices[0].message.content.trim();

  } catch (error) {
    logger.error('Job suggestion failed', { error: error.message });
    return null;
  }
}

module.exports = {
  parseReceipt,
  parseMultiple,
  suggestJobFromItems
};

