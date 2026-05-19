// feldman.js - Feldman Verifiable Secret Sharing Commitments
// Provides publicly verifiable shares for Shamir secret sharing

const { G1, Fr, randomScalar } = require('./curve');

// Generate Feldman commitments from polynomial coefficients
// coefficients: [a_0, a_1, ..., a_{t-1}] where a_0 = secret
// Returns: [g^{a_0}, g^{a_1}, ..., g^{a_{t-1}}] ∈ G1
function commit(coefficients) {
  return coefficients.map(coeff => G1.BASE.multiply(coeff));
}

// Verify that a share (value at index i) is consistent with commitments
// index: the x-coordinate (starting from 1)
// value: the share value P(index)
// commitments: [g^{a_0}, g^{a_1}, ...]
function verifyShare(index, value, commitments) {
  // g^{value} should equal ∏ (g^{a_j})^{index^j}
  const lhs = G1.BASE.multiply(value);
  let rhs = G1.ZERO;
  let indexPow = Fr.ONE;
  const idx = Fr.create(BigInt(index));
  for (let j = 0; j < commitments.length; j++) {
    rhs = rhs.add(commitments[j].multiply(indexPow));
    indexPow = Fr.mul(indexPow, idx);
  }
  return lhs.equals(rhs);
}

// Generate Pedersen commitment for a secret with a random blinding factor
function pedersenCommit(secret, h) {
  const r = randomScalar();
  return {
    commitment: G1.BASE.multiply(secret).add(h.multiply(r)),
    blind: r,
  };
}

// Verify a Pedersen commitment
function pedersenVerify(secret, blind, h, commitment) {
  const expected = G1.BASE.multiply(secret).add(h.multiply(blind));
  return expected.equals(commitment);
}

module.exports = { commit, verifyShare, pedersenCommit, pedersenVerify };