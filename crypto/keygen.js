// keygen.js - TTPKeyGen and TraceKeyGen
const { G1, G2, Fr, randomScalar } = require('./curve');

function TTPKeyGen(pp) {
  const { n_I, t_I, n_T, t_T, q } = pp;
  const n = q + 1;

  const x = randomScalar();
  const y = randomScalar();

  const X_tilde = G2.BASE.multiply(x);

  const Y = [];
  const Y_tilde = [];
  let yPow = Fr.ONE;
  for (let i = 1; i <= n; i++) {
    yPow = Fr.mul(yPow, y);
    Y.push(G1.BASE.multiply(yPow));
    Y_tilde.push(G2.BASE.multiply(yPow));
  }
  for (let i = n + 1; i <= 2 * n; i++) {
    yPow = Fr.mul(yPow, y);
    Y.push(G1.BASE.multiply(yPow));
  }

  const pk = { X_tilde, Y, Y_tilde };

  const polyCount = 2 * (q + 2);
  const isk_list = [];
  const ipk_list = [];

  for (let i = 1; i <= n_I; i++) {
    isk_list.push({ index: i, values: [] });
    ipk_list.push({ index: i, pk: [] });
  }

  for (let k = 0; k < polyCount; k++) {
    const coeffs = [randomScalar()];
    for (let j = 1; j < t_I; j++) {
      coeffs.push(randomScalar());
    }
    for (let i = 1; i <= n_I; i++) {
      let value = Fr.ZERO;
      let xPow = Fr.ONE;
      const idx = Fr.create(BigInt(i));
      for (let j = 0; j < coeffs.length; j++) {
        value = Fr.add(value, Fr.mul(coeffs[j], xPow));
        xPow = Fr.mul(xPow, idx);
      }
      isk_list[i - 1].values.push(value);
      ipk_list[i - 1].pk.push(G1.BASE.multiply(value));
    }
  }

  const tracers = [];
  for (let i = 1; i <= n_T; i++) {
    const tsk = randomScalar();
    const tpk = G2.BASE.multiply(tsk);
    tracers.push({ index: i, tsk, tpk });
  }

  const msk = { x, y };

  const issuers = isk_list.map((isk, idx) => ({
    index: idx + 1,
    isk: isk.values,
    ipk: ipk_list[idx].pk,
  }));

  return { msk, pk, issuers, tracers };
}

function serializePK(pk) {
  return {
    X_tilde: pk.X_tilde.toHex(),
    Y: pk.Y.map(y => y.toHex()),
    Y_tilde: pk.Y_tilde.map(yt => yt.toHex()),
  };
}

module.exports = { TTPKeyGen, serializePK };