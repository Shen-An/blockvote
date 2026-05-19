// shamir.js - Shamir Secret Sharing over Z_r (BLS12-381 scalar field)
const { Fr, randomScalar } = require('./curve');

// Split secret into n shares with threshold t
// Returns: [{index, value}, ...]
function split(secret, n, t) {
  if (t > n) throw new Error('Threshold cannot exceed number of shares');
  if (t < 1) throw new Error('Threshold must be at least 1');

  // Generate random coefficients for polynomial of degree t-1
  // P(x) = secret + a_1*x + a_2*x^2 + ... + a_{t-1}*x^{t-1}
  const coeffs = [secret];
  for (let i = 1; i < t; i++) {
    coeffs.push(randomScalar());
  }

  // Evaluate polynomial at x = 1, 2, ..., n
  const shares = [];
  for (let i = 1; i <= n; i++) {
    let value = Fr.ZERO;
    let xPow = Fr.ONE;
    for (let j = 0; j < coeffs.length; j++) {
      value = Fr.add(value, Fr.mul(coeffs[j], xPow));
      xPow = Fr.mul(xPow, Fr.create(BigInt(i)));
    }
    shares.push({ index: i, value });
  }

  return { shares, coefficients: coeffs };
}

// Reconstruct secret from t shares using Lagrange interpolation
// shares: [{index, value}, ...] (at least t shares)
function reconstruct(shares, t) {
  if (shares.length < t) throw new Error(`Need at least ${t} shares to reconstruct`);

  let secret = Fr.ZERO;
  for (let i = 0; i < shares.length; i++) {
    const li = lagrangeCoefficient(shares[i].index, shares.map(s => s.index), Fr.ZERO);
    secret = Fr.add(secret, Fr.mul(shares[i].value, li));
  }
  return secret;
}

// Compute Lagrange coefficient λ_i for interpolation at point x0
function lagrangeCoefficient(i, indices, x0) {
  let num = Fr.ONE;
  let den = Fr.ONE;
  for (const j of indices) {
    if (j === i) continue;
    num = Fr.mul(num, Fr.sub(Fr.create(x0), Fr.create(BigInt(j))));
    den = Fr.mul(den, Fr.sub(Fr.create(BigInt(i)), Fr.create(BigInt(j))));
  }
  return Fr.div(num, den);
}

module.exports = { split, reconstruct, lagrangeCoefficient };