/**
 * License Helper Tool
 * Helps Bobby create the project listing for Hawaii contractor license
 * 
 * Features:
 * - Upload/scan invoices
 * - AI extracts data from invoices
 * - Voice recording for project descriptions
 * - AI generates professional narratives
 * - Export to Hawaii's exact Excel format
 */

const fs = require('fs').promises;
const path = require('path');
const logger = require('../utils/logger');

// Storage file for projects
const STORAGE_FILE = './data/license-projects.json';
const UPLOADS_DIR = './data/license-invoices';

// In-memory state
let projects = [];

/**
 * Initialize - load existing projects
 */
async function initialize() {
  try {
    // Ensure directories exist
    await fs.mkdir(path.dirname(STORAGE_FILE), { recursive: true });
    await fs.mkdir(UPLOADS_DIR, { recursive: true });

    const data = await fs.readFile(STORAGE_FILE, 'utf8');
    projects = JSON.parse(data);
    logger.info('License projects loaded', { count: projects.length });
  } catch (error) {
    logger.info('No existing license projects, starting fresh');
    projects = [];
    await saveProjects();
  }
}

/**
 * Save projects to file
 */
async function saveProjects() {
  try {
    await fs.mkdir(path.dirname(STORAGE_FILE), { recursive: true });
    await fs.writeFile(STORAGE_FILE, JSON.stringify(projects, null, 2));
  } catch (error) {
    logger.error('Failed to save license projects', { error: error.message });
  }
}

/**
 * Add a new project
 */
async function addProject(projectData) {
  const project = {
    id: Date.now().toString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: 'draft', // draft, complete
    ...projectData
  };

  projects.push(project);
  await saveProjects();
  
  logger.info('License project added', { id: project.id, name: project.projectName });
  return project;
}

/**
 * Update a project
 */
async function updateProject(id, updates) {
  const index = projects.findIndex(p => p.id === id);
  if (index === -1) {
    throw new Error('Project not found');
  }

  projects[index] = {
    ...projects[index],
    ...updates,
    updatedAt: new Date().toISOString()
  };

  await saveProjects();
  return projects[index];
}

/**
 * Delete a project
 */
async function deleteProject(id) {
  const index = projects.findIndex(p => p.id === id);
  if (index === -1) {
    throw new Error('Project not found');
  }

  projects.splice(index, 1);
  await saveProjects();
}

/**
 * Get all projects
 */
function getAllProjects() {
  return projects.sort((a, b) => {
    // Sort by start date descending
    const dateA = a.startDate ? new Date(a.startDate) : new Date(0);
    const dateB = b.startDate ? new Date(b.startDate) : new Date(0);
    return dateB - dateA;
  });
}

/**
 * Get project by ID
 */
function getProject(id) {
  return projects.find(p => p.id === id);
}

/**
 * Get project statistics
 */
function getStats() {
  const total = projects.length;
  const complete = projects.filter(p => p.status === 'complete').length;
  const draft = total - complete;
  
  // Calculate total months of experience
  const totalMonths = projects.reduce((sum, p) => {
    return sum + (parseFloat(p.experienceMonths) || 0);
  }, 0);

  // Calculate total contract value
  const totalValue = projects.reduce((sum, p) => {
    const amount = parseFloat(String(p.contractAmount).replace(/[$,]/g, '')) || 0;
    return sum + amount;
  }, 0);

  return {
    total,
    complete,
    draft,
    totalMonths,
    totalYears: (totalMonths / 12).toFixed(1),
    totalValue
  };
}

/**
 * Employers list
 */
const EMPLOYERS = [
  'RLT Systems',
  'AC/DC Electric LLC',
  'Wagner Electric'
];

/**
 * Project types
 */
const PROJECT_TYPES = [
  'New Build - Residential',
  'New Build - Commercial',
  'Renovation - Residential',
  'Renovation - Commercial',
  'Service Call',
  'Panel Upgrade'
];

/**
 * Scope items (checkboxes)
 */
const SCOPE_ITEMS = [
  'Underground Conduit / Groundwork',
  'Service / Panel Installation',
  'Rough-In Wiring',
  'Finish Trim',
  'Pool / Spa Electrical',
  'A/C Wiring & Disconnects',
  'Audio/Video / Smart Home',
  'LED Tape Lighting',
  'Low Voltage / Data / Security',
  'Fire Suppression',
  'EV Charging',
  'Generator / Transfer Switch',
  'Appliance Wiring',
  'Lighting Layout & Install',
  'Receptacles & Switches',
  'Commercial / Tenant Improvements'
];

// Initialize on module load
initialize().catch(err => logger.error('Failed to initialize license tool', { error: err.message }));

module.exports = {
  addProject,
  updateProject,
  deleteProject,
  getAllProjects,
  getProject,
  getStats,
  saveProjects,
  EMPLOYERS,
  PROJECT_TYPES,
  SCOPE_ITEMS,
  UPLOADS_DIR
};

