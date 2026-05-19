const CredentialManager = artifacts.require("CredentialManager");

module.exports = function (deployer) {
  deployer.deploy(CredentialManager);
};