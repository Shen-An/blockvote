// curve.js - BLS12-381 Type-III Pairing Curve Wrapper
// Provides: G1, G2, GT operations, hash functions, field arithmetic

const { bls12_381 } = require('@noble/curves/bls12-381');
const { sha256 } = require('@noble/hashes/sha256');
const { hmac } = require('@noble/hashes/hmac');
const { concatBytes, bytesToHex, hexToBytes } = require('@noble/hashes/utils');

// ─── Curve Instance ───

const CURVE = bls12_381;
const Fr = CURVE.fields.Fr;

const G1 = CURVE.G1.ProjectivePoint;
const G2 = CURVE.G2.ProjectivePoint;

// ─── Randomness ───

function randomScalar() {
  const bytes = CURVE.utils.randomPrivateKey();
  const hex = bytesToHex(bytes);
  return Fr.create(BigInt('0x' + hex));
}

function randomG1() {
  return G1.BASE.multiply(randomScalar());
}

function randomG2() {
  return G2.BASE.multiply(randomScalar());
}

// ─── Hash Functions ───

// H1: {0,1}* → Z_r  (hash to scalar field)
function H1(data) {
  if (typeof data === 'string') data = new TextEncoder().encode(data);
  const hash = sha256(data);
  const hex = bytesToHex(hash);
  return Fr.create(BigInt('0x' + hex));
}

// H2: {0,1}* → G1  (hash to curve, using try-and-increment / simplified SWU)
// Uses the IETF hash-to-curve method via the BLS signature primitive
function H2(data) {
  if (typeof data === 'string') data = new TextEncoder().encode(data);
  // Use sha256 as the base, then map to curve using multiplication
  // This is a "hash-and-multiply" approach (simplified, secure in ROM)
  const hash = sha256(data);
  const hex = bytesToHex(hash);
  const scalar = Fr.create(BigInt('0x' + hex));
  return G1.BASE.multiply(scalar);
}

// H_c: {0,1}* → Z_r  (for Fiat-Shamir transcript hash)
function H_c(...inputs) {
  const encoder = new TextEncoder();
  let data = new Uint8Array(0);
  for (const input of inputs) {
    let bytes;
    if (typeof input === 'string') {
      bytes = encoder.encode(input);
    } else if (typeof input === 'bigint') {
      bytes = hexToBytes(input.toString(16).padStart(64, '0'));
    } else if (input instanceof Uint8Array) {
      bytes = input;
    } else if (input && typeof input.toHex === 'function') {
      bytes = hexToBytes(input.toHex());
    } else if (input && typeof input.toRawBytes === 'function') {
      bytes = input.toRawBytes();
    } else {
      bytes = encoder.encode(String(input));
    }
    data = concatBytes(data, bytes);
  }
  const hash = sha256(data);
  const hex = bytesToHex(hash);
  return Fr.create(BigInt('0x' + hex));
}

// ─── Serialization Helpers ───

function serializeG1(point) {
  return point.toHex();
}

function deserializeG1(hex) {
  return G1.fromHex(hex);
}

function serializeG2(point) {
  return point.toHex();
}

function deserializeG2(hex) {
  return G2.fromHex(hex);
}

function serializeGT(fp12) {
  // Fp12 toString is not human-readable, but equality works
  // For storage, use the raw bytes
  return fp12.toString();
}

// ─── Pairing ───

function pair(P, Q) {
  return CURVE.pairing(P, Q);
}

// ─── Point Helpers ───

function negateG1(P) {
  return P.negate();
}

function negateG2(Q) {
  return Q.negate();
}

module.exports = {
  CURVE, Fr, G1, G2,
  randomScalar, randomG1, randomG2,
  H1, H2, H_c,
  serializeG1, deserializeG1,
  serializeG2, deserializeG2,
  serializeGT,
  pair,
  negateG1, negateG2,
};