// setup.js - Setup(1^λ, n_I, t_I, n_T, t_T, q) → pp
const { G1, randomScalar } = require('./curve');

function Setup(lambda, n_I, t_I, n_T, t_T, q) {
  const h = [];
  for (let i = 0; i < q + 1; i++) {
    h.push(randomScalar());
  }
  const hPoints = h.map(s => G1.BASE.multiply(s));

  const pp = {
    lambda,
    n_I,
    t_I,
    n_T,
    t_T,
    q,
    h: hPoints,
    curve: 'BLS12-381',
  };

  return pp;
}

module.exports = { Setup };