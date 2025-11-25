# ⚡ RLT Receipt Matcher

**Automated receipt processing for QuickBooks Online**

A Node.js service that monitors your Gmail for receipt emails, parses them, and automatically syncs them to QuickBooks Online. Perfect for electricians, contractors, and small businesses that need to track expenses efficiently.

---

## 🎯 What It Does

1. **📧 Reads Receipts from Gmail** - Automatically monitors your inbox for receipts from Home Depot, Lowe's, Amazon, CED, and more
2. **🔍 Parses Receipt Data** - Extracts vendor, date, total, line items, and payment info from PDFs, HTML emails, and images
3. **💼 Syncs to QuickBooks** - Matches receipts to credit card transactions, creates expenses, and assigns to jobs/projects
4. **⏰ Runs Automatically** - Checks for new receipts every 5 minutes (configurable)

---

## 🚀 Quick Start

### Prerequisites

- Node.js 18 or higher
- Gmail account with API access
- QuickBooks Online account with API access

### Installation

```bash
# Clone or create the project
cd rlt-receipt-matcher

# Install dependencies
npm install

# Copy environment template
copy env.example .env

# Edit .env with your credentials (see Setup Guides below)
```

### Run the Bot

```bash
# Development mode (with auto-reload)
npm run dev

# Production mode
npm start
```

Then visit **http://localhost:3000** to:
1. Connect your Gmail account
2. Connect your QuickBooks account
3. Watch receipts get processed automatically!

---

## 📋 Setup Guides

### Gmail API Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project (or select existing)
3. Enable the **Gmail API**
4. Go to **APIs & Services → Credentials**
5. Create **OAuth 2.0 Client ID**
   - Application type: Web application
   - Authorized redirect URIs: `http://localhost:3000/auth/gmail/callback`
6. Copy the **Client ID** and **Client Secret** to your `.env` file

### QuickBooks API Setup

