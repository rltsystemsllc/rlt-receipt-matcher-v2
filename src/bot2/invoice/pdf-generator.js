/**
 * PDF Generator for Bot 2
 * Creates internal summary PDFs for labor and materials
 */

const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const config = require('../../config');
const logger = require('../../utils/logger');

// Ensure output directory exists
const outputDir = config.pdf.outputDir;
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

/**
 * Generate labor summary PDF
 */
async function generateLaborSummary(jobName, laborData, rows) {
  return new Promise((resolve, reject) => {
    try {
      const filename = `labor-summary-${Date.now()}.pdf`;
      const filepath = path.join(outputDir, filename);
      
      const doc = new PDFDocument({ margin: 50 });
      const stream = fs.createWriteStream(filepath);
      
      doc.pipe(stream);

      // Header
      doc.fontSize(20).font('Helvetica-Bold')
        .text('LABOR SUMMARY', { align: 'center' });
      doc.fontSize(10).font('Helvetica')
        .text('Internal Document - Not for Customer', { align: 'center' });
      doc.moveDown();

      // Job Info
      doc.fontSize(14).font('Helvetica-Bold').text('Job Details');
      doc.fontSize(11).font('Helvetica')
        .text(`Job Name: ${jobName}`)
        .text(`Generated: ${new Date().toLocaleString()}`)
        .text(`Total Hours: ${laborData.totalHours}`)
        .text(`Phase(s): ${laborData.phases.join(', ')}`)
        .text(`Standard Rate: $${laborData.standardRate}/hr`)
        .text(`Total Labor: $${laborData.total.toFixed(2)}`);
      
      doc.moveDown();

      // Entries Table
      doc.fontSize(14).font('Helvetica-Bold').text('Work Entries');
      doc.moveDown(0.5);

      // Table header
      const tableTop = doc.y;
      doc.fontSize(9).font('Helvetica-Bold');
      doc.text('Date', 50, tableTop, { width: 70 });
      doc.text('Hours', 120, tableTop, { width: 40 });
      doc.text('Phase', 160, tableTop, { width: 80 });
      doc.text('Description', 240, tableTop, { width: 310 });
      
      doc.moveTo(50, tableTop + 15).lineTo(550, tableTop + 15).stroke();

      // Table rows
      let y = tableTop + 20;
      doc.font('Helvetica').fontSize(9);
      
      for (const entry of laborData.entries) {
        if (y > 700) {
          doc.addPage();
          y = 50;
        }
        
        doc.text(entry.date || '-', 50, y, { width: 70 });
        doc.text(entry.hours.toString(), 120, y, { width: 40 });
        doc.text(entry.phase || '-', 160, y, { width: 80 });
        doc.text((entry.description || '-').substring(0, 60), 240, y, { width: 310 });
        
        y += 20;
      }

      doc.moveDown(2);

      // Polished Summary
      doc.fontSize(14).font('Helvetica-Bold').text('Summary (For Invoice)');
      doc.moveDown(0.5);
      doc.fontSize(10).font('Helvetica').text(laborData.summary);

      // Footer
      doc.fontSize(8).font('Helvetica')
        .text(`${config.pdf.companyName} | ${config.pdf.companyPhone}`, 50, 750, { align: 'center' });

      doc.end();

      stream.on('finish', () => {
        logger.info('Labor summary PDF generated', { filepath });
        resolve(filepath);
      });

      stream.on('error', reject);

    } catch (error) {
      logger.error('Failed to generate labor PDF', { error: error.message });
      reject(error);
    }
  });
}

/**
 * Generate materials summary PDF
 */
