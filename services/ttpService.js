// ttpService.js - Trusted Third Party Service
// Manages system initialization, key generation, and contract setup

const crypto = require('../crypto/index');
const { serializePK } = require('../crypto/keygen');

class TTPError extends Error {
  constructor(message) { super(message); this.name = 'TTPError'; }
}

class TTPService {
  constructor() {
    this.pp = null;
    this.msk = null;
    this.pk = null;
    this.issuers = [];
    this.tracers = [];
    this.initialized = false;
  }

  initialize(lambda = 128, n_I = 5, t_I = 3, n_T = 3, t_T = 2, q = 3) {
    if (this.initialized) throw new TTPError('TTP already initialized');

    // Step 1: Setup
    this.pp = crypto.Setup(lambda, n_I, t_I, n_T, t_T, q);

    // Step 2: TTPKeyGen + TraceKeyGen
    const result = crypto.TTPKeyGen(this.pp);
    this.msk = result.msk;
    this.pk = result.pk;
    this.issuers = result.issuers;
    this.tracers = result.tracers;

    this.initialized = true;

    return {
      pp: {
        lambda: this.pp.lambda,
        n_I: this.pp.n_I,
        t_I: this.pp.t_I,
        n_T: this.pp.n_T,
        t_T: this.pp.t_T,
        q: this.pp.q,
        h: this.pp.h.map(h => h.toHex()),
        curve: this.pp.curve,
      },
      pk: {
        X_tilde: this.pk.X_tilde.toHex(),
        Y: this.pk.Y.map(y => y.toHex()),
        Y_tilde: this.pk.Y_tilde.map(yt => yt.toHex()),
      },
      issuerCount: this.issuers.length,
      tracerCount: this.tracers.length,
    };
  }

  getPublicParams() {
    if (!this.initialized) throw new TTPError('TTP not initialized');
    return { pp: this.pp, pk: this.pk };
  }

  getIssuer(index) {
    if (!this.initialized) throw new TTPError('TTP not initialized');
    if (index < 1 || index > this.issuers.length) throw new TTPError('Invalid issuer index');
    return this.issuers[index - 1];
  }

  getTracer(index) {
    if (!this.initialized) throw new TTPError('TTP not initialized');
    if (index < 1 || index > this.tracers.length) throw new TTPError('Invalid tracer index');
    return this.tracers[index - 1];
  }

  getAllIssuers() {
    if (!this.initialized) throw new TTPError('TTP not initialized');
    return this.issuers;
  }

  getAllTracers() {
    if (!this.initialized) throw new TTPError('TTP not initialized');
    return this.tracers;
  }

  serializeSystemState() {
    const pkSer = serializePK(this.pk);
    return {
      pp: {
        lambda: this.pp.lambda,
        n_I: this.pp.n_I,
        t_I: this.pp.t_I,
        n_T: this.pp.n_T,
        t_T: this.pp.t_T,
        q: this.pp.q,
        h: this.pp.h.map(h => h.toHex()),
      },
      pk: pkSer,
      issuers: this.issuers.map(iss => ({
        index: iss.index,
        isk: iss.isk.map(s => s.toString()),
        ipk: iss.ipk.map(p => p.toHex()),
      })),
      tracers: this.tracers.map(tr => ({
        index: tr.index,
        tpk: tr.tpk.toHex(),
      })),
    };
  }
}

const ttpService = new TTPService();
module.exports = { TTPService, TTPError, ttpService };