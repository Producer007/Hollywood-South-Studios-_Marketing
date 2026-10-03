// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

// GCN Exchange - Cargo Container Token (CCT)
// STATUS: TESTNET ONLY. PRE-AUDIT. PROOF-OF-CONCEPT. Not for live value.
//
// One ERC-721 per physical container, keyed by its ISO 6346 identifier.
// The token records WHAT is attested (document hash, custody status, carrying vessel).
// It does not prove the physical container exists; an authorised ATTESTER does,
// off-chain, and writes the result here.

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/Pausable.sol";

contract ContainerToken is ERC721, AccessControl, Pausable {
    bytes32 public constant ISSUER_ROLE = keccak256("ISSUER_ROLE");     // mints tokens
    bytes32 public constant ATTESTER_ROLE = keccak256("ATTESTER_ROLE"); // writes custody/vessel attestations

    enum Status { Registered, InTransit, Delivered, Held, Retired }

    struct Container {
        string  isoId;          // ISO 6346, e.g. "CSQU3054383" (validated off-chain, check digit enforced in tooling)
        string  sizeType;       // ISO 6346 size/type code, e.g. "45G1" (40 ft high cube GP)
        bytes32 docsHash;       // keccak256 of the bill-of-lading / ownership evidence bundle
        Status  status;
        uint64  updatedAt;
    }

    struct VesselAttestation {
        uint32  imo;            // IMO number of the carrying vessel
        uint8   mtiScore;       // Pole Star Maritime Transparency Index, 0 (Hard Dark) to 5 (Transparent)
        uint64  attestedAt;
        bytes32 evidenceHash;   // hash of the MTI report / AIS evidence the attester relied on
    }

    uint256 private _nextId = 1;
    mapping(uint256 => Container) public containers;
    mapping(uint256 => VesselAttestation) public vesselOf;
    mapping(bytes32 => bool) private _isoRegistered; // keccak256(isoId) -> exists; one token per container

    // Policy: transfers blocked while a container is Held or the carrying vessel scores below this.
    uint8 public minMtiForTransfer = 2;

    event ContainerRegistered(uint256 indexed tokenId, string isoId, bytes32 docsHash);
    event StatusChanged(uint256 indexed tokenId, Status status);
    event VesselAttested(uint256 indexed tokenId, uint32 imo, uint8 mtiScore, bytes32 evidenceHash);
    event MinMtiUpdated(uint8 minMti);

    constructor(address admin) ERC721("GCN Cargo Container Token", "GCCT") {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ISSUER_ROLE, admin);
        _grantRole(ATTESTER_ROLE, admin);
    }

    function register(
        address to,
        string calldata isoId,
        string calldata sizeType,
        bytes32 docsHash
    ) external onlyRole(ISSUER_ROLE) whenNotPaused returns (uint256 tokenId) {
        require(bytes(isoId).length == 11, "ISO 6346 id must be 11 chars");
        // ISO 6346 size/type: 4 characters, where the 3rd is a type letter and the 4th a
        // type-detail DIGIT (45G1, 22G1, 42R1). Yard shorthand is also four characters
        // ("40HC", "20GP") but ends in a letter, and carrier systems reject it - so the
        // digit is what separates the two. Normalise before minting (shared/identifiers.js).
        bytes memory st = bytes(sizeType);
        require(st.length == 4, "size/type must be a 4-char ISO 6346 code");
        require(st[2] >= 0x41 && st[2] <= 0x5A, "size/type char 3 must be a type letter A-Z");
        require(st[3] >= 0x30 && st[3] <= 0x39, "size/type char 4 must be a digit - yard shorthand is not an ISO 6346 code");
        require(docsHash != bytes32(0), "docs hash required");
        bytes32 k = keccak256(bytes(isoId));
        require(!_isoRegistered[k], "container already tokenised");
        _isoRegistered[k] = true;

        tokenId = _nextId++;
        containers[tokenId] = Container(isoId, sizeType, docsHash, Status.Registered, uint64(block.timestamp));
        _safeMint(to, tokenId);
        emit ContainerRegistered(tokenId, isoId, docsHash);
    }

    function setStatus(uint256 tokenId, Status status) external onlyRole(ATTESTER_ROLE) {
        _requireMinted(tokenId);
        containers[tokenId].status = status;
        containers[tokenId].updatedAt = uint64(block.timestamp);
        emit StatusChanged(tokenId, status);
    }

    function attestVessel(
        uint256 tokenId,
        uint32 imo,
        uint8 mtiScore,
        bytes32 evidenceHash
    ) external onlyRole(ATTESTER_ROLE) {
        _requireMinted(tokenId);
        require(mtiScore <= 5, "MTI score is 0-5");
        vesselOf[tokenId] = VesselAttestation(imo, mtiScore, uint64(block.timestamp), evidenceHash);
        emit VesselAttested(tokenId, imo, mtiScore, evidenceHash);
    }

    function setMinMtiForTransfer(uint8 minMti) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(minMti <= 5, "MTI score is 0-5");
        minMtiForTransfer = minMti;
        emit MinMtiUpdated(minMti);
    }

    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) { _pause(); }
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) { _unpause(); }

    function transferAllowed(uint256 tokenId) public view returns (bool ok, string memory reason) {
        Container storage c = containers[tokenId];
        if (c.status == Status.Held) return (false, "container held");
        if (c.status == Status.Retired) return (false, "container retired");
        VesselAttestation storage v = vesselOf[tokenId];
        if (c.status == Status.InTransit) {
            if (v.attestedAt == 0) return (false, "in transit without vessel attestation");
            if (v.mtiScore < minMtiForTransfer) return (false, "vessel MTI below policy");
        }
        return (true, "");
    }

    // Mint (from == 0) and burn (to == 0) bypass the policy; ordinary transfers enforce it.
    function _beforeTokenTransfer(address from, address to, uint256 tokenId, uint256 batchSize)
        internal
        override
        whenNotPaused
    {
        if (from != address(0) && to != address(0)) {
            (bool ok, string memory reason) = transferAllowed(tokenId);
            require(ok, reason);
        }
        super._beforeTokenTransfer(from, to, tokenId, batchSize);
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721, AccessControl)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
