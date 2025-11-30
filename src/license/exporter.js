/**
 * Excel Exporter for License Projects
 * Exports to Hawaii's exact format
 */

const logger = require('../utils/logger');
const narrator = require('./narrator');

/**
 * Generate CSV content in Hawaii's format
 * CSV is more universally compatible than Excel
 */
function generateCSV(projects) {
  // Hawaii's column headers
  const headers = [
    'Project Start Date',
    'Project End Date',
    'Project Name',
    'Employer',
    'Classification',
    'Position Title (Number of Workers Supervised)',
    'Brief Description',
    'Detailed Description of Project and Work Supervised',
    'Contract Amount',
    'Amount of Supervisory Experience (months)'
  ];

  // Build rows
  const rows = projects.map(project => {
    const briefDesc = project.briefDescription || narrator.generateBriefDescription(project);
    const detailedDesc = project.detailedDescription || narrator.generateNarrative(project);
    const positionTitle = project.positionTitle || narrator.generatePositionTitle(project.workersSupervised);
    
    return [
      formatDate(project.startDate),
      project.endDate ? formatDate(project.endDate) : 'In progress',
      project.projectName || '',
      project.employer || 'RLT Systems',
      'C-13 ELECTRICAL CONTRACTING',
      positionTitle,
      escapeCsvField(briefDesc),
      escapeCsvField(detailedDesc),
      formatCurrency(project.contractAmount),
      project.experienceMonths || '1'
    ];
  });

  // Combine headers and rows
  const csvContent = [
    headers.map(h => `"${h}"`).join(','),
    ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
  ].join('\n');

  return csvContent;
}

/**
 * Generate HTML table for preview/printing
 */
function generateHTMLTable(projects) {
  const rows = projects.map(project => {
    const briefDesc = project.briefDescription || narrator.generateBriefDescription(project);
    const detailedDesc = project.detailedDescription || narrator.generateNarrative(project);
    const positionTitle = project.positionTitle || narrator.generatePositionTitle(project.workersSupervised);

    return `
      <tr>
        <td>${formatDate(project.startDate)}</td>
        <td>${project.endDate ? formatDate(project.endDate) : 'In progress'}</td>
        <td><strong>${project.projectName || ''}</strong></td>
        <td>${project.employer || 'RLT Systems'}</td>
        <td>C-13 ELECTRICAL CONTRACTING</td>
        <td>${positionTitle}</td>
        <td style="white-space: pre-line;">${briefDesc}</td>
        <td style="white-space: pre-line;">${detailedDesc}</td>
        <td>${formatCurrency(project.contractAmount)}</td>
        <td>${project.experienceMonths || '1'} month${project.experienceMonths > 1 ? 's' : ''}</td>
      </tr>
    `;
  }).join('');

  return `
    <table border="1" cellpadding="8" cellspacing="0" style="border-collapse: collapse; font-size: 11px; font-family: Arial, sans-serif;">
      <thead style="background: #1a1a2e; color: white;">
        <tr>
          <th>Start Date</th>
          <th>End Date</th>
          <th>Project Name</th>
          <th>Employer</th>
          <th>Classification</th>
          <th>Position Title</th>
          <th>Brief Description</th>
          <th>Detailed Description</th>
          <th>Contract Amount</th>
          <th>Experience</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>
  `;
}

/**
 * Format date to MM/YY
 */
function formatDate(dateStr) {
  if (!dateStr) return '';
  
  try {
    const date = new Date(dateStr);
    const month = date.getMonth() + 1;
    const year = date.getFullYear().toString().slice(-2);
    return `${month}/${year}`;
  } catch {
    return dateStr;
  }
}

/**
 * Format currency
 */
function formatCurrency(amount) {
  if (!amount) return '';
  
  const num = parseFloat(String(amount).replace(/[$,]/g, ''));
  if (isNaN(num)) return amount;
  
  return `$${num.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

/**
 * Escape CSV field
 */
function escapeCsvField(field) {
  if (!field) return '';
  return String(field).replace(/\n/g, ' | ').replace(/"/g, "'");
}

module.exports = {
  generateCSV,
  generateHTMLTable,
  formatDate,
  formatCurrency
};

