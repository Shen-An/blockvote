// crypto/index.js - Main export for crypto module
const curve = require('./curve');
const { Setup } = require('./setup');
const { TTPKeyGen } = require('./keygen');
const { UKeyGen } = require('./ukeygen');
const { Obtain } = require('./obtain');
const { Issue } = require('./issue');
const { CredAgg } = require('./credagg');
const { Show } = require('./show');
const { Verify } = require('./verify');
const { Trace } = require('./trace');
const { Revoke } = require('./revoke');

module.exports = {
  ...curve,
  Setup,
  TTPKeyGen,
  UKeyGen,
  Obtain,
  Issue,
  CredAgg,
  Show,
  Verify,
  Trace,
  Revoke,
};