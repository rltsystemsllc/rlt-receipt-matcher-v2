/**
 * Bot 2 AI Service
 * 
 * OpenAI-powered features for invoice drafting:
 * 1. Smart Invoice Descriptions - Generate professional descriptions from Bobby's notes
 * 2. Intelligent Job Matching - Fuzzy match job names with AI understanding
 */

const logger = require('../../utils/logger');

let openai = null;

/**
 * Initialize OpenAI client
 */
function initialize() {
  if (openai) return openai;
  
  if (!process.env.OPENAI_API_KEY) {
    logger.warn('OPENAI_API_KEY not set - AI features disabled');
    return null;
  }
  
  const OpenAI = require('openai');
  openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
  });
  
  logger.info('Bot 2 AI service initialized');
  return openai;
}

// ============================================
// PHASE 1: Smart Invoice Descriptions
// ============================================

/**
 * Generate professional invoice description from Bobby's raw notes
 * 
 * @param {Object} options
 * @param {string} options.rawNotes - Bobby's raw description from Daily Job Log
 * @param {string} options.phase - Work phase (Rough, Trim, Service, etc.)
 * @param {number} options.hours - Hours worked
 * @param {string[]} options.materials - Materials used (from sheet or receipts)
 * @param {boolean} options.isEmergency - Whether emergency rate applies
 * @returns {string} Professional invoice description
 */
