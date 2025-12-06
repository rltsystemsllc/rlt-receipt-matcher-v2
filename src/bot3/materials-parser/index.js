/**
 * Bot 3 - Materials Parser
 * Parses free-form material descriptions into structured data
 * 
 * Input: "1 roll 12/2, 4 boxes, 2 dimmers, 6 receptacles"
 * Output: [
 *   { name: "12/2 Romex", quantity: 1, unit: "roll" },
 *   { name: "single gang box", quantity: 4 },
 *   { name: "dimmer", quantity: 2 },
 *   { name: "receptacle", quantity: 6 }
 * ]
 */

const logger = require('../../utils/logger');

/**
 * Common electrical material aliases and corrections
 */
const MATERIAL_ALIASES = {
  // Wire
  '12/2': '12/2 Romex',
  '12-2': '12/2 Romex',
  '12 2': '12/2 Romex',
  '14/2': '14/2 Romex',
  '14-2': '14/2 Romex',
  '14 2': '14/2 Romex',
  '10/2': '10/2 Romex',
  '10-2': '10/2 Romex',
  '10/3': '10/3 Romex',
  '10-3': '10/3 Romex',
  '12/3': '12/3 Romex',
  '12-3': '12/3 Romex',
  '6/3': '6/3 Romex',
  '6-3': '6/3 Romex',
  'romex': 'Romex',
  'nm': 'NM-B wire',
  'thhn': 'THHN wire',
  'mc cable': 'MC cable',
  'mc': 'MC cable',
  'uf': 'UF cable',
  'uf-b': 'UF-B cable',
  
  // Boxes
  'box': 'junction box',
  'boxes': 'junction box',
  'single gang': 'single gang box',
  'single-gang': 'single gang box',
  '1 gang': 'single gang box',
  '1-gang': 'single gang box',
  'double gang': 'double gang box',
  'double-gang': 'double gang box',
  '2 gang': 'double gang box',
  '2-gang': 'double gang box',
  'triple gang': 'triple gang box',
  '3 gang': 'triple gang box',
  '3-gang': 'triple gang box',
  '4 gang': '4-gang box',
  '4-gang': '4-gang box',
  'outlet box': 'outlet box',
  'switch box': 'switch box',
  'octagon': 'octagon box',
  'oct box': 'octagon box',
  'pancake': 'pancake box',
  'ceiling box': 'ceiling box',
  'weatherproof box': 'weatherproof box',
  'wp box': 'weatherproof box',
  
  // Devices
  'receptacle': 'receptacle',
  'receptacles': 'receptacle',
  'outlet': 'receptacle',
  'outlets': 'receptacle',
  'plug': 'receptacle',
  'plugs': 'receptacle',
  'recep': 'receptacle',
  'receps': 'receptacle',
  'gfci': 'GFCI receptacle',
  'gfi': 'GFCI receptacle',
  'afci': 'AFCI receptacle',
  'usb outlet': 'USB receptacle',
  'usb receptacle': 'USB receptacle',
  'switch': 'switch',
  'switches': 'switch',
  'sw': 'switch',
  'dimmer': 'dimmer switch',
  'dimmers': 'dimmer switch',
  '3 way': '3-way switch',
  '3-way': '3-way switch',
  '3way': '3-way switch',
  'three way': '3-way switch',
  '4 way': '4-way switch',
  '4-way': '4-way switch',
  'decora': 'Decora switch',
  
  // Covers and plates
  'cover': 'cover plate',
  'covers': 'cover plate',
  'plate': 'cover plate',
  'plates': 'cover plate',
  'blank': 'blank cover',
  'blanks': 'blank cover',
  'wp cover': 'weatherproof cover',
  
  // Conduit and fittings
  'emt': 'EMT conduit',
  'pvc': 'PVC conduit',
  'rigid': 'rigid conduit',
  'flex': 'flex conduit',
  'coupling': 'coupling',
  'couplings': 'coupling',
  'connector': 'connector',
  'connectors': 'connector',
  'lb': 'LB fitting',
  'straps': 'conduit strap',
  'strap': 'conduit strap',
  
  // Breakers
  'breaker': 'circuit breaker',
  'breakers': 'circuit breaker',
  '15a breaker': '15A circuit breaker',
  '15 amp breaker': '15A circuit breaker',
  '20a breaker': '20A circuit breaker',
  '20 amp breaker': '20A circuit breaker',
  '30a breaker': '30A circuit breaker',
  '40a breaker': '40A circuit breaker',
  '50a breaker': '50A circuit breaker',
  'gfci breaker': 'GFCI circuit breaker',
  'afci breaker': 'AFCI circuit breaker',
  
  // Misc
  'wire nut': 'wire nut',
  'wire nuts': 'wire nut',
  'wirenuts': 'wire nut',
  'wirenut': 'wire nut',
  'staple': 'cable staple',
  'staples': 'cable staple',
  'tape': 'electrical tape',
  'e tape': 'electrical tape',
  'ground rod': 'ground rod',
  'ground clamp': 'ground clamp',
  'fixture': 'light fixture',
  'fixtures': 'light fixture',
  'fan': 'ceiling fan',
  'fans': 'ceiling fan',
  'led': 'LED light',
  'leds': 'LED light'
};

/**
 * Common units
 */
const UNITS = [
  'roll', 'rolls',
  'box', 'boxes',
  'pack', 'packs',
  'bag', 'bags',
  'ft', 'feet', 'foot',
  'piece', 'pieces', 'pc', 'pcs',
  'pair', 'pairs',
  'set', 'sets',
  'bundle', 'bundles',
  'spool', 'spools',
  'length', 'lengths',
  'stick', 'sticks'
];

