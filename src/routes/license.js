/**
 * License Helper Tool Routes
 * Web interface for Bobby to create his project listing
 */

const express = require('express');
const router = express.Router();
const multer = require('multer');
const licenseService = require('../license');
const narrator = require('../license/narrator');
const exporter = require('../license/exporter');
const extractor = require('../license/extractor');
const logger = require('../utils/logger');

// Configure multer for invoice uploads
const storage = multer.memoryStorage();
const upload = multer({ 
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type'));
    }
  }
});

// CSS Styles
const styles = `
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: linear-gradient(135deg, #0a192f 0%, #112240 50%, #1a365d 100%);
    min-height: 100vh;
    color: #e0e0e0;
    padding: 20px;
  }
  .container { max-width: 1200px; margin: 0 auto; }
  h1 { color: #64ffda; text-align: center; margin-bottom: 10px; }
  .subtitle { color: #8892b0; text-align: center; margin-bottom: 30px; }
  .card {
    background: rgba(255,255,255,0.05);
    border-radius: 16px;
    padding: 24px;
    margin-bottom: 20px;
    border: 1px solid rgba(100,255,218,0.1);
  }
  .card h2 { color: #64ffda; margin-bottom: 20px; }
  .form-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 20px; }
  .form-group { margin-bottom: 15px; }
  .form-group label { display: block; color: #64ffda; margin-bottom: 8px; font-weight: 500; }
  .form-group input, .form-group select, .form-group textarea {
    width: 100%; padding: 12px; border-radius: 8px;
    border: 1px solid rgba(100,255,218,0.3);
    background: rgba(10,25,47,0.8); color: #e0e0e0; font-size: 16px;
  }
  .form-group textarea { min-height: 100px; resize: vertical; }
  .checkbox-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px; }
  .checkbox-item {
    display: flex; align-items: center; gap: 8px; padding: 8px 12px;
    background: rgba(100,255,218,0.05); border-radius: 8px; cursor: pointer;
  }
  .checkbox-item input { width: 18px; height: 18px; accent-color: #64ffda; }
  .btn {
    display: inline-block; padding: 12px 24px; border-radius: 8px;
    font-weight: 600; cursor: pointer; border: none; text-decoration: none; margin: 5px;
  }
  .btn-primary { background: linear-gradient(135deg, #64ffda, #00d4aa); color: #0a192f; }
  .btn-secondary { background: rgba(100,255,218,0.1); color: #64ffda; border: 1px solid rgba(100,255,218,0.3); }
  .btn-danger { background: rgba(255,107,107,0.2); color: #ff6b6b; }
  .btn-voice { background: linear-gradient(135deg, #ff6b6b, #ff8e8e); color: white; padding: 20px 40px; font-size: 18px; }
  .btn-voice.recording { animation: pulse 1s infinite; }
  @keyframes pulse { 0%,100% { transform: scale(1); } 50% { transform: scale(1.05); } }
  .progress-bar { background: rgba(255,255,255,0.1); border-radius: 20px; height: 30px; margin: 20px 0; overflow: hidden; }
  .progress-fill { background: linear-gradient(90deg, #64ffda, #00d4aa); height: 100%; display: flex; align-items: center; justify-content: center; font-weight: bold; color: #0a192f; }
  .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 15px; margin-bottom: 20px; }
  .stat-card { background: rgba(255,255,255,0.05); border-radius: 12px; padding: 20px; text-align: center; }
  .stat-value { font-size: 2rem; font-weight: bold; color: #64ffda; }
  .stat-label { color: #8892b0; }
  .project-item {
    display: flex; justify-content: space-between; align-items: center;
    padding: 15px; background: rgba(255,255,255,0.03); border-radius: 8px;
    margin-bottom: 10px; border-left: 4px solid #64ffda;
  }
  .project-item.draft { border-left-color: #ffc107; }
  .badge { padding: 4px 10px; border-radius: 12px; font-size: 0.8rem; }
  .badge-complete { background: rgba(100,255,218,0.2); color: #64ffda; }
  .badge-draft { background: rgba(255,193,7,0.2); color: #ffc107; }
  .upload-zone {
    border: 3px dashed rgba(100,255,218,0.3); border-radius: 20px; padding: 60px;
    text-align: center; cursor: pointer; transition: all 0.3s;
  }
  .upload-zone:hover { border-color: #64ffda; background: rgba(100,255,218,0.1); }
  .upload-zone .icon { font-size: 4rem; margin-bottom: 20px; }
  .voice-section { text-align: center; padding: 30px; background: rgba(255,107,107,0.05); border-radius: 16px; margin: 20px 0; }
  .extracted-badge { background: rgba(100,255,218,0.2); color: #64ffda; padding: 2px 8px; border-radius: 4px; font-size: 0.7rem; margin-left: 8px; }
  .nav-link { color: #64ffda; }
  a { color: #64ffda; }
</style>
`;