async function generateInvoiceDescription(options) {
  const client = initialize();
  if (!client) {
    // Fallback: return cleaned up version of raw notes
    return formatFallbackDescription(options);
  }

  const { rawNotes, phase, hours, materials, isEmergency } = options;

  try {
    const response = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are writing professional invoice line items for RLT Systems, a licensed electrical contractor in Maui, Hawaii.

STYLE GUIDELINES:
- Be concise but specific (2-4 bullet points)
- Use proper electrical terminology
- Include quantities when known
- Reference relevant codes (NEC 2020) only when applicable
- Sound professional but not overly technical
- Never use filler words or fluff

OUTPUT FORMAT:
Return ONLY the description text, no JSON or markdown. Use bullet points (•).

EXAMPLE INPUT: "replaced bad breaker, ran new circuit for hot tub"
EXAMPLE OUTPUT:
• Diagnosed and replaced failed 20A breaker in main service panel
• Installed new dedicated 50A circuit for hot tub - GFCI protected per NEC 680.44
• All connections tested and verified operational`
        },
        {
          role: 'user',
          content: `Generate a professional invoice description:

Work Phase: ${phase || 'Service'}
Hours Worked: ${hours}
${isEmergency ? 'TYPE: Emergency/Same-Day Service' : ''}

Bobby's Notes:
"${rawNotes}"

${materials && materials.length > 0 ? `Materials Used:\n${materials.join('\n')}` : ''}

Write a professional description for this work.`
        }
      ],
      max_tokens: 300,
      temperature: 0.3 // Low for consistency
    });

    const description = response.choices[0].message.content.trim();
    
    logger.info('Generated invoice description', { 
      inputLength: rawNotes.length,
      outputLength: description.length 
    });

    return description;

  } catch (error) {
    logger.error('Failed to generate description', { error: error.message });
    return formatFallbackDescription(options);
  }
}

/**
 * Fallback description when AI is unavailable
 */
function formatFallbackDescription(options) {
  const { rawNotes, phase, isEmergency } = options;
  
  let desc = '';
  
  if (isEmergency) {
    desc += '⚡ EMERGENCY SERVICE\n\n';
  }
  
  if (phase) {
    desc += `Phase: ${phase}\n\n`;
  }
  
  // Clean up raw notes
  const cleaned = rawNotes
    .split(/[,;]/)
    .map(item => item.trim())
    .filter(item => item.length > 0)
    .map(item => `• ${item.charAt(0).toUpperCase() + item.slice(1)}`)
    .join('\n');
  
  desc += cleaned || rawNotes;
  
  return desc;
}

/**
 * Generate a summary line for labor on invoice
 * Used for the main labor line item description
 */
async function generateLaborSummary(dateDetails) {
  const client = initialize();
  if (!client) {
    // Fallback
    return dateDetails.map(d => d.description).join('; ');
  }

  try {
    const workDone = dateDetails
      .map(d => `${d.date}: ${d.hours} hrs - ${d.description}`)
      .join('\n');

    const response = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `Summarize electrical work into a brief 1-2 sentence professional summary for an invoice.
Be concise. No bullet points. Just a clean summary paragraph.`
        },
        {
          role: 'user',
          content: `Work performed:\n${workDone}\n\nWrite a brief summary.`
        }
      ],
      max_tokens: 100,
      temperature: 0.3
    });

    return response.choices[0].message.content.trim();

  } catch (error) {
    logger.error('Failed to generate labor summary', { error: error.message });
    return dateDetails.map(d => d.description).join('; ');
  }
}

// ============================================
// PHASE 3: Intelligent Job Matching
// ============================================

/**
 * Find the best matching job/customer from a list using AI
 * 
 * @param {string} searchTerm - The job name to match (from receipt, SMS, etc.)
 * @param {Object[]} candidates - List of possible matches from QBO/Sheets
 * @param {Object} context - Additional context (vendor, items, date, etc.)
 * @returns {Object} Best match with confidence score
 */
async function findBestJobMatch(searchTerm, candidates, context = {}) {
  // If we have an exact match, return it immediately
  const exactMatch = candidates.find(c => 
    c.name.toLowerCase() === searchTerm.toLowerCase()
  );
  if (exactMatch) {
    return {
      match: exactMatch,
      confidence: 100,
      method: 'exact'
    };
  }

  // Try simple fuzzy matching first (no AI needed for obvious matches)
  const simpleMatch = findSimpleFuzzyMatch(searchTerm, candidates);
  if (simpleMatch && simpleMatch.confidence >= 85) {
    return simpleMatch;
  }

  // Use AI for complex matching
  const client = initialize();
  if (!client) {
    // Return best simple match if available
    return simpleMatch || { match: null, confidence: 0, method: 'none' };
  }

  try {
    const candidateList = candidates
      .slice(0, 20) // Limit to top 20 for token efficiency
      .map((c, i) => `${i + 1}. ${c.name}${c.description ? ` (${c.description})` : ''}`)
      .join('\n');

    const response = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are matching job/project names for an electrical contractor.

Common patterns:
- "Johnson" might match "Mike Johnson - Kihei Residence"
- "Wailea project" might match "Wailea Fairway Homes - Unit 3"
- Contractor names often appear with project locations
- Misspellings are common (Jonson = Johnson)

Return JSON: {"matchIndex": number or null, "confidence": 0-100, "reason": "brief explanation"}
If no good match, return {"matchIndex": null, "confidence": 0, "reason": "no match found"}`
        },
        {
          role: 'user',
          content: `Find the best match for: "${searchTerm}"

${context.vendor ? `Vendor: ${context.vendor}` : ''}
${context.items ? `Items purchased: ${context.items.join(', ')}` : ''}
${context.date ? `Date: ${context.date}` : ''}

Available jobs:
${candidateList}

Return JSON with the best match (1-indexed) or null if no good match.`
        }
      ],
      max_tokens: 100,
      temperature: 0.1,
      response_format: { type: 'json_object' }
    });

    const result = JSON.parse(response.choices[0].message.content);
    
    if (result.matchIndex && result.matchIndex > 0 && result.matchIndex <= candidates.length) {
      const matched = candidates[result.matchIndex - 1];
      
      logger.info('AI job match found', {
        searchTerm,
        matchedTo: matched.name,
        confidence: result.confidence,
        reason: result.reason
      });

      return {
        match: matched,
        confidence: result.confidence,
        reason: result.reason,
        method: 'ai'
      };
    }

    return {
      match: simpleMatch?.match || null,
      confidence: simpleMatch?.confidence || 0,
      method: 'fuzzy'
    };

  } catch (error) {
    logger.error('AI job matching failed', { error: error.message });
    return simpleMatch || { match: null, confidence: 0, method: 'error' };
  }
}

/**
 * Simple fuzzy matching without AI
 */
function findSimpleFuzzyMatch(searchTerm, candidates) {
  const search = searchTerm.toLowerCase().trim();
  const searchWords = search.split(/\s+/);
  
  let bestMatch = null;
  let bestScore = 0;

  for (const candidate of candidates) {
    const name = candidate.name.toLowerCase();
    
    // Check if search term is contained in candidate
    if (name.includes(search)) {
      const score = 90;
      if (score > bestScore) {
        bestScore = score;
        bestMatch = candidate;
      }
      continue;
    }

    // Check if candidate contains search term
    if (search.includes(name)) {
      const score = 85;
      if (score > bestScore) {
        bestScore = score;
        bestMatch = candidate;
      }
      continue;
    }

    // Word overlap scoring
    const candidateWords = name.split(/[\s\-_]+/);
    const matchingWords = searchWords.filter(sw => 
      candidateWords.some(cw => 
        cw.includes(sw) || sw.includes(cw) ||
        levenshteinDistance(sw, cw) <= 2
      )
    );

    if (matchingWords.length > 0) {
      const score = (matchingWords.length / Math.max(searchWords.length, candidateWords.length)) * 80;
      if (score > bestScore) {
        bestScore = score;
        bestMatch = candidate;
      }
    }
  }

  if (bestMatch && bestScore >= 50) {
    return {
      match: bestMatch,
      confidence: Math.round(bestScore),
      method: 'fuzzy'
    };
  }

  return null;
}

/**
 * Calculate Levenshtein distance between two strings
 */
function levenshteinDistance(str1, str2) {
  const m = str1.length;
  const n = str2.length;
  const dp = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (str1[i - 1] === str2[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
  }

  return dp[m][n];
}

/**
 * Suggest which job a receipt might belong to based on items and context
 */
async function suggestJobFromContext(receipt, recentJobs) {
  const client = initialize();
  if (!client) return null;

  try {
    const jobList = recentJobs
      .slice(0, 15)
      .map(j => `- ${j.name}`)
      .join('\n');

    const response = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You match electrical supply purchases to construction jobs.
Consider: item types (panel parts, wire, fixtures), vendor specialty, quantities.
Return JSON: {"jobName": "exact name from list or null", "confidence": 0-100, "reason": "brief"}`
        },
        {
          role: 'user',
          content: `Receipt:
Vendor: ${receipt.vendor}
Amount: $${receipt.amount}
Items: ${receipt.items?.join(', ') || 'Unknown'}
Date: ${receipt.date}

Active Jobs:
${jobList}

Which job is this receipt most likely for?`
        }
      ],
      max_tokens: 100,
      temperature: 0.2,
      response_format: { type: 'json_object' }
    });

    const result = JSON.parse(response.choices[0].message.content);
    
    if (result.jobName && result.confidence >= 70) {
      logger.info('AI suggested job from context', {
        vendor: receipt.vendor,
        suggestedJob: result.jobName,
        confidence: result.confidence
      });
      return result;
    }

    return null;

  } catch (error) {
    logger.error('Job suggestion failed', { error: error.message });
    return null;
  }
}

// ============================================
// UTILITIES
// ============================================

/**
 * Check if AI service is available
 */
function isAvailable() {
  return !!process.env.OPENAI_API_KEY;
}

/**
 * Get service status
 */
function getStatus() {
  return {
    available: isAvailable(),
    initialized: openai !== null
  };
}

module.exports = {
  initialize,
  isAvailable,
  getStatus,
  
  // Phase 1: Smart Descriptions
  generateInvoiceDescription,
  generateLaborSummary,
  
  // Phase 3: Job Matching
  findBestJobMatch,
  suggestJobFromContext
};