async function generateMaterialsSummary(jobName, billableExpenses, stockMaterials) {
  return new Promise((resolve, reject) => {
    try {
      const filename = `materials-summary-${Date.now()}.pdf`;
      const filepath = path.join(outputDir, filename);
      
      const doc = new PDFDocument({ margin: 50 });
      const stream = fs.createWriteStream(filepath);
      
      doc.pipe(stream);

      // Header
      doc.fontSize(20).font('Helvetica-Bold')
        .text('MATERIALS SUMMARY', { align: 'center' });
      doc.fontSize(10).font('Helvetica')
        .text('Internal Document - Not for Customer', { align: 'center' });
      doc.moveDown();

      // Job Info
      doc.fontSize(14).font('Helvetica-Bold').text('Job Details');
      doc.fontSize(11).font('Helvetica')
        .text(`Job Name: ${jobName}`)
        .text(`Generated: ${new Date().toLocaleString()}`);
      
      doc.moveDown();

      // Billable Expenses (from receipts - Bot 1)
      doc.fontSize(14).font('Helvetica-Bold').text('Receipt Materials (Bot 1)');
      doc.moveDown(0.5);

      if (billableExpenses.length === 0) {
        doc.fontSize(10).font('Helvetica').text('No billable receipts found.');
      } else {
        const tableTop = doc.y;
        doc.fontSize(9).font('Helvetica-Bold');
        doc.text('Vendor', 50, tableTop, { width: 120 });
        doc.text('Date', 170, tableTop, { width: 80 });
        doc.text('Amount', 250, tableTop, { width: 80 });
        doc.text('Expense ID', 330, tableTop, { width: 100 });
        
        doc.moveTo(50, tableTop + 15).lineTo(550, tableTop + 15).stroke();

        let y = tableTop + 20;
        doc.font('Helvetica').fontSize(9);
        let receiptTotal = 0;
        
        for (const expense of billableExpenses) {
          doc.text(expense.vendor, 50, y, { width: 120 });
          doc.text(expense.date, 170, y, { width: 80 });
          doc.text(`$${expense.amount.toFixed(2)}`, 250, y, { width: 80 });
          doc.text(expense.id, 330, y, { width: 100 });
          receiptTotal += expense.amount;
          y += 18;
        }

        doc.moveDown();
        doc.font('Helvetica-Bold')
          .text(`Receipt Materials Total: $${receiptTotal.toFixed(2)}`);
      }

      doc.moveDown(2);

      // Stock/Truck Materials
      doc.fontSize(14).font('Helvetica-Bold').text('Stock/Truck Materials');
      doc.moveDown(0.5);

      if (stockMaterials.items.length === 0) {
        doc.fontSize(10).font('Helvetica').text('No stock materials listed.');
      } else {
        const tableTop = doc.y;
        doc.fontSize(9).font('Helvetica-Bold');
        doc.text('Item', 50, tableTop, { width: 200 });
        doc.text('Base Cost', 250, tableTop, { width: 80 });
        doc.text('Markup', 330, tableTop, { width: 60 });
        doc.text('Total', 390, tableTop, { width: 80 });
        
        doc.moveTo(50, tableTop + 15).lineTo(550, tableTop + 15).stroke();

        let y = tableTop + 20;
        doc.font('Helvetica').fontSize(9);
        
        for (const item of stockMaterials.items) {
          doc.text(item.description, 50, y, { width: 200 });
          doc.text(`$${item.baseCost.toFixed(2)}`, 250, y, { width: 80 });
          doc.text(`${item.markup}%`, 330, y, { width: 60 });
          doc.text(`$${item.total.toFixed(2)}`, 390, y, { width: 80 });
          y += 18;
        }

        doc.moveDown();
        doc.font('Helvetica-Bold')
          .text(`Stock Materials Total: $${stockMaterials.total.toFixed(2)}`);
      }

      doc.moveDown(2);

      // Grand Total
      const grandTotal = billableExpenses.reduce((sum, e) => sum + e.amount, 0) + stockMaterials.total;
      doc.fontSize(14).font('Helvetica-Bold')
        .text(`TOTAL MATERIALS: $${grandTotal.toFixed(2)}`);

      // Footer
      doc.fontSize(8).font('Helvetica')
        .text(`${config.pdf.companyName} | ${config.pdf.companyPhone}`, 50, 750, { align: 'center' });

      doc.end();

      stream.on('finish', () => {
        logger.info('Materials summary PDF generated', { filepath });
        resolve(filepath);
      });

      stream.on('error', reject);

    } catch (error) {
      logger.error('Failed to generate materials PDF', { error: error.message });
      reject(error);
    }
  });
}

module.exports = {
  generateLaborSummary,
  generateMaterialsSummary
};



