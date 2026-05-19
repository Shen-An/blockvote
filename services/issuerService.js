// issuerService.js - Issuer Service
// Handles credential issuance requests

const crypto = require('../crypto/index');

class IssuerService {
  constructor(ttpService) {
    this.ttpService = ttpService;
  }

  issueCredential(userId, reg, issuerIndex) {
    const pp = this.ttpService.pp;
    if (!pp) throw new Error('System not initialized');

    const issuer = this.ttpService.getIssuer(issuerIndex);
    if (!issuer) throw new Error(`Issuer ${issuerIndex} not found`);

    const cred_i = crypto.Issue(issuer, pp, reg);
    if (!cred_i) {
      throw new Error('Credential issuance failed: invalid registration');
    }

    return cred_i;
  }
}

module.exports = { IssuerService };