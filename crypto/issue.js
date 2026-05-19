// issue.js - Issue protocol (issuer side)
const { G1 } = require('./curve');
const { verifyProof_KnowledgeOfSecret } = require('./nizk');

function Issue(issuer, pp, reg) {
  const { h: pp_h, q } = pp;
  const isk_i = issuer.isk;
  const ipk_i = issuer.ipk;

  const valid = verifyProof_KnowledgeOfSecret(reg.pi1, reg.upk, reg.h);
  if (!valid) return null;

  if (!reg.encryptedAttrs || reg.encryptedAttrs.length !== q) return null;

  let h_base = pp_h[0];
  for (let j = 0; j < q; j++) {
    const mHash = reg.attrHashes[j];
    h_base = h_base.add(pp_h[j + 1].multiply(mHash));
  }

  const signingShare = isk_i[0];
  const sigma_i = h_base.multiply(signingShare);

  return {
    issuerIndex: issuer.index,
    sigma_i,
    ipk_i: ipk_i[0],
  };
}

module.exports = { Issue };