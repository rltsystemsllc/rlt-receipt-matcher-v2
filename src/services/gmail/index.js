/**
 * Gmail Service Module
 * Exports all Gmail-related functionality
 */

const client = require('./client');
const fetcher = require('./fetcher');
const processor = require('./processor');

module.exports = {
  client,
  fetcher,
  processor
};


