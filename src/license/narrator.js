/**
 * AI Narrative Generator for License Projects
 * Takes Bobby's voice notes or form data and generates professional descriptions
 */

const logger = require('../utils/logger');

/**
 * Generate a professional narrative from project data
 * This creates the "Detailed Description" that Hawaii requires
 */
function generateNarrative(project) {
  const {
    projectType,
    squareFootage,
    location,
    scopeItems = [],
    workersSupervised,
    briefNotes,
    voiceTranscript
  } = project;

  // Combine voice transcript and brief notes
  const rawInput = [voiceTranscript, briefNotes].filter(Boolean).join(' ');
  
  // Build the narrative based on project type and scope
  let narrative = '';
  
  // Opening sentence based on project type
  if (projectType?.includes('New Build')) {
    narrative = `I directly supervised my crew during this new ${projectType.includes('Commercial') ? 'commercial' : 'custom'} `;
    if (squareFootage) {
      narrative += `${squareFootage}SF `;
    }
    narrative += `${projectType.includes('Commercial') ? 'building' : 'home'} build`;
    if (location) {
      narrative += ` in ${location}`;
    }
    narrative += '. ';
  } else if (projectType?.includes('Renovation')) {
    narrative = `I directly supervised my crew during this ${projectType.includes('Commercial') ? 'commercial' : 'residential'} renovation`;
    if (squareFootage) {
      narrative += ` of a ${squareFootage}SF `;
      narrative += projectType.includes('Commercial') ? 'space' : 'home';
    }
    if (location) {
      narrative += ` in ${location}`;
    }
    narrative += '. ';
  } else if (projectType?.includes('Panel')) {
    narrative = `I directly supervised my crew during this panel upgrade`;
    if (location) {
      narrative += ` in ${location}`;
    }
    narrative += '. ';
  } else if (projectType?.includes('Service')) {
    narrative = `I directly supervised my crew during this service call`;
    if (location) {
      narrative += ` in ${location}`;
    }
    narrative += '. ';
  } else {
    narrative = `I directly supervised my crew on this electrical project`;
    if (location) {
      narrative += ` in ${location}`;
    }
    narrative += '. ';
  }

  // Add scope details
  if (scopeItems.length > 0) {
    narrative += 'I managed the entire electrical scope ';
    
    // Group scope items into phases
    const groundwork = scopeItems.filter(s => 
      s.includes('Underground') || s.includes('Groundwork')
    );
    const panels = scopeItems.filter(s => 
      s.includes('Panel') || s.includes('Service')
    );
    const roughIn = scopeItems.filter(s => 
      s.includes('Rough-In')
    );
    const finish = scopeItems.filter(s => 
      s.includes('Finish') || s.includes('Lighting') || s.includes('Receptacle')
    );
    const specialty = scopeItems.filter(s => 
      s.includes('Pool') || s.includes('A/C') || s.includes('Audio') || 
      s.includes('LED') || s.includes('Generator') || s.includes('EV')
    );
    const lowVoltage = scopeItems.filter(s => 
      s.includes('Low Voltage') || s.includes('Data') || s.includes('Security') ||
      s.includes('Fire')
    );

    const phases = [];
    
    if (groundwork.length > 0) {
      phases.push('trenching and installation of underground conduit');
    }
    if (panels.length > 0) {
      phases.push('service and panel installation with accurate labeling');
    }
    if (roughIn.length > 0) {
      phases.push('rough-in wiring throughout');
    }
    if (finish.length > 0) {
      phases.push('finish trim including all lighting, receptacles, and switches');
    }
    if (specialty.length > 0) {
      const specialtyDesc = [];
      if (scopeItems.some(s => s.includes('Pool'))) specialtyDesc.push('pool/spa equipment');
      if (scopeItems.some(s => s.includes('A/C'))) specialtyDesc.push('A/C systems and disconnects');
      if (scopeItems.some(s => s.includes('Audio'))) specialtyDesc.push('audio/video smart home systems');
      if (scopeItems.some(s => s.includes('LED'))) specialtyDesc.push('LED tape lighting');
      if (scopeItems.some(s => s.includes('Generator'))) specialtyDesc.push('generator and transfer switch');
      if (scopeItems.some(s => s.includes('EV'))) specialtyDesc.push('EV charging installation');
      phases.push(specialtyDesc.join(', '));
    }
    if (lowVoltage.length > 0) {
      phases.push('low voltage wiring for data/security/communications');
    }

    if (phases.length > 0) {
      narrative += 'including ' + phases.join(', ') + '. ';
    }
  }

  // Add supervision details
  if (workersSupervised && parseInt(workersSupervised) > 0) {
    narrative += `I was onsite to oversee and direct ${workersSupervised} worker${parseInt(workersSupervised) > 1 ? 's' : ''} throughout the project. `;
  }

  // Add any raw notes/voice content (cleaned up)
  if (rawInput && rawInput.length > 20) {
    // Extract key phrases from voice/notes
    const additionalDetails = extractKeyDetails(rawInput);
    if (additionalDetails) {
      narrative += additionalDetails + ' ';
    }
  }

  // Closing
  narrative += 'I ensured all work was completed to code and oversaw accurate labeling of all panels at final inspection.';

  return narrative.trim();
}

/**
 * Generate brief description (bullet points)
 */
function generateBriefDescription(project) {
  const { scopeItems = [], projectType } = project;
  
  const bullets = [];
  
  // Add supervision line
  if (project.workersSupervised) {
    bullets.push(`Directly supervised: ${project.workersSupervised} worker(s)`);
  }

  // Add scope bullets
  if (scopeItems.includes('Underground Conduit / Groundwork')) {
    bullets.push('Install underground conduit');
  }
  if (scopeItems.includes('Service / Panel Installation')) {
    bullets.push('Install service/panel');
  }
  if (scopeItems.includes('Rough-In Wiring')) {
    bullets.push('Rough in wiring');
  }
  if (scopeItems.includes('Finish Trim')) {
    bullets.push('Finish trim');
  }
  if (scopeItems.some(s => s.includes('Lighting') || s.includes('Receptacle'))) {
    bullets.push('Install devices, light fixtures');
  }
  if (scopeItems.includes('Pool / Spa Electrical')) {
    bullets.push('Pool/spa electrical');
  }
  if (scopeItems.includes('A/C Wiring & Disconnects')) {
    bullets.push('A/C wiring and disconnects');
  }
  if (scopeItems.includes('Audio/Video / Smart Home')) {
    bullets.push('Audio/video smart home setup');
  }
  if (scopeItems.includes('Generator / Transfer Switch')) {
    bullets.push('Generator and transfer switch');
  }
  if (scopeItems.includes('Appliance Wiring')) {
    bullets.push('Appliance connections');
  }

  return bullets.join('\n');
}

/**
 * Extract key details from voice transcript or notes
 */
function extractKeyDetails(text) {
  if (!text) return '';
  
  // Clean up the text
  let cleaned = text
    .replace(/\s+/g, ' ')
    .trim();
  
  // Look for specific measurements or details
  const details = [];
  
  // Square footage mentions
  const sqftMatch = cleaned.match(/(\d{1,2},?\d{3})\s*(sf|square feet|sq ft)/i);
  if (sqftMatch) {
    details.push(`${sqftMatch[1]}SF`);
  }
  
  // Amp service mentions
  const ampMatch = cleaned.match(/(\d{3})\s*[aA]mp/);
  if (ampMatch) {
    details.push(`${ampMatch[1]}A service`);
  }
  
  // Phase mentions
  const phaseMatch = cleaned.match(/(3|three)\s*phase/i);
  if (phaseMatch) {
    details.push('3-phase');
  }

  // If we found specific details, format them
  if (details.length > 0) {
    return `This project included ${details.join(', ')}.`;
  }

  return '';
}

/**
 * Generate position title based on workers supervised
 */
function generatePositionTitle(workersSupervised) {
  const count = parseInt(workersSupervised) || 1;
  return `Supervisor ${count} worker${count > 1 ? 's' : ''}`;
}

module.exports = {
  generateNarrative,
  generateBriefDescription,
  generatePositionTitle
};

