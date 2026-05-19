// credagg.js - CredAgg: Aggregate partial credentials
const { Fr } = require('./curve');
const { lagrangeCoefficient } = require('./shamir');

function CredAgg(partialCreds, pp) {
  if (partialCreds.length < pp.t_I) {
    throw new Error(`Need at least ${pp.t_I} partial credentials`);
  }

  const indices = partialCreds.map(c => c.issuerIndex);
  const coefficients = indices.map(i => lagrangeCoefficient(i, indices, Fr.ZERO));

  let sigma = partialCreds[0].sigma_i.multiply(coefficients[0]);
  for (let i = 1; i < partialCreds.length; i++) {
    sigma = sigma.add(partialCreds[i].sigma_i.multiply(coefficients[i]));
  }

  return { sigma };
}

module.exports = { CredAgg };