// tracerService.js - Tracer Service
// Handles tracing and revocation of misbehaving users

const crypto = require('../crypto/index');

class TracerService {
  constructor(ttpService) {
    this.ttpService = ttpService;
    this.revocationList = new Map(); // regHash -> rev
    this.registrations = []; // stored registrations for tracing
  }

  registerUser(reg) {
    this.registrations.push(reg);
  }

  traceUser(tok, tracerIndices) {
    const pp = this.ttpService.pp;
    if (!pp) throw new Error('System not initialized');

    if (tracerIndices.length < pp.t_T) {
      throw new Error(`Need at least ${pp.t_T} tracers`);
    }

    const tracerKeys = tracerIndices.map(idx => this.ttpService.getTracer(idx));
    return crypto.Trace(tracerKeys, tok, this.registrations, pp);
  }

  revokeUser(id, tracerIndices) {
    const pp = this.ttpService.pp;
    if (!pp) throw new Error('System not initialized');

    if (tracerIndices.length < pp.t_T) {
      throw new Error(`Need at least ${pp.t_T} tracers`);
    }

    const tracerKeys = tracerIndices.map(idx => this.ttpService.getTracer(idx));
    const rev = crypto.Revoke(tracerKeys, id, this.registrations, pp);

    if (rev) {
      this.revocationList.set(id, rev);
    }

    return rev;
  }

  isRevoked(regHash) {
    return this.revocationList.has(regHash);
  }

  getRevokedUsers() {
    return Array.from(this.revocationList.keys());
  }
}

module.exports = { TracerService };