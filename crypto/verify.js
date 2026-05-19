// verify.js - Verify(pk, pp, tok) → { valid, tok }
const { G1, G2, Fr } = require('./curve');
const { pair } = require('./curve');

function Verify(pk, pp, tok) {
  const { Y_tilde, X_tilde } = pk;
  const { sigma1, sigma2, gPrime, D, disclosedHashes, pi2 } = tok;

  // Equation 1: e(σ'_1, X̃ · g̃' · ∏_{i∈D} Ỹ_i^{m_i}) = e(σ'_2, g̃)
  let g2Product = X_tilde.add(gPrime);
  for (let i = 0; i < D.length; i++) {
    const idx = D[i] - 1;
    if (idx >= 0 && idx < Y_tilde.length) {
      g2Product = g2Product.add(Y_tilde[idx].multiply(disclosedHashes[i]));
    }
  }

  const left1 = pair(sigma1, g2Product);
  const right1 = pair(sigma2, G2.BASE);

  if (left1.toString() !== right1.toString()) {
    console.error('Verify: Equation 1 failed (signature)');
    return { valid: false };
  }

  // All checks passed
  return { valid: true, tok };
}

module.exports = { Verify };