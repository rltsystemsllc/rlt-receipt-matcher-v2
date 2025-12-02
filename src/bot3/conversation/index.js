/**
 * Bot 3 - Conversation State Management
 * Manages SMS conversation flows for inventory pulls
 */

const fs = require('fs').promises;
const config = require('../../config');
const logger = require('../../utils/logger');

// In-memory conversation store
const conversations = new Map();

// Conversation steps
const STEPS = {
  SELECT_JOB: 'select_job',
  SELECT_JOB_FROM_LIST: 'select_job_from_list',
  ENTER_CONTRACTOR: 'enter_contractor',
  ENTER_PROJECT: 'enter_project',
  SELECT_LOCATION: 'select_location',
  ENTER_MATERIALS: 'enter_materials',
  CONFIRM: 'confirm',
  COMPLETE: 'complete'
};

/**
 * Load saved conversation state from disk
 */
async function loadState() {
  try {
    const data = await fs.readFile(config.inventory.statePath, 'utf8');
    const saved = JSON.parse(data);
    
    // Restore conversations that haven't timed out
    const now = Date.now();
    for (const [phone, conv] of Object.entries(saved.conversations || {})) {
      if (now - conv.lastActivity < config.inventory.conversationTimeout) {
        conversations.set(phone, conv);
      }
    }
    
    logger.info('Bot 3: Loaded conversation state', { 
      activeConversations: conversations.size 
    });
  } catch (error) {
    // File doesn't exist or is invalid - start fresh
    logger.info('Bot 3: Starting with fresh conversation state');
  }
}

/**
 * Save conversation state to disk
 */
async function saveState() {
  try {
    const state = {
      conversations: Object.fromEntries(conversations),
      savedAt: new Date().toISOString()
    };
    
    // Ensure directory exists
    const dir = require('path').dirname(config.inventory.statePath);
    await fs.mkdir(dir, { recursive: true });
    
    await fs.writeFile(config.inventory.statePath, JSON.stringify(state, null, 2));
  } catch (error) {
    logger.error('Bot 3: Failed to save state', { error: error.message });
  }
}

/**
 * Start a new conversation
 */
async function startConversation(phoneNumber) {
  // Get last job from previous conversations (if any)
  const previousConv = conversations.get(phoneNumber);
  const lastJobName = previousConv?.jobName || null;
  
  const conversation = {
    phoneNumber,
    step: STEPS.SELECT_JOB,
    startedAt: Date.now(),
    lastActivity: Date.now(),
    lastJobName,
    jobName: null,
    contractorName: null,
    projectName: null,
    pulledFrom: null,
    rawDescription: null,
    parsedMaterials: null,
    humanSummary: null,
    recentJobs: []
  };
  
  conversations.set(phoneNumber, conversation);
  await saveState();
  
  logger.info('Bot 3: Started new conversation', { phoneNumber });
  
  return conversation;
}

/**
 * Get existing conversation
 */
function getConversation(phoneNumber) {
  const conversation = conversations.get(phoneNumber);
  
  if (!conversation) {
    return null;
  }
  
  // Check for timeout
  const now = Date.now();
  if (now - conversation.lastActivity > config.inventory.conversationTimeout) {
    logger.info('Bot 3: Conversation timed out', { phoneNumber });
    conversations.delete(phoneNumber);
    return null;
  }
  
  return conversation;
}

/**
 * Update conversation state
 */
async function updateConversation(phoneNumber, updates) {
  const conversation = conversations.get(phoneNumber);
  
  if (!conversation) {
    logger.warn('Bot 3: Tried to update non-existent conversation', { phoneNumber });
    return null;
  }
  
  Object.assign(conversation, updates, {
    lastActivity: Date.now()
  });
  
  conversations.set(phoneNumber, conversation);
  await saveState();
  
  logger.debug('Bot 3: Updated conversation', { 
    phoneNumber, 
    step: conversation.step 
  });
  
  return conversation;
}

/**
 * End a conversation
 */
async function endConversation(phoneNumber) {
  const conversation = conversations.get(phoneNumber);
  
  if (conversation) {
    // Keep the lastJobName for next time
    const lastJobName = conversation.jobName;
    
    // Mark as complete but keep in memory briefly
    conversation.step = STEPS.COMPLETE;
    conversation.completedAt = Date.now();
    
    // Store last job for next conversation
    if (lastJobName) {
      conversations.set(phoneNumber, {
        ...conversation,
        lastJobName
      });
    }
    
    await saveState();
    
    logger.info('Bot 3: Ended conversation', { phoneNumber, jobName: lastJobName });
  }
  
  return conversation;
}

/**
 * Get count of active conversations
 */
function getActiveConversationCount() {
  const now = Date.now();
  let count = 0;
  
  for (const conv of conversations.values()) {
    if (conv.step !== STEPS.COMPLETE && 
        now - conv.lastActivity < config.inventory.conversationTimeout) {
      count++;
    }
  }
  
  return count;
}

/**
 * Get all active conversations (for dashboard)
 */
function getAllConversations() {
  const now = Date.now();
  const active = [];
  
  for (const [phone, conv] of conversations) {
    if (conv.step !== STEPS.COMPLETE && 
        now - conv.lastActivity < config.inventory.conversationTimeout) {
      active.push({
        phoneNumber: phone,
        step: conv.step,
        jobName: conv.jobName,
        startedAt: new Date(conv.startedAt).toISOString(),
        lastActivity: new Date(conv.lastActivity).toISOString()
      });
    }
  }
  
  return active;
}

/**
 * Clean up old/expired conversations
 */
async function cleanup() {
  const now = Date.now();
  let cleaned = 0;
  
  for (const [phone, conv] of conversations) {
    // Remove completed conversations older than 5 minutes
    if (conv.step === STEPS.COMPLETE && 
        now - conv.completedAt > 5 * 60 * 1000) {
      conversations.delete(phone);
      cleaned++;
    }
    // Remove timed out conversations
    else if (now - conv.lastActivity > config.inventory.conversationTimeout) {
      conversations.delete(phone);
      cleaned++;
    }
  }
  
  if (cleaned > 0) {
    await saveState();
    logger.info('Bot 3: Cleaned up conversations', { count: cleaned });
  }
}

// Initialize on load
loadState().catch(err => {
  logger.error('Bot 3: Failed to load initial state', { error: err.message });
});

// Periodic cleanup
setInterval(cleanup, 5 * 60 * 1000); // Every 5 minutes

module.exports = {
  STEPS,
  startConversation,
  getConversation,
  updateConversation,
  endConversation,
  getActiveConversationCount,
  getAllConversations,
  cleanup
};




