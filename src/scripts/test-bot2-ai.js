/**
 * Test Bot 2 AI Features
 * 
 * Tests:
 * 1. Smart invoice description generation
 * 2. Intelligent job matching
 */

require('dotenv').config();
const aiService = require('../bot2/ai');

async function testSmartDescriptions() {
  console.log('\n=== TEST 1: Smart Invoice Descriptions ===\n');

  // Test cases from Bobby's typical Daily Job Log entries
  const testCases = [
    {
      rawNotes: 'replaced breakers ran new wire garage fixed outlet kitchen',
      phase: 'Service',
      hours: 4,
      materials: ['12/2 NM Cable', '20A Breakers (2)'],
      isEmergency: false
    },
    {
      rawNotes: 'panel upgrade 200amp, moved meter base, got permit',
      phase: 'Rough',
      hours: 8,
      materials: ['200A Panel', 'Meter Base', '4/0 Wire'],
      isEmergency: false
    },
    {
      rawNotes: 'no power emergency call traced to bad main breaker customer very upset',
      phase: 'Service',
      hours: 2,
      materials: ['200A Main Breaker'],
      isEmergency: true
    }
  ];

  for (const testCase of testCases) {
    console.log(`Input: "${testCase.rawNotes}"`);
    console.log(`Phase: ${testCase.phase}, Hours: ${testCase.hours}, Emergency: ${testCase.isEmergency}`);
    
    const result = await aiService.generateInvoiceDescription(testCase);
    console.log('\nAI Generated Description:');
    console.log('---');
    console.log(result);
    console.log('---\n');
  }
}

async function testJobMatching() {
  console.log('\n=== TEST 2: Intelligent Job Matching ===\n');

  // Simulated QBO customers
  const candidates = [
    { id: '1', name: 'Mike Johnson - Kihei Panel Upgrade' },
    { id: '2', name: 'Johnson & Sons Construction' },
    { id: '3', name: 'Wailea Fairway Homes - Unit 3' },
    { id: '4', name: 'Smith Residence - Lahaina' },
    { id: '5', name: 'ABC Electric Corp' },
    { id: '6', name: 'Maui Grand Hotel' },
    { id: '7', name: "Amy's Bird Sanctuary" },
    { id: '8', name: 'Kihei Town Center Renovation' }
  ];

  // Test searches
  const searches = [
    { term: 'Johnson', context: {} },
    { term: 'Jonson', context: {} }, // Typo
    { term: 'wailea project', context: {} },
    { term: 'Mike J panel', context: {} },
    { term: 'bird sanctuary', context: { vendor: 'Home Depot' } },
    { term: 'random project xyz', context: {} } // No match expected
  ];

  for (const search of searches) {
    console.log(`Searching for: "${search.term}"`);
    
    const result = await aiService.findBestJobMatch(search.term, candidates, search.context);
    
    if (result.match) {
      console.log(`  ✅ Matched to: "${result.match.name}"`);
      console.log(`     Confidence: ${result.confidence}%`);
      console.log(`     Method: ${result.method}`);
      if (result.reason) console.log(`     Reason: ${result.reason}`);
    } else {
      console.log(`  ❌ No match found (confidence: ${result.confidence}%)`);
    }
    console.log('');
  }
}

async function main() {
  console.log('Bot 2 AI Service Test');
  console.log('=====================');
  console.log(`OpenAI Available: ${aiService.isAvailable() ? 'YES' : 'NO'}`);
  
  if (!aiService.isAvailable()) {
    console.log('\n⚠️  OPENAI_API_KEY not set - testing fallback behavior\n');
  }

  try {
    await testSmartDescriptions();
    await testJobMatching();
    console.log('\n✅ All tests completed!');
  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
  }
}

main();