/**
 * Dashboard
 */
router.get('/', async (req, res) => {
  try {
    const stats = licenseService.getStats();
    const projects = licenseService.getAllProjects();
    const progressPercent = stats.total > 0 ? Math.round((stats.complete / 200) * 100) : 0;
    const now = new Date();
    const endOfYear = new Date(now.getFullYear(), 11, 31);
    const daysRemaining = Math.ceil((endOfYear - now) / (1000 * 60 * 60 * 24));

    let projectsHtml = '<p style="text-align:center;color:#8892b0;">No projects yet. Start by adding one!</p>';
    if (projects.length > 0) {
      projectsHtml = projects.slice(0, 20).map(p => `
        <div class="project-item ${p.status}">
          <div>
            <strong>${p.projectName || 'Unnamed'}</strong><br>
            <small style="color:#8892b0">${p.employer || ''} • ${p.startDate || '??'} • $${p.contractAmount || '??'}</small>
            <span class="badge badge-${p.status}">${p.status}</span>
          </div>
          <div>
            <a href="/license/edit/${p.id}" class="btn btn-secondary">Edit</a>
            <form action="/license/delete/${p.id}" method="POST" style="display:inline" onsubmit="return confirm('Delete?')">
              <button class="btn btn-danger">X</button>
            </form>
          </div>
        </div>
      `).join('');
    }

    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>License Helper | RLT</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        ${styles}
      </head>
      <body>
        <div class="container">
          <h1>📋 License Project Helper</h1>
          <p class="subtitle">Hawaii C-13 Electrical Contractor License • ${daysRemaining} days until end of year</p>
          
          <div class="progress-bar">
            <div class="progress-fill" style="width:${Math.min(progressPercent, 100)}%">
              ${stats.complete} / 200 Projects (${progressPercent}%)
            </div>
          </div>

          <div class="stats-grid">
            <div class="stat-card"><div class="stat-value">${stats.total}</div><div class="stat-label">Total</div></div>
            <div class="stat-card"><div class="stat-value">${stats.complete}</div><div class="stat-label">Complete</div></div>
            <div class="stat-card"><div class="stat-value">${stats.draft}</div><div class="stat-label">Drafts</div></div>
            <div class="stat-card"><div class="stat-value">${stats.totalYears}</div><div class="stat-label">Years Exp</div></div>
          </div>

          <div style="margin-bottom:20px">
            <a href="/license/new" class="btn btn-primary">➕ Add Project</a>
            <a href="/license/export" class="btn btn-secondary">📥 Export CSV</a>
            <a href="/license/preview" class="btn btn-secondary">👁️ Preview</a>
            <a href="/" class="btn btn-secondary">← Dashboard</a>
          </div>

          <div class="card">
            <h2>Recent Projects</h2>
            ${projectsHtml}
          </div>
        </div>
      </body>
      </html>
    `);
  } catch (error) {
    logger.error('License dashboard error', { error: error.message });
    res.status(500).send('Error: ' + error.message);
  }
});

/**
 * New Project - Upload Invoice First
 */
router.get('/new', (req, res) => {
  if (req.query.extracted) {
    try {
      const extracted = JSON.parse(decodeURIComponent(req.query.extracted));
      return renderForm(res, null, extracted);
    } catch (e) { /* fall through */ }
  }
  
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Upload Invoice | License Helper</title>
      <meta name="viewport" content="width=device-width, initial-scale=1">
      ${styles}
    </head>
    <body>
      <div class="container">
        <h1>📄 Upload Invoice</h1>
        <p class="subtitle"><a href="/license">← Back</a></p>
        
        <div class="card">
          <h2>📸 Scan or Upload Bobby's Invoice</h2>
          <p style="color:#8892b0;margin-bottom:20px">AI will read it and fill the form automatically!</p>
          
          <form action="/license/upload" method="POST" enctype="multipart/form-data" id="uploadForm">
            <div class="upload-zone" onclick="document.getElementById('fileInput').click()">
              <div class="icon">📄</div>
              <h3 style="color:#64ffda">Drop Invoice Here or Click</h3>
              <p style="color:#8892b0">JPG, PNG, PDF (max 10MB)</p>
              <input type="file" id="fileInput" name="invoice" accept="image/*,.pdf" style="display:none" onchange="this.form.submit()">
            </div>
          </form>
          
          <div style="text-align:center;margin-top:30px;color:#8892b0">— OR —</div>
          
          <div style="text-align:center;margin-top:20px">
            <a href="/license/new/manual" class="btn btn-secondary">✏️ Enter Manually</a>
          </div>
        </div>
      </div>
    </body>
    </html>
  `);
});

/**
 * Manual entry
 */
router.get('/new/manual', (req, res) => {
  renderForm(res, null, null);
});

/**
 * Upload handler
 */
router.post('/upload', upload.single('invoice'), async (req, res) => {
  try {
    if (!req.file) {
      return res.redirect('/license/new/manual?error=No file');
    }
    
    logger.info('Processing invoice upload', { size: req.file.size });
    const extracted = await extractor.extractFromInvoice(req.file.buffer);
    
    if (!extracted.success) {
      return res.redirect('/license/new/manual?error=Could not read invoice');
    }
    
    const json = encodeURIComponent(JSON.stringify(extracted));
    res.redirect('/license/new?extracted=' + json);
  } catch (error) {
    logger.error('Upload failed', { error: error.message });
    res.redirect('/license/new/manual?error=' + error.message);
  }
});

/**
 * Edit project
 */
router.get('/edit/:id', (req, res) => {
  const project = licenseService.getProject(req.params.id);
  if (!project) return res.redirect('/license');
  renderForm(res, project, null);
});

/**
 * Render form
 */
function renderForm(res, project, extracted) {
  const isEdit = !!project;
  const data = project || extracted || {};
  const scopeItems = data.scopeItems || [];
  const hasExtracted = !!extracted;

  const employerOptions = licenseService.EMPLOYERS.map(e => 
    `<option value="${e}" ${data.employer === e ? 'selected' : ''}>${e}</option>`
  ).join('');
  
  const typeOptions = licenseService.PROJECT_TYPES.map(t =>
    `<option value="${t}" ${data.projectType === t ? 'selected' : ''}>${t}</option>`
  ).join('');
  
  const scopeCheckboxes = licenseService.SCOPE_ITEMS.map(item =>
    `<label class="checkbox-item">
      <input type="checkbox" name="scopeItems" value="${item}" ${scopeItems.includes(item) ? 'checked' : ''}>
      ${item}
    </label>`
  ).join('');

  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>${isEdit ? 'Edit' : 'Add'} Project | License Helper</title>
      <meta name="viewport" content="width=device-width, initial-scale=1">
      ${styles}
    </head>
    <body>
      <div class="container">
        <h1>${isEdit ? '✏️ Edit' : '➕ Add'} Project</h1>
        <p class="subtitle"><a href="/license">← Back</a></p>
        
        ${hasExtracted ? '<div class="card" style="background:rgba(100,255,218,0.1);border-color:#64ffda"><h2>🤖 AI Extracted Data!</h2><p>Review and edit below. Green badges show AI-filled fields.</p></div>' : ''}

        <form action="/license/${isEdit ? 'update/' + project.id : 'create'}" method="POST">
          
          <div class="card">
            <h2>📋 Basic Info ${hasExtracted && data.projectName ? '<span class="extracted-badge">AI</span>' : ''}</h2>
            <div class="form-grid">
              <div class="form-group">
                <label>Project Name *</label>
                <input type="text" name="projectName" required value="${data.projectName || ''}">
              </div>
              <div class="form-group">
                <label>Location ${hasExtracted && data.location ? '<span class="extracted-badge">AI</span>' : ''}</label>
                <input type="text" name="location" value="${data.location || ''}">
              </div>
              <div class="form-group">
                <label>Employer *</label>
                <select name="employer" required>${employerOptions}</select>
              </div>
              <div class="form-group">
                <label>Project Type * ${hasExtracted && data.projectType ? '<span class="extracted-badge">AI</span>' : ''}</label>
                <select name="projectType" required><option value="">Select...</option>${typeOptions}</select>
              </div>
            </div>
          </div>

          <div class="card">
            <h2>📅 Dates & Contract ${hasExtracted && data.contractAmount ? '<span class="extracted-badge">AI</span>' : ''}</h2>
            <div class="form-grid">
              <div class="form-group">
                <label>Start Date *</label>
                <input type="month" name="startDate" required value="${data.startDate || ''}">
              </div>
              <div class="form-group">
                <label>End Date (blank = in progress)</label>
                <input type="month" name="endDate" value="${data.endDate || ''}">
              </div>
              <div class="form-group">
                <label>Contract Amount *</label>
                <input type="text" name="contractAmount" required value="${data.contractAmount || ''}">
              </div>
              <div class="form-group">
                <label>Square Footage</label>
                <input type="text" name="squareFootage" value="${data.squareFootage || ''}">
              </div>
              <div class="form-group">
                <label>Workers Supervised *</label>
                <select name="workersSupervised" required>
                  <option value="1" ${data.workersSupervised == 1 ? 'selected' : ''}>1</option>
                  <option value="2" ${data.workersSupervised == 2 ? 'selected' : ''}>2</option>
                  <option value="3" ${data.workersSupervised == 3 ? 'selected' : ''}>3</option>
                  <option value="4" ${data.workersSupervised == 4 ? 'selected' : ''}>4+</option>
                </select>
              </div>
              <div class="form-group">
                <label>Months Experience *</label>
                <input type="number" name="experienceMonths" required min="1" max="24" value="${data.experienceMonths || 1}">
              </div>
            </div>
          </div>

          <div class="card">
            <h2>🔧 Scope ${hasExtracted && scopeItems.length ? '<span class="extracted-badge">' + scopeItems.length + ' detected</span>' : ''}</h2>
            <div class="checkbox-grid">${scopeCheckboxes}</div>
          </div>

          <div class="card">
            <h2>🎤 Voice Description</h2>
            <p style="color:#8892b0;margin-bottom:20px">Bobby: Click record and describe this project in your own words.</p>
            
            <div class="voice-section">
              <button type="button" id="voiceBtn" class="btn btn-voice" onclick="toggleVoice()">🎤 Click to Record</button>
              <p id="voiceStatus" style="color:#8892b0;margin-top:10px">Press and talk naturally</p>
            </div>
            
            <div class="form-group">
              <label>Voice Transcript / Notes</label>
              <textarea name="voiceTranscript" id="voiceTranscript">${data.voiceTranscript || ''}</textarea>
            </div>
          </div>

          <div class="card">
            <h2>📝 Generated Descriptions</h2>
            <div class="form-group">
              <label>Brief Description</label>
              <textarea name="briefDescription">${data.briefDescription || ''}</textarea>
            </div>
            <div class="form-group">
              <label>Detailed Description (for Hawaii form)</label>
              <textarea name="detailedDescription" rows="6">${data.detailedDescription || ''}</textarea>
            </div>
            <button type="button" class="btn btn-secondary" onclick="generateDesc()">🤖 Generate Descriptions</button>
          </div>

          <div class="card">
            <div class="form-group">
              <label>Status</label>
              <select name="status">
                <option value="draft" ${data.status === 'draft' ? 'selected' : ''}>Draft</option>
                <option value="complete" ${data.status === 'complete' ? 'selected' : ''}>Complete</option>
              </select>
            </div>
            <button type="submit" class="btn btn-primary">${isEdit ? '💾 Save' : '➕ Add Project'}</button>
            <a href="/license" class="btn btn-secondary">Cancel</a>
          </div>
        </form>
      </div>

      <script>
        let recognition, isRecording = false;
        if ('webkitSpeechRecognition' in window) {
          recognition = new webkitSpeechRecognition();
          recognition.continuous = true;
          recognition.interimResults = true;
          recognition.onresult = function(e) {
            let t = '';
            for (let i = 0; i < e.results.length; i++) t += e.results[i][0].transcript;
            document.getElementById('voiceTranscript').value = t;
          };
        }
        function toggleVoice() {
          if (!recognition) { alert('Voice not supported. Use Chrome.'); return; }
          if (isRecording) {
            recognition.stop();
            isRecording = false;
            document.getElementById('voiceBtn').classList.remove('recording');
            document.getElementById('voiceBtn').innerHTML = '🎤 Click to Record';
            document.getElementById('voiceStatus').textContent = 'Recording saved!';
          } else {
            recognition.start();
            isRecording = true;
            document.getElementById('voiceBtn').classList.add('recording');
            document.getElementById('voiceBtn').innerHTML = '⏹️ Stop';
            document.getElementById('voiceStatus').textContent = '🔴 Recording...';
          }
        }
        function generateDesc() {
          const form = document.querySelector('form');
          const fd = new FormData(form);
          const scope = Array.from(document.querySelectorAll('input[name="scopeItems"]:checked')).map(c => c.value);
          let brief = 'Directly supervised: ' + fd.get('workersSupervised') + ' worker(s)\\n';
          scope.forEach(s => brief += s + '\\n');
          document.querySelector('[name="briefDescription"]').value = brief;
          
          let det = 'I directly supervised my crew during this ' + (fd.get('projectType') || 'project');
          if (fd.get('squareFootage')) det += ' (' + fd.get('squareFootage') + 'SF)';
          if (fd.get('location')) det += ' in ' + fd.get('location');
          det += '. I managed the entire electrical scope including ' + scope.slice(0,5).join(', ').toLowerCase() + '.';
          det += ' I oversaw ' + fd.get('workersSupervised') + ' worker(s) throughout.';
          const voice = document.getElementById('voiceTranscript').value;
          if (voice) det += ' ' + voice;
          det += ' All work completed to code with accurate panel labeling at final inspection.';
          document.querySelector('[name="detailedDescription"]').value = det;
        }
      </script>
    </body>
    </html>
  `);
}

/**
 * Create project
 */
router.post('/create', async (req, res) => {
  try {
    const scopeItems = Array.isArray(req.body.scopeItems) ? req.body.scopeItems : (req.body.scopeItems ? [req.body.scopeItems] : []);
    await licenseService.addProject({
      projectName: req.body.projectName,
      location: req.body.location,
      employer: req.body.employer,
      projectType: req.body.projectType,
      startDate: req.body.startDate,
      endDate: req.body.endDate || null,
      contractAmount: req.body.contractAmount,
      squareFootage: req.body.squareFootage,
      workersSupervised: req.body.workersSupervised,
      experienceMonths: req.body.experienceMonths,
      scopeItems,
      voiceTranscript: req.body.voiceTranscript,
      briefDescription: req.body.briefDescription,
      detailedDescription: req.body.detailedDescription,
      status: req.body.status || 'draft'
    });
    res.redirect('/license');
  } catch (error) {
    res.redirect('/license?error=' + error.message);
  }
});

/**
 * Update project
 */
router.post('/update/:id', async (req, res) => {
  try {
    const scopeItems = Array.isArray(req.body.scopeItems) ? req.body.scopeItems : (req.body.scopeItems ? [req.body.scopeItems] : []);
    await licenseService.updateProject(req.params.id, {
      projectName: req.body.projectName,
      location: req.body.location,
      employer: req.body.employer,
      projectType: req.body.projectType,
      startDate: req.body.startDate,
      endDate: req.body.endDate || null,
      contractAmount: req.body.contractAmount,
      squareFootage: req.body.squareFootage,
      workersSupervised: req.body.workersSupervised,
      experienceMonths: req.body.experienceMonths,
      scopeItems,
      voiceTranscript: req.body.voiceTranscript,
      briefDescription: req.body.briefDescription,
      detailedDescription: req.body.detailedDescription,
      status: req.body.status || 'draft'
    });
    res.redirect('/license');
  } catch (error) {
    res.redirect('/license?error=' + error.message);
  }
});

/**
 * Delete project
 */
router.post('/delete/:id', async (req, res) => {
  try {
    await licenseService.deleteProject(req.params.id);
    res.redirect('/license');
  } catch (error) {
    res.redirect('/license?error=' + error.message);
  }
});

/**
 * Export CSV
 */
router.get('/export', (req, res) => {
  const projects = licenseService.getAllProjects();
  const csv = exporter.generateCSV(projects);
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=bobby-projects.csv');
  res.send(csv);
});

/**
 * Preview
 */
router.get('/preview', (req, res) => {
  const projects = licenseService.getAllProjects();
  const stats = licenseService.getStats();
  const table = exporter.generateHTMLTable(projects);
  
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Preview | License Helper</title>
      <style>
        body { font-family: Arial, sans-serif; padding: 20px; }
        table { border-collapse: collapse; width: 100%; font-size: 11px; }
        th, td { border: 1px solid #ccc; padding: 8px; text-align: left; }
        th { background: #1a1a2e; color: white; }
        .btn { padding: 10px 20px; background: #1a1a2e; color: white; text-decoration: none; border-radius: 5px; margin-right: 10px; }
        @media print { .no-print { display: none; } }
      </style>
    </head>
    <body>
      <div class="no-print">
        <h1>CHRONOLOGICAL HISTORY OF PROJECTS COMPLETED</h1>
        <p><strong>ENTITY:</strong> RLT SYSTEMS | <strong>RME:</strong> ROBERT LEWIS TURNER</p>
        <p>${stats.total} projects • ${stats.totalYears} years • $${stats.totalValue.toLocaleString()} total</p>
        <p>
          <a href="/license" class="btn">← Back</a>
          <a href="/license/export" class="btn">📥 CSV</a>
          <button onclick="window.print()" class="btn">🖨️ Print</button>
        </p>
      </div>
      ${table}
    </body>
    </html>
  `);
});

module.exports = router;
