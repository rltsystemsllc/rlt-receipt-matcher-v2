/**
 * Bot 3 - Inventory Bot
 * Main entry point for the inventory tracking bot
 * 
 * Workflow:
 * 1. Receives inbound RingCentral group-text messages (via webhook or NFC/QR trigger)
 * 2. Guides Bobby through material logging before installation
 * 3. Writes material pulls to a Google Sheet (Inventory Pull Log)
 * 4. Links inventory pulled to job records for billing
 * 5. Feeds Bot 2 when urgent billing is triggered
 */

const config = require('../config');
const logger = require('../utils/logger');
const conversationService = require('./conversation');
const sheetsService = require('./sheets');
const ringcentralService = require('../bot2/ringcentral');

let isProcessing = false;

/**
 * Handle incoming SMS message
 * This is the main entry point for Bot 3
 */
async function handleIncomingSms(from, message) {
  if (isProcessing) {
    logger.info('Bot 3: Already processing a message, queuing...');
  }

  isProcessing = true;
  
  try {
    logger.info('Bot 3: Received SMS', { from, message: message.substring(0, 50) });

    // Check if this is a trigger phrase to start a new conversation
    const normalizedMessage = message.trim().toLowerCase();
    const isInventoryTrigger = config.inventory.triggerPhrases.some(
      phrase => normalizedMessage === phrase || normalizedMessage.startsWith(phrase + ' ')
    );

    // Get or create conversation state for this sender
    let conversation = conversationService.getConversation(from);

    if (isInventoryTrigger && (!conversation || conversation.step === 'complete')) {
      // Start new inventory flow
      conversation = await conversationService.startConversation(from);
      await sendJobSelectionPrompt(from, conversation);
      return;
    }

    if (!conversation || conversation.step === 'complete') {
      // No active conversation and not a trigger - ignore or respond with help
      logger.info('Bot 3: No active conversation for sender', { from });
      return;
    }

    // Route to appropriate handler based on conversation step
    await handleConversationStep(from, message, conversation);

  } catch (error) {
    logger.error('Bot 3: Error handling SMS', { error: error.message, from });
    
    try {
      await ringcentralService.sendToNumber(from,
        `⚠️ Sorry, something went wrong. Please try again or text "inventory" to start over.`
      );
    } catch (smsError) {
      logger.error('Bot 3: Failed to send error message', { error: smsError.message });
    }
  } finally {
    isProcessing = false;
  }
}

/**
 * Route conversation to appropriate step handler
 */
async function handleConversationStep(from, message, conversation) {
  const step = conversation.step;

  switch (step) {
    case 'select_job':
      await handleJobSelection(from, message, conversation);
      break;

    case 'enter_contractor':
      await handleContractorEntry(from, message, conversation);
      break;

    case 'enter_project':
      await handleProjectEntry(from, message, conversation);
      break;

    case 'select_location':
      await handleLocationSelection(from, message, conversation);
      break;

    case 'enter_materials':
      await handleMaterialsEntry(from, message, conversation);
      break;

    case 'confirm':
      await handleConfirmation(from, message, conversation);
      break;

    default:
      logger.warn('Bot 3: Unknown conversation step', { step });
      await conversationService.endConversation(from);
  }
}

/**
 * Send job selection prompt
 */
async function sendJobSelectionPrompt(from, conversation) {
  try {
    // Get recent jobs from the sheet
    const recentJobs = await sheetsService.getRecentJobs(5);
    const lastJob = conversation.lastJobName || recentJobs[0];

    let message = `📦 *Inventory Bot*\n\nWhat job are you pulling materials for?\n\n`;
    
    if (lastJob) {
      message += `1️⃣ Last active job: "${lastJob}"\n`;
    }
    
    message += `2️⃣ Select from recent jobs\n`;
    message += `3️⃣ NEW PROJECT — enter contractor + project name\n\n`;
    message += `Reply with 1, 2, or 3`;

    // Store recent jobs in conversation for later use
    await conversationService.updateConversation(from, {
      recentJobs,
      lastJobName: lastJob
    });

    await ringcentralService.sendToNumber(from, message);
    
  } catch (error) {
    logger.error('Bot 3: Failed to send job selection prompt', { error: error.message });
    throw error;
  }
}

/**
 * Handle job selection response
 */
async function handleJobSelection(from, message, conversation) {
  const choice = message.trim();

  if (choice === '1' && conversation.lastJobName) {
    // Use last active job
    await conversationService.updateConversation(from, {
      step: 'select_location',
      jobName: conversation.lastJobName
    });
    await sendLocationPrompt(from);
    
  } else if (choice === '2') {
    // Show list of recent jobs
    const jobs = conversation.recentJobs || [];
    
    if (jobs.length === 0) {
      await ringcentralService.sendToNumber(from,
        `No recent jobs found. Reply 3 to enter a new project.`
      );
      return;
    }

    let message = `📋 Select a job:\n\n`;
    jobs.forEach((job, i) => {
      message += `${i + 1}. ${job}\n`;
    });
    message += `\nReply with the number.`;

    await conversationService.updateConversation(from, {
      step: 'select_job_from_list'
    });
    await ringcentralService.sendToNumber(from, message);

  } else if (choice === '3') {
    // New project - ask for contractor name
    await conversationService.updateConversation(from, {
      step: 'enter_contractor'
    });
    await ringcentralService.sendToNumber(from,
      `👤 Enter the Contractor/Customer Name:`
    );

  } else if (/^\d+$/.test(choice) && conversation.step === 'select_job_from_list') {
    // Number selection from recent jobs list
    const index = parseInt(choice) - 1;
    const jobs = conversation.recentJobs || [];
    
    if (index >= 0 && index < jobs.length) {
      await conversationService.updateConversation(from, {
        step: 'select_location',
        jobName: jobs[index]
      });
      await sendLocationPrompt(from);
    } else {
      await ringcentralService.sendToNumber(from,
        `❌ Invalid selection. Please enter a number between 1 and ${jobs.length}.`
      );
    }

  } else if (conversation.step === 'select_job_from_list') {
    // Invalid input when expecting number
    await ringcentralService.sendToNumber(from,
      `❌ Please reply with a number to select a job.`
    );
  } else {
    // Treat as direct job name entry
    await conversationService.updateConversation(from, {
      step: 'select_location',
      jobName: choice
    });
    await sendLocationPrompt(from);
  }
}

/**
 * Handle contractor name entry
 */
async function handleContractorEntry(from, message, conversation) {
  const contractorName = message.trim();
  
  if (!contractorName) {
    await ringcentralService.sendToNumber(from,
      `❌ Please enter a contractor/customer name.`
    );
    return;
  }

  await conversationService.updateConversation(from, {
    step: 'enter_project',
    contractorName
  });

  await ringcentralService.sendToNumber(from,
    `📝 Enter the Project Name:`
  );
}

/**
 * Handle project name entry
 */
async function handleProjectEntry(from, message, conversation) {
  const projectName = message.trim();
  
  if (!projectName) {
    await ringcentralService.sendToNumber(from,
      `❌ Please enter a project name.`
    );
    return;
  }

  const jobName = `${conversation.contractorName} - ${projectName}`;

  await conversationService.updateConversation(from, {
    step: 'select_location',
    projectName,
    jobName
  });

  await sendLocationPrompt(from);
}

/**
 * Send location selection prompt
 */
async function sendLocationPrompt(from) {
  const message = `📍 Where are you pulling from?\n\n` +
    `1️⃣ Container\n` +
    `2️⃣ Truck Stock\n` +
    `3️⃣ Both`;

  await ringcentralService.sendToNumber(from, message);
}

/**
 * Handle location selection
 */
async function handleLocationSelection(from, message, conversation) {
  const choice = message.trim().toLowerCase();
  
  let pulledFrom;
  
  if (choice === '1' || choice === 'container') {
    pulledFrom = config.inventory.pullLocations.container;
  } else if (choice === '2' || choice === 'truck' || choice === 'truck stock') {
    pulledFrom = config.inventory.pullLocations.truck;
  } else if (choice === '3' || choice === 'both') {
    pulledFrom = config.inventory.pullLocations.both;
  } else {
    await ringcentralService.sendToNumber(from,
      `❌ Please reply with 1 (Container), 2 (Truck), or 3 (Both).`
    );
    return;
  }

  await conversationService.updateConversation(from, {
    step: 'enter_materials',
    pulledFrom
  });

  await ringcentralService.sendToNumber(from,
    `📦 What materials are you pulling?\n\n` +
    `You can type or voice dictate:\n` +
    `"1 roll 12/2, 4 boxes, 2 dimmers..."`
  );
}

/**
 * Handle materials entry
 */
async function handleMaterialsEntry(from, message, conversation) {
  const rawDescription = message.trim();
  
  if (!rawDescription || rawDescription.length < 2) {
    await ringcentralService.sendToNumber(from,
      `❌ I didn't catch that. What materials did you pull?`
    );
    return;
  }

  // Parse the materials
  const materialsParser = require('./materials-parser');
  const parsed = materialsParser.parse(rawDescription);
  
  if (parsed.items.length === 0) {
    await ringcentralService.sendToNumber(from,
      `❌ Couldn't parse materials. Please try again with format like:\n` +
      `"1 roll 12/2, 4 boxes, 2 dimmers"`
    );
    return;
  }

  // Generate human-readable summary
  const humanSummary = materialsParser.formatSummary(parsed.items);

  await conversationService.updateConversation(from, {
    step: 'confirm',
    rawDescription,
    parsedMaterials: parsed.items,
    humanSummary
  });

  // Get updated conversation
  const updatedConversation = conversationService.getConversation(from);

  // Send confirmation
  let confirmMessage = `✅ Logging these materials for ${updatedConversation.jobName}:\n\n`;
  parsed.items.forEach(item => {
    const unitStr = item.unit ? ` ${item.unit}` : '';
    confirmMessage += `• ${item.quantity}${unitStr} — ${item.name}\n`;
  });
  confirmMessage += `\nFrom: ${updatedConversation.pulledFrom}\n\n`;
  confirmMessage += `Reply SAVE to confirm, or EDIT to re-enter materials.`;

  await ringcentralService.sendToNumber(from, confirmMessage);
}

/**
 * Handle confirmation
 */
async function handleConfirmation(from, message, conversation) {
  const response = message.trim().toLowerCase();

  if (response === 'save' || response === 'yes' || response === 'confirm' || response === 'y') {
    try {
      // Save to Inventory Pull Log
      const result = await sheetsService.logInventoryPull({
        jobName: conversation.jobName,
        contractorName: conversation.contractorName || '',
        projectName: conversation.projectName || '',
        pulledFrom: conversation.pulledFrom,
        rawDescription: conversation.rawDescription,
        parsedMaterials: conversation.parsedMaterials,
        humanSummary: conversation.humanSummary
      });

      // Also update Bobby's daily submission sheet if configured
      if (conversation.jobName) {
        await sheetsService.appendToDailySheet(
          conversation.jobName,
          conversation.humanSummary,
          conversation.pulledFrom
        );
      }

      // End conversation
      await conversationService.endConversation(from);

      // Send success message
      await ringcentralService.sendToNumber(from,
        `✅ Saved!\n\n` +
        `Job: ${conversation.jobName}\n` +
        `Materials: ${conversation.humanSummary}\n\n` +
        `Unbilled ✔\n` +
        `Ready for Bot 2 when billing is marked urgent.`
      );

      logger.info('Bot 3: Inventory logged successfully', {
        jobName: conversation.jobName,
        itemCount: conversation.parsedMaterials.length
      });

    } catch (error) {
      logger.error('Bot 3: Failed to save inventory', { error: error.message });
      await ringcentralService.sendToNumber(from,
        `❌ Failed to save: ${error.message}\n\nPlease try again.`
      );
    }

  } else if (response === 'edit' || response === 'redo' || response === 'no' || response === 'n') {
    // Go back to materials entry
    await conversationService.updateConversation(from, {
      step: 'enter_materials',
      rawDescription: null,
      parsedMaterials: null,
      humanSummary: null
    });

    await ringcentralService.sendToNumber(from,
      `📦 What materials are you pulling?\n\n` +
      `You can type or voice dictate:\n` +
      `"1 roll 12/2, 4 boxes, 2 dimmers..."`
    );

  } else if (response === 'cancel' || response === 'quit' || response === 'exit') {
    await conversationService.endConversation(from);
    await ringcentralService.sendToNumber(from,
      `❌ Inventory pull cancelled. Text "inventory" to start over.`
    );

  } else {
    await ringcentralService.sendToNumber(from,
      `Reply SAVE to confirm, EDIT to change materials, or CANCEL to quit.`
    );
  }
}

/**
 * Get inventory pulls for a job (used by Bot 2)
 */
async function getInventoryForJob(jobName) {
  return await sheetsService.getUnbilledInventoryForJob(jobName);
}

/**
 * Mark inventory as billed (called by Bot 2 after invoice approval)
 */
async function markInventoryBilled(jobName, invoiceNumber) {
  return await sheetsService.markAsBilled(jobName, invoiceNumber);
}

/**
 * Get Bot 3 status
 */
function getStatus() {
  return {
    isProcessing,
    activeConversations: conversationService.getActiveConversationCount(),
    config: {
      inventorySheetName: config.inventory.inventorySheetName,
      spreadsheetId: config.sheets.spreadsheetId ? '***configured***' : 'NOT SET',
      triggerPhrases: config.inventory.triggerPhrases.join(', ')
    }
  };
}

/**
 * Check if a message is an inventory trigger
 */
function isInventoryTrigger(message) {
  const normalizedMessage = message.trim().toLowerCase();
  return config.inventory.triggerPhrases.some(
    phrase => normalizedMessage === phrase || normalizedMessage.startsWith(phrase + ' ')
  );
}

module.exports = {
  handleIncomingSms,
  getInventoryForJob,
  markInventoryBilled,
  getStatus,
  isInventoryTrigger
};