1. Go to [Intuit Developer Portal](https://developer.intuit.com/)
2. Create an app (choose appropriate scopes)
3. Get your **Client ID** and **Client Secret**
4. Add redirect URI: `http://localhost:3000/auth/quickbooks/callback`
5. Copy credentials to your `.env` file
6. Set `QBO_ENVIRONMENT=sandbox` for testing, `production` when ready

---

## 🧩 Supported Vendors

| Vendor | Receipt Type | Status |
|--------|--------------|--------|
| 💡 **Read Lighting** | PDF, HTML | ✅ Full support |
| 🏠 Home Depot | PDF, HTML | ✅ Full support |
| 🔧 Lowe's | HTML, Image | ✅ Full support |
| 📦 Amazon | HTML | ✅ Full support |
| ⚡ CED | PDF | ✅ Full support |
| 🔌 Alpha Supply | PDF | ✅ Full support |
| 🛠️ Ace Hardware | HTML | ✅ Basic support |

**Adding new vendors is easy!** See `src/config/vendors.js` and `src/parsers/vendors/`

---

## 📁 Project Structure

```
rlt-receipt-matcher/
├── src/
│   ├── index.js              # Main entry point
│   ├── config/
│   │   ├── index.js          # Configuration loader
│   │   └── vendors.js        # Vendor detection rules
│   ├── services/
│   │   ├── gmail/            # Gmail API integration
│   │   ├── quickbooks/       # QuickBooks API integration
│   │   └── scheduler.js      # Job scheduler
│   ├── parsers/
│   │   ├── index.js          # Parser router
│   │   ├── pdf.js            # PDF text extraction
│   │   ├── html.js           # HTML parsing
│   │   ├── image.js          # OCR for images
│   │   └── vendors/          # Vendor-specific parsers
│   ├── models/
│   │   └── receipt.js        # Receipt data structure
│   ├── routes/               # Express routes
│   ├── utils/                # Helpers & logging
│   └── scripts/              # Test & setup scripts
├── tokens/                   # OAuth tokens (gitignored)
├── logs/                     # Application logs
├── env.example               # Environment template
└── package.json
```

---

## 🔧 Configuration

All configuration is in `.env`:

```env
# Server
PORT=3000
NODE_ENV=development

# Gmail
GMAIL_CLIENT_ID=your_id
GMAIL_CLIENT_SECRET=your_secret
GMAIL_USER_EMAIL=your_email@gmail.com
GMAIL_PROCESSED_LABEL=RLT-Processed

# QuickBooks
QBO_CLIENT_ID=your_id
QBO_CLIENT_SECRET=your_secret
QBO_ENVIRONMENT=sandbox
QBO_REALM_ID=your_company_id

# Scheduler (cron format)
SCHEDULER_CRON=*/5 * * * *  # Every 5 minutes
SCHEDULER_ENABLED=true

# Features
ENABLE_OCR=true  # For image receipts
```

---

## 🧪 Testing

```bash
# Test Gmail connection
npm run test:gmail

# Test QuickBooks connection
npm run test:qbo

# Test receipt parsers
npm run test:parse
```

---

## 📊 Dashboard

Visit **http://localhost:3000** to see:
- ✅ Connection status for Gmail & QuickBooks
- 📈 Processing statistics
- 🔄 Manual run trigger
- 🔐 OAuth connection links

---

## 🔄 How It Works

### Processing Pipeline

```
1. FETCH      → Get unread emails matching receipt patterns
2. DETECT     → Identify vendor from email sender/content
3. PARSE      → Extract data using vendor-specific parser
4. NORMALIZE  → Create standardized receipt object
5. MATCH      → Find matching credit card transaction in QBO
6. SYNC       → Create/update expense with job assignment
7. MARK       → Label email as processed in Gmail
```

### Receipt Data Structure

```javascript
{
  id: "RLT-ABC123",
  vendor: {
    name: "Home Depot",
    displayName: "The Home Depot"
  },
  transaction: {
    date: "2025-11-23",
    total: 119.76,
    tax: 8.35
  },
  payment: {
    method: "VISA",
    cardLast4: "1234"
  },
  job: {
    name: "Kitchen Remodel - Smith"
  },
  lineItems: [
    { description: "ROMEX 14/2 WIRE", quantity: 1, totalPrice: 89.97 }
  ]
}
```

---

## 💡 Tips & Recommendations

### For Best Results

1. **Use consistent job naming** - Include customer name and project type
2. **Forward receipts** - If you get paper receipts, take a photo and email it to yourself
3. **Check the logs** - `logs/app.log` shows all processing details
4. **Run manually first** - Use the dashboard to test before relying on automatic runs

### Future Enhancements We Could Add

- 📱 **Mobile app** for snapping paper receipts
- 📊 **Weekly summary emails** with expense reports
- 🤖 **AI-powered job matching** using past receipt history
- 📁 **Google Drive backup** of all processed receipts
- 🔔 **Slack/Discord notifications** for high-value purchases
- 📋 **Approval workflow** for receipts over certain amounts

---

## 🛟 Troubleshooting

### Gmail not connecting?
- Check OAuth credentials are correct
- Ensure Gmail API is enabled in Google Cloud
- Verify redirect URI matches exactly

### QuickBooks not connecting?
- Check you're using correct environment (sandbox vs production)
- Verify redirect URI in Intuit Developer Portal
- Make sure company ID (realm ID) is set

### Receipts not parsing?
- Check `logs/app.log` for parsing errors
- Run `npm run test:parse` to test parsers
- Some receipts may need vendor-specific parser additions

### OCR not working?
- First run downloads language data (~15MB)
- Check `ENABLE_OCR=true` in .env
- Image must be readable quality

---

## 📄 License

Private - Read Lighting

---

## 🙋 Support

For issues or questions:
1. Check the logs in `logs/app.log`
2. Run the test scripts to diagnose
3. Check the dashboard at http://localhost:3000/health/detailed

---

Built with ❤️ for electricians who'd rather be wiring than doing paperwork!


