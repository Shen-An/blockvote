// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract CredentialManager {
    // ─── System State ───
    address public ttp;
    bool public initialized;

    // Issuer info
    struct IssuerInfo {
        bytes ipk;          // Serialized issuer public key (G1 point hex)
        bool isActive;
    }

    // Tracer info
    struct TracerInfo {
        bytes tpk;          // Serialized tracer public key (G2 point hex)
        bool isActive;
    }

    // Registration info
    struct Registration {
        bytes regData;      // Serialized registration data
        bool exists;
    }

    // Credential info
    struct CredentialInfo {
        bytes credData;     // Serialized partial credential
        bool uploaded;
    }

    // Token info
    struct TokenInfo {
        bytes tokData;      // Serialized anonymous token
        bytes voteId;       // Associated vote ID
        bool used;
    }

    // Revocation info
    struct RevocationInfo {
        bytes revData;      // Revocation value (G1 point hex)
        bool revoked;
    }

    // Temporary values for multi-step computations (Fig.14: Ti, ID, Qi)
    mapping(bytes32 => bytes) public tValues;
    mapping(bytes32 => bytes) public iDValues;
    mapping(bytes32 => bytes) public qValues;

    // Storage mappings
    mapping(uint256 => IssuerInfo) public issuers;
    mapping(uint256 => TracerInfo) public tracers;
    mapping(bytes32 => Registration) public registrations;       // regHash => Registration
    mapping(bytes32 => RevocationInfo) public revocations;       // regHash => Revocation
    mapping(bytes32 => mapping(uint256 => CredentialInfo)) public credentials; // regHash => issuerId => Credential
    mapping(bytes32 => TokenInfo) public tokens;                 // tokHash => Token

    uint256 public issuerCount;
    uint256 public tracerCount;

    // ─── Events ───
    event Initialized(bytes ppHash);
    event IssuerAdded(uint256 indexed issuerId, bytes ipk);
    event TracerAdded(uint256 indexed tracerId, bytes tpk);
    event RegUploaded(bytes32 indexed regHash);
    event CredUploaded(bytes32 indexed regHash, uint256 issuerId);
    event TokenUploaded(bytes32 indexed tokHash);
    event RevUploaded(bytes32 indexed regHash);

    modifier onlyTTP() {
        require(msg.sender == ttp, "Only TTP can call");
        _;
    }

    modifier whenInitialized() {
        require(initialized, "Not initialized");
        _;
    }

    constructor() {
        ttp = msg.sender;
    }

    // ─── Create: Initialize system with public parameters ───
    function Create(bytes calldata ppHash) external onlyTTP {
        require(!initialized, "Already initialized");
        initialized = true;
        emit Initialized(ppHash);
    }

    // ─── AddIssuer: Register an issuer ───
    function AddIssuer(bytes calldata ipk) external onlyTTP whenInitialized {
        issuerCount++;
        issuers[issuerCount] = IssuerInfo(ipk, true);
        emit IssuerAdded(issuerCount, ipk);
    }

    // ─── AddTracer: Register a tracer ───
    function AddTracer(bytes calldata tpk) external onlyTTP whenInitialized {
        tracerCount++;
        tracers[tracerCount] = TracerInfo(tpk, true);
        emit TracerAdded(tracerCount, tpk);
    }

    // ─── uploadReg: Store registration data ───
    function uploadReg(bytes32 regHash, bytes calldata regData) external whenInitialized {
        require(!registrations[regHash].exists, "Already registered");
        registrations[regHash] = Registration(regData, true);
        emit RegUploaded(regHash);
    }

    // ─── getReg: Retrieve registration data ───
    function getReg(bytes32 regHash) external view whenInitialized returns (bytes memory) {
        require(registrations[regHash].exists, "Registration not found");
        return registrations[regHash].regData;
    }

    // ─── uploadCred: Issuer uploads partial credential ───
    function uploadCred(bytes32 regHash, uint256 issuerId, bytes calldata credData) external whenInitialized {
        require(registrations[regHash].exists, "User not registered");
        require(issuers[issuerId].isActive, "Issuer not active");
        require(!credentials[regHash][issuerId].uploaded, "Cred already uploaded");
        credentials[regHash][issuerId] = CredentialInfo(credData, true);
        emit CredUploaded(regHash, issuerId);
    }

    // ─── getCred: Retrieve partial credential ───
    function getCred(bytes32 regHash, uint256 issuerId) external view whenInitialized returns (bytes memory) {
        require(credentials[regHash][issuerId].uploaded, "Credential not found");
        return credentials[regHash][issuerId].credData;
    }

    // ─── uploadToken: Store anonymous token ───
    function uploadToken(bytes32 tokHash, bytes calldata tokData) external whenInitialized {
        require(!tokens[tokHash].used, "Token already used");
        tokens[tokHash] = TokenInfo(tokData, "", true);
        emit TokenUploaded(tokHash);
    }

    // ─── getToken: Retrieve token data ───
    function getToken(bytes32 tokHash) external view whenInitialized returns (bytes memory) {
        require(tokens[tokHash].used, "Token not found");
        return tokens[tokHash].tokData;
    }

    // ─── uploadTi / getTi: Temp values ───
    function uploadTi(bytes32 key, bytes calldata value) external whenInitialized {
        tValues[key] = value;
    }

    function getTi(bytes32 key) external view whenInitialized returns (bytes memory) {
        return tValues[key];
    }

    // ─── uploadID / getID: Identity values ───
    function uploadID(bytes32 key, bytes calldata value) external whenInitialized {
        iDValues[key] = value;
    }

    function getID(bytes32 key) external view whenInitialized returns (bytes memory) {
        return iDValues[key];
    }

    // ─── uploadQi / getQi: Quotient values ───
    function uploadQi(bytes32 key, bytes calldata value) external whenInitialized {
        qValues[key] = value;
    }

    function getQi(bytes32 key) external view whenInitialized returns (bytes memory) {
        return qValues[key];
    }

    // ─── uploadRev: Store revocation data ───
    function uploadRev(bytes32 regHash, bytes calldata revData) external whenInitialized {
        require(registrations[regHash].exists, "User not found");
        revocations[regHash] = RevocationInfo(revData, true);
        emit RevUploaded(regHash);
    }

    // ─── getRev: Check if user is revoked ───
    function getRev(bytes32 regHash) external view whenInitialized returns (bytes memory) {
        require(revocations[regHash].revoked, "Not revoked");
        return revocations[regHash].revData;
    }

    // ─── isRevoked: Quick revocation check ───
    function isRevoked(bytes32 regHash) external view whenInitialized returns (bool) {
        return revocations[regHash].revoked;
    }

    // ─── getIssuerCount / getTracerCount ───
    function getIssuerCount() external view returns (uint256) {
        return issuerCount;
    }

    function getTracerCount() external view returns (uint256) {
        return tracerCount;
    }
}