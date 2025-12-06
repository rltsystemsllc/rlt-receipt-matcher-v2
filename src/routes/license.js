/**
 * License Helper Routes
 * Helps Bobby document historical projects for Hawaii DCCA contractor license application
 */

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

// Data file path
const DATA_FILE = path.join(process.cwd(), 'data', 'license-projects.json');

/**
 * Load projects from file
 */
function loadProjects() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const data = fs.readFileSync(DATA_FILE, 'utf8');
      return JSON.parse(data);
    }
  } catch (error) {
    logger.error('Failed to load license projects', { error: error.message });
  }
  return { projects: [], lastUpdated: null };
}

/**
 * Save projects to file
 */
function saveProjects(data) {
  try {
    const dir = path.dirname(DATA_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    data.lastUpdated = new Date().toISOString();
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
    return true;
  } catch (error) {
    logger.error('Failed to save license projects', { error: error.message });
    return false;
  }
}

/**
 * License Helper Dashboard
 */
router.get('/', (req, res) => {
  const data = loadProjects();
  const projects = data.projects || [];
  
  const stats = {
    total: projects.length,
    rlt: projects.filter(p => p.employer === 'RLT Systems').length,
    acdc: projects.filter(p => p.employer === 'AC/DC Electric LLC').length,
    wagner: projects.filter(p => p.employer === 'Wagner Electric').length,
    documented: projects.filter(p => p.documented).length
  };

  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>License Helper - RLT</title>
      <style>
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          max-width: 1000px;
          margin: 50px auto;
          padding: 20px;
          background: #f5f5f5;
        }
        .card {
          background: white;
          border-radius: 12px;
          padding: 24px;
          margin-bottom: 20px;
          box-shadow: 0 2px 8px rgba(0,0,0,0.1);
        }
        h1 { color: #2d3748; margin-top: 0; }
        h2 { color: #4a5568; margin-top: 0; }
        .stats {
          display: grid;
          grid-template-columns: repeat(5, 1fr);
          gap: 16px;
          margin: 20px 0;
        }
        .stat {
          text-align: center;
          padding: 16px;
          background: #f7fafc;
          border-radius: 8px;
        }
        .stat-value {
          font-size: 28px;
          font-weight: bold;
          color: #2d3748;
        }
        .stat-label {
          color: #718096;
          font-size: 12px;
        }
        .btn {
          display: inline-block;
          padding: 12px 24px;
          border-radius: 8px;
          text-decoration: none;
          font-weight: 500;
          margin-right: 10px;
          margin-bottom: 10px;
          border: none;
          cursor: pointer;
        }
        .btn-primary { background: #4299e1; color: white; }
        .btn-secondary { background: #edf2f7; color: #4a5568; }
        .btn-success { background: #48bb78; color: white; }
        table {
          width: 100%;
          border-collapse: collapse;
          margin-top: 16px;
        }
        th, td {
          padding: 12px;
          text-align: left;
          border-bottom: 1px solid #e2e8f0;
        }
        th { background: #f7fafc; font-weight: 600; }
        tr:hover { background: #f7fafc; }
        .badge {
          padding: 4px 8px;
          border-radius: 4px;
          font-size: 12px;
        }
        .badge-success { background: #c6f6d5; color: #276749; }
        .badge-pending { background: #fef3c7; color: #92400e; }
        .progress-bar {
          height: 8px;
          background: #e2e8f0;
          border-radius: 4px;
          overflow: hidden;
        }
        .progress-fill {
          height: 100%;
          background: #48bb78;
          transition: width 0.3s;
        }
      </style>
    </head>
    <body>
      <div class="card">
        <h1>📋 License Helper Tool</h1>
        <p>Document historical projects for Hawaii DCCA C-13 Electrical Contractor License</p>
        
        <div class="stats">
          <div class="stat">
            <div class="stat-value">${stats.total}</div>
            <div class="stat-label">Total Projects</div>
          </div>
          <div class="stat">
            <div class="stat-value">${stats.rlt}</div>
            <div class="stat-label">RLT Systems</div>
          </div>
          <div class="stat">
            <div class="stat-value">${stats.acdc}</div>
            <div class="stat-label">AC/DC Electric</div>
          </div>
          <div class="stat">
            <div class="stat-value">${stats.wagner}</div>
            <div class="stat-label">Wagner Electric</div>
          </div>
          <div class="stat">
            <div class="stat-value">${stats.documented}</div>
            <div class="stat-label">Documented</div>
          </div>
        </div>
        
        <div style="margin: 20px 0;">
          <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
            <span>Progress: ${stats.documented} / 200 projects</span>
            <span>${Math.round(stats.documented / 200 * 100)}%</span>
          </div>
          <div class="progress-bar">
            <div class="progress-fill" style="width: ${Math.min(stats.documented / 200 * 100, 100)}%"></div>
          </div>
        </div>
      </div>
      
      <div class="card">
        <h2>Actions</h2>
        <a href="/license/add" class="btn btn-success">+ Add Project</a>
        <a href="/license/import" class="btn btn-primary">Import from Invoices</a>
        <a href="/license/export" class="btn btn-secondary">Export for DCCA</a>
        <a href="/" class="btn btn-secondary">← Back to Dashboard</a>
      </div>
      
      <div class="card">
        <h2>Recent Projects</h2>
        ${projects.length === 0 ? '<p style="color: #718096;">No projects documented yet.</p>' : `
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Project</th>
              <th>Employer</th>
              <th>Type</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            ${projects.slice(0, 20).map(p => `
              <tr>
                <td>${p.date || 'N/A'}</td>
                <td>${p.name || p.description || 'Untitled'}</td>
                <td>${p.employer || 'N/A'}</td>
                <td>${p.type || 'N/A'}</td>
                <td>
                  <span class="badge ${p.documented ? 'badge-success' : 'badge-pending'}">
                    ${p.documented ? 'Documented' : 'Pending'}
                  </span>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
        `}
      </div>
    </body>
    </html>
  `);
});

/**
 * Add project form
 */
router.get('/add', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Add Project - License Helper</title>
      <style>
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          max-width: 600px;
          margin: 50px auto;
          padding: 20px;
          background: #f5f5f5;
        }
        .card {
          background: white;
          border-radius: 12px;
          padding: 24px;
          box-shadow: 0 2px 8px rgba(0,0,0,0.1);
        }
        h1 { color: #2d3748; margin-top: 0; }
        label {
          display: block;
          margin-bottom: 8px;
          font-weight: 500;
          color: #4a5568;
        }
        input, select, textarea {
          width: 100%;
          padding: 12px;
          margin-bottom: 16px;
          border: 1px solid #e2e8f0;
          border-radius: 8px;
          font-size: 16px;
          box-sizing: border-box;
        }
        .btn {
          padding: 12px 24px;
          border-radius: 8px;
          font-weight: 500;
          border: none;
          cursor: pointer;
          text-decoration: none;
        }
        .btn-success { background: #48bb78; color: white; }
        .btn-secondary { background: #edf2f7; color: #4a5568; }
      </style>
    </head>
    <body>
      <div class="card">
        <h1>Add Project</h1>
        <form action="/license/add" method="POST">
          <label>Project Name/Description</label>
          <input type="text" name="name" required placeholder="e.g., Panel Upgrade - 123 Main St">
          
          <label>Date</label>
          <input type="date" name="date" required>
          
          <label>Employer</label>
          <select name="employer" required>
            <option value="RLT Systems">RLT Systems</option>
            <option value="AC/DC Electric LLC">AC/DC Electric LLC</option>
            <option value="Wagner Electric">Wagner Electric</option>
          </select>
          
          <label>Project Type</label>
          <select name="type">
            <option value="Panel Upgrade">Panel Upgrade</option>
            <option value="New Construction">New Construction</option>
            <option value="Service Call">Service Call</option>
            <option value="Remodel">Remodel</option>
            <option value="Commercial">Commercial</option>
            <option value="Other">Other</option>
          </select>
          
          <label>Client Name</label>
          <input type="text" name="client" placeholder="Client or property owner name">
          
          <label>Location</label>
          <input type="text" name="location" placeholder="Address or general location">
          
          <label>Notes</label>
          <textarea name="notes" rows="3" placeholder="Additional details..."></textarea>
          
          <button type="submit" class="btn btn-success">Save Project</button>
          <a href="/license" class="btn btn-secondary" style="margin-left: 10px;">Cancel</a>
        </form>
      </div>
    </body>
    </html>
  `);
});

/**
 * Handle add project form submission
 */
router.post('/add', express.urlencoded({ extended: true }), (req, res) => {
  const data = loadProjects();
  
  const project = {
    id: Date.now().toString(),
    name: req.body.name,
    date: req.body.date,
    employer: req.body.employer,
    type: req.body.type,
    client: req.body.client,
    location: req.body.location,
    notes: req.body.notes,
    documented: true,
    createdAt: new Date().toISOString()
  };
  
  data.projects.push(project);
  saveProjects(data);
  
  logger.info('License project added', { projectId: project.id, name: project.name });
  
  res.redirect('/license');
});

/**
 * Export projects for DCCA
 */
router.get('/export', (req, res) => {
  const data = loadProjects();
  const projects = data.projects || [];
  
  // Generate CSV
  const headers = ['Date', 'Project Name', 'Employer', 'Type', 'Client', 'Location', 'Notes'];
  const rows = projects.map(p => [
    p.date || '',
    p.name || '',
    p.employer || '',
    p.type || '',
    p.client || '',
    p.location || '',
    (p.notes || '').replace(/"/g, '""')
  ]);
  
  const csv = [
    headers.join(','),
    ...rows.map(r => r.map(c => `"${c}"`).join(','))
  ].join('\n');
  
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=license-projects.csv');
  res.send(csv);
});

/**
 * Import page (placeholder)
 */
router.get('/import', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Import Projects - License Helper</title>
      <style>
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          max-width: 600px;
          margin: 50px auto;
          padding: 20px;
          background: #f5f5f5;
        }
        .card {
          background: white;
          border-radius: 12px;
          padding: 24px;
          box-shadow: 0 2px 8px rgba(0,0,0,0.1);
        }
        h1 { color: #2d3748; margin-top: 0; }
        p { color: #718096; }
        .btn {
          display: inline-block;
          padding: 12px 24px;
          border-radius: 8px;
          text-decoration: none;
          font-weight: 500;
        }
        .btn-secondary { background: #edf2f7; color: #4a5568; }
      </style>
    </head>
    <body>
      <div class="card">
        <h1>Import from Invoices</h1>
        <p>This feature will scan historical QuickBooks invoices and paper invoice images to extract project data.</p>
        <p>Place invoice images in: <code>data/license-invoices/</code></p>
        <p style="color: #718096; font-style: italic;">Feature coming soon...</p>
        <a href="/license" class="btn btn-secondary">← Back</a>
      </div>
    </body>
    </html>
  `);
});

/**
 * API: Get all projects
 */
router.get('/api/projects', (req, res) => {
  const data = loadProjects();
  res.json(data);
});

/**
 * API: Add project
 */
router.post('/api/projects', express.json(), (req, res) => {
  const data = loadProjects();
  
  const project = {
    id: Date.now().toString(),
    ...req.body,
    documented: true,
    createdAt: new Date().toISOString()
  };
  
  data.projects.push(project);
  
  if (saveProjects(data)) {
    res.json({ success: true, project });
  } else {
    res.status(500).json({ success: false, error: 'Failed to save' });
  }
});

module.exports = router;


