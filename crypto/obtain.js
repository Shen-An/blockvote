// obtain.js - Obtain protocol (user side)
const { G1, G2, Fr, randomScalar, H1, H_c } = require('./curve');
const { keygen } = require('./elgamal');
const { split } = require('./shamir');
const { commit } = require('./feldman');
const { createProof_KnowledgeOfSecret } = require('./nizk');

function Obtain(id, usk, upk, h, attributes, issuers, tracers, pp) {
  const { q, n_T, t_T, h: pp_h } = pp;

  const elGamalKey = keygen();

  const encryptedAttrs = [];
  const attrHashes = [];
  for (let j = 0; j < q; j++) {
    const mHash = H1(attributes[j]);
    attrHashes.push(mHash);
    const messagePoint = pp_h[j + 1].multiply(mHash);
    const r = randomScalar();
    const alpha = G1.BASE.multiply(r);
    const beta = messagePoint.add(elGamalKey.pk.multiply(r));
    encryptedAttrs.push({ alpha, beta });
  }

  const { shares: uskShares, coefficients } = split(usk, n_T, t_T);

  const encryptedShares = [];
  for (let i = 0; i < n_T; i++) {
    encryptedShares.push({
      index: uskShares[i].index,
      c1: G1.BASE.multiply(uskShares[i].value),
      c2: G1.BASE.multiply(uskShares[i].value), // placeholder for simplified
    });
  }

  const feldmanComm = commit(coefficients);
  const pi1 = createProof_KnowledgeOfSecret(usk, upk, h);

  const reg = {
    id,
    upk,
    h,
    elGamalPK: elGamalKey.pk,
    encryptedAttrs,
    attrHashes,
    encryptedShares,
    feldmanComm,
    pi1,
    regHash: H_c('reg', id),
  };

  return reg;
}

module.exports = { Obtain };