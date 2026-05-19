// elgamal.js - ElGamal Encryption in G1
// Used for encrypting attributes and Shamir shares in the credential system

const { G1, Fr, randomScalar, serializeG1, deserializeG1 } = require('./curve');

// Generate ElGamal key pair
// Returns: { sk: Z_r, pk: G1_point }
function keygen() {
  const sk = randomScalar();
  const pk = G1.BASE.multiply(sk);
  return { sk, pk };
}

// Encrypt a message point M ∈ G1 under public key pk
// Returns: { c1: G1 (g^r), c2: G1 (M + pk^r) }
function encrypt(pk, M) {
  const r = randomScalar();
  const c1 = G1.BASE.multiply(r);     // g^r
  const c2 = M.add(pk.multiply(r));   // M + pk^r (additive ElGamal)
  return { c1, c2 };
}

// Decrypt a ciphertext (c1, c2) using secret key sk
// Returns: M = c2 - sk*c1
function decrypt(sk, c1, c2) {
  const shared = c1.multiply(sk);
  return c2.subtract(shared);
}

// Re-encrypt for homomorphic operations: multiply ciphertext by randomness
function rerandomize(pk, ct) {
  const r = randomScalar();
  const c1 = ct.c1.add(G1.BASE.multiply(r));
  const c2 = ct.c2.add(pk.multiply(r));
  return { c1, c2 };
}

// Homomorphic add: c1 + c1', c2 + c2'
function add(ct1, ct2) {
  return {
    c1: ct1.c1.add(ct2.c1),
    c2: ct1.c2.add(ct2.c2),
  };
}

// Homomorphic multiply by scalar: (scalar * c1, scalar * c2)
function scalarMul(ct, scalar) {
  return {
    c1: ct.c1.multiply(scalar),
    c2: ct.c2.multiply(scalar),
  };
}

// Serialize ciphertext
function serialize(ct) {
  return {
    c1: serializeG1(ct.c1),
    c2: serializeG1(ct.c2),
  };
}

// Deserialize ciphertext
function deserialize(data) {
  return {
    c1: deserializeG1(data.c1),
    c2: deserializeG1(data.c2),
  };
}

module.exports = { keygen, encrypt, decrypt, rerandomize, add, scalarMul, serialize, deserialize };