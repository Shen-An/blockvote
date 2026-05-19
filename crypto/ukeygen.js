// ukeygen.js - UKeyGen(id, pp) → (usk, upk)
const { randomScalar, H2 } = require('./curve');

function UKeyGen(id, pp) {
  const usk = randomScalar();
  const h = H2(id);
  const upk = h.multiply(usk);
  return { usk, upk, h };
}

module.exports = { UKeyGen };