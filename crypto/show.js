// show.js - Show(usk, attributes, D, cred, pp) → tok
const { G1, G2, Fr, randomScalar, H1, H_c } = require('./curve');

function Show(usk, attributes, D, cred, pp) {
  const { q, h: pp_h } = pp;
  const n = q + 1;

  const r = randomScalar();
  const t = randomScalar();

  // Blind σ - using the aggregated signature
  const sigma = cred.sigma;
  const sigma1 = sigma.multiply(r);
  const sigma2 = sigma1.multiply(t);

  // Compute g̃' = g̃^t · ∏_{i∈D̄} Ỹ_i^{m_i}
  const Dset = new Set(D);
  let gPrime = G2.BASE.multiply(t);
  for (let i = 1; i <= n; i++) {
    if (!Dset.has(i)) {
      const mHash = H1(String(i));
      gPrime = gPrime.add(G2.BASE.multiply(mHash));
    }
  }

  // Hash disclosed attributes to scalars for verification
  const disclosedHashes = D.map(i => H1(attributes[i - 1]));

  // Knowledge proof Π2
  const r_usk = randomScalar();
  const T1 = pp_h[pp_h.length - 1].multiply(r_usk);
  const cChallenge = H_c('pi2', sigma1.toHex(), sigma2.toHex(), gPrime.toHex(),
    T1.toHex(), D.toString());
  const s_usk = Fr.add(r_usk, Fr.mul(cChallenge, usk));

  const tok = {
    sigma1,
    sigma2,
    gPrime,
    D: D,
    disclosedHashes,
    pi2: { c: cChallenge, s: s_usk, T1: T1.toHex() },
  };

  return tok;
}

module.exports = { Show };