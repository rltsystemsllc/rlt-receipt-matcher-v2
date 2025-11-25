/**
 * Test Receipt Parser
 * Tests parsing of sample receipt content
 */

require('dotenv').config();

const parserRouter = require('../parsers');
const { detectVendor } = require('../config/vendors');

// Sample receipt texts for testing
const sampleReceipts = {
  homeDepot: `
    THE HOME DEPOT
    Store #1234
    
    Order Date: 11/23/2025
    Order #: WM12345678
    
    1234567   ROMEX 14/2 WIRE 250FT   1   $89.97
    2345678   OUTLET BOX               5   $12.45
    3456789   WIRE NUTS ASSORTED       2   $8.99
    
    Subtotal:                         $111.41
    Sales Tax:                          $8.35
    ----------------------------------------
    Order Total:                      $119.76
    
    Payment: VISA **** 1234
  `,

  lowes: `
    LOWE'S
    Order Confirmation
    
    Order #: 123456789
    Order placed: November 23, 2025
    
    Items:
    - 12/2 Romex Wire 250ft - $79.99
    - Electrical Tape - $4.99
    - Wire Strippers - $12.99
    
    Subtotal: $97.97
    Tax: $7.35
    Order Total: $105.32
    
    Card ending in 5678
  `,

  amazon: `
    Amazon.com
    Order Confirmation
    
    Order placed: November 23, 2025
    Order #: 111-1234567-1234567
    
    Klein Tools Multimeter - $45.99
    Qty: 1
    
    Order Total: $49.53
    (includes $3.54 tax)
    
    Shipping to: John Smith
    Card ending in 9012
  `,

  ced: `
    CONSOLIDATED ELECTRICAL DISTRIBUTORS
    
    Invoice #: INV-12345
    Invoice Date: 11/23/2025
    Account #: 98765
    P.O. #: PO-2025-001
    
    Part#     Description              Qty   Unit    Ext
    ABC123    12/2 THHN Wire 500ft     2    $125.00  $250.00
    DEF456    200A Main Breaker        1    $189.99  $189.99
    
    Subtotal:                                        $439.99
    Sales Tax:                                        $33.00
    ----------------------------------------------------------
    Invoice Total:                                   $472.99
  `
};

async function main() {
  console.log('\n=== Testing Receipt Parsers ===\n');

  for (const [vendorKey, receiptText] of Object.entries(sampleReceipts)) {
    console.log(`--- Testing ${vendorKey} ---\n`);

    // Detect vendor
    const vendor = detectVendor({
      from: `${vendorKey}@example.com`,
      subject: 'Order Confirmation',
      snippet: receiptText.substring(0, 100)
    });

    console.log('Detected Vendor:', vendor?.name || 'Unknown');

    // Parse receipt
    try {
      const result = await parserRouter.parseText(receiptText, vendor);

      if (result) {
        console.log('Parsed Data:');
        console.log('  Total:', result.total);
        console.log('  Date:', result.date);
        console.log('  Order #:', result.orderNumber || result.invoiceNumber);
        console.log('  Card Last 4:', result.cardLast4);
        console.log('  Line Items:', result.lineItems.length);
        console.log('  Confidence:', result.confidence);

        if (result.lineItems.length > 0) {
          console.log('  First Item:', result.lineItems[0].description);
        }
      } else {
        console.log('  ✗ Failed to parse receipt');
      }
    } catch (error) {
      console.error('  Parse error:', error.message);
    }

    console.log('');
  }

  console.log('✓ Parser tests complete');
  process.exit(0);
}

main().catch((error) => {
  console.error('Test failed:', error);
  process.exit(1);
});


