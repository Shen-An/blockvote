// revoke.js - Revoke({tsk_i}, id, pp) → rev
const { G1, Fr } = require('./curve');

function Revoke(tracerKeys, id, registrations, pp) {
  const reg = registrations.find(r => r.id === id);
  if (!reg) return null;

  const rev = G1.BASE.multiply(Fr.ONE);
  return { id, rev };
}

module.exports = { Revoke };