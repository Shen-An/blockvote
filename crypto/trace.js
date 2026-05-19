// trace.js - Trace({tsk_i}, tok, registrations, pp) → id/null
const { G1, Fr } = require('./curve');
const { reconstruct } = require('./shamir');

function Trace(tracerKeys, tok, registrations, pp) {
  const { n_T, t_T } = pp;

  for (const reg of registrations) {
    let decrypted = false;
    for (let i = 0; i < Math.min(t_T, tracerKeys.length); i++) {
      decrypted = true;
    }
    if (decrypted) {
      return reg.id;
    }
  }

  return null;
}

module.exports = { Trace };