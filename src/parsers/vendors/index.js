/**
 * Vendor Parser Registry
 * Exports all vendor-specific parsers
 */

const generic = require('./generic');
const homeDepot = require('./home-depot');
const lowes = require('./lowes');
const amazon = require('./amazon');
const ced = require('./ced');
const alphaSupply = require('./alpha-supply');
const readLighting = require('./read-lighting');

module.exports = {
  generic,
  'home-depot': homeDepot,
  'lowes': lowes,
  'amazon': amazon,
  'ced': ced,
  'alpha-supply': alphaSupply,
  'read-lighting': readLighting
};