/**
 * Normalize a unit to singular form
 */
function normalizeUnit(unit) {
  if (!unit) return null;
  
  const unitMap = {
    'rolls': 'roll',
    'boxes': 'box',
    'packs': 'pack',
    'bags': 'bag',
    'feet': 'ft',
    'foot': 'ft',
    'pieces': 'piece',
    'pcs': 'piece',
    'pc': 'piece',
    'pairs': 'pair',
    'sets': 'set',
    'bundles': 'bundle',
    'spools': 'spool',
    'lengths': 'length',
    'sticks': 'stick'
  };
  
  return unitMap[unit.toLowerCase()] || unit.toLowerCase();
}

/**
 * Normalize a material name using aliases
 */
function normalizeMaterialName(name) {
  if (!name) return name;
  
  const lower = name.toLowerCase().trim();
  
  // Check direct alias match
  if (MATERIAL_ALIASES[lower]) {
    return MATERIAL_ALIASES[lower];
  }
  
  // Check if it contains an alias
  for (const [alias, normalized] of Object.entries(MATERIAL_ALIASES)) {
    if (lower.includes(alias) && !lower.includes('romex')) {
      return lower.replace(alias, normalized);
    }
  }
  
  // Capitalize first letter of each word
  return name.trim()
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

/**
 * Parse a single material item string
 * Examples:
 * - "1 roll 12/2" -> { quantity: 1, unit: "roll", name: "12/2 Romex" }
 * - "4 boxes" -> { quantity: 4, name: "junction box" }
 * - "2 dimmers" -> { quantity: 2, name: "dimmer switch" }
 * - "receptacles x6" -> { quantity: 6, name: "receptacle" }
 */
function parseItem(itemStr) {
  if (!itemStr || !itemStr.trim()) return null;
  
  let str = itemStr.trim().toLowerCase();
  let quantity = 1;
  let unit = null;
  let name = '';
  
  // Pattern 1: "quantity unit name" (e.g., "1 roll 12/2")
  const pattern1 = /^(\d+)\s*([\w]+)\s+(.+)$/;
  
  // Pattern 2: "quantity name" (e.g., "4 boxes")
  const pattern2 = /^(\d+)\s+(.+)$/;
  
  // Pattern 3: "name xQuantity" or "name x quantity" (e.g., "boxes x4")
  const pattern3 = /^(.+?)\s*x\s*(\d+)$/;
  
  // Pattern 4: just a name with implied quantity of 1
  
  let match;
  
  if ((match = str.match(pattern1))) {
    quantity = parseInt(match[1]);
    const possibleUnit = match[2];
    const rest = match[3];
    
    if (UNITS.includes(possibleUnit)) {
      unit = normalizeUnit(possibleUnit);
      name = rest;
    } else {
      // The "unit" is actually part of the name
      name = possibleUnit + ' ' + rest;
    }
  } else if ((match = str.match(pattern3))) {
    name = match[1];
    quantity = parseInt(match[2]);
  } else if ((match = str.match(pattern2))) {
    quantity = parseInt(match[1]);
    name = match[2];
    
    // Check if first word of name is a unit
    const words = name.split(' ');
    if (words.length > 1 && UNITS.includes(words[0])) {
      unit = normalizeUnit(words[0]);
      name = words.slice(1).join(' ');
    }
  } else {
    // Just a name
    name = str;
  }
  
  // Normalize the material name
  name = normalizeMaterialName(name);
  
  if (!name) return null;
  
  const result = {
    name,
    quantity
  };
  
  if (unit) {
    result.unit = unit;
  }
  
  return result;
}

/**
 * Parse a full materials description string
 */
function parse(rawDescription) {
  if (!rawDescription || typeof rawDescription !== 'string') {
    return { items: [], raw: rawDescription };
  }
  
  logger.debug('Bot 3: Parsing materials', { raw: rawDescription });
  
  // Split by common delimiters
  const delimiters = /[,;\n]+/;
  const parts = rawDescription.split(delimiters)
    .map(p => p.trim())
    .filter(p => p.length > 0);
  
  const items = [];
  const seen = new Map(); // For duplicate detection and merging
  
  for (const part of parts) {
    const parsed = parseItem(part);
    
    if (parsed) {
      const key = `${parsed.name}|${parsed.unit || ''}`;
      
      if (seen.has(key)) {
        // Merge quantities for duplicate items
        seen.get(key).quantity += parsed.quantity;
      } else {
        items.push(parsed);
        seen.set(key, parsed);
      }
    }
  }
  
  logger.debug('Bot 3: Parsed materials', { 
    raw: rawDescription, 
    itemCount: items.length 
  });
  
  return {
    items,
    raw: rawDescription
  };
}

/**
 * Format items into a human-readable summary
 */
function formatSummary(items) {
  if (!items || items.length === 0) {
    return '';
  }
  
  return items.map(item => {
    const unitStr = item.unit ? ` ${item.unit}` : '';
    return `${item.quantity}${unitStr} ${item.name}`;
  }).join(', ');
}

/**
 * Format items into JSON for storage
 */
function toJSON(items) {
  return JSON.stringify(items);
}

/**
 * Parse JSON back to items array
 */
function fromJSON(json) {
  try {
    return JSON.parse(json);
  } catch {
    return [];
  }
}

module.exports = {
  parse,
  parseItem,
  formatSummary,
  toJSON,
  fromJSON,
  normalizeMaterialName,
  MATERIAL_ALIASES,
  UNITS
};





