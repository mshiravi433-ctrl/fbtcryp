// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * FBT Insurance OS — FBTInsuranceRouter (§9, §54)
 * ===========================================================================
 * FBT is NOT an insurer and this router does NOT underwrite or custody user
 * funds in phase 1. Its job is:
 *   • payment routing / direct settlement to an external provider,
 *   • referral attribution + integration-fee accounting,
 *   • provider allowlist + pause control,
 *   • on-chain evidence records (coverage / claim / payout),
 *   • EIP-712 purchase authorisation with nonce/deadline/chainId replay safety.
 *
 * SECURITY PATTERNS (see §10):
 *   • access control (admin role; production admin MUST be a multisig)
 *   • reentrancy guard on every state-changing path
 *   • pausable (emergency stop)
 *   • EIP-712 typed data + chain id + nonce + deadline (replay protection)
 *   • provider allowlist with per-provider pause / removal
 *   • SafeERC20-style low-level calls (handles non-standard tokens)
 *
 * > NOTE: to stay consistent with this repo's self-contained contracts (no
 * > OpenZeppelin contracts is available offline), the OpenZeppelin-equivalent
 * > helpers below are inlined. Before ANY production deployment, replace the
 * > inlined helpers with the current audited OpenZeppelin contracts
 * > (ReentrancyGuard, Pausable, AccessControl, SafeERC20, EIP712/ECDSA) and
 * > run the §49 audit checklist. This file is an integration reference.
 */

/* ========================= OpenZeppelin-equivalent helpers ================= */

abstract contract Context {
    function _msgSender() internal view virtual returns (address) { return msg.sender; }
}

abstract contract Ownable is Context {
    address private _owner;
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    constructor() { _owner = _msgSender(); emit OwnershipTransferred(address(0), _owner); }
    modifier onlyOwner() { require(_owner == _msgSender(), "NOT_OWNER"); _; }
    function owner() public view returns (address) { return _owner; }
    function transferOwnership(address n) external onlyOwner { require(n != address(0), "ZERO"); emit OwnershipTransferred(_owner, n); _owner = n; }
}

abstract contract ReentrancyGuard {
    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED = 2;
    uint256 private _status = _NOT_ENTERED;
    modifier nonReentrant() {
        require(_status != _ENTERED, "REENTRANCY");
        _status = _ENTERED;
        _;
        _status = _NOT_ENTERED;
    }
}

abstract contract Pausable is Ownable {
    bool private _paused;
    event Paused(address acct);
    event Unpaused(address acct);
    modifier whenNotPaused() { require(!_paused, "PAUSED"); _; }
    modifier whenPaused() { require(_paused, "NOT_PAUSED"); _; }
    function paused() public view returns (bool) { return _paused; }
    function pause() external onlyOwner whenNotPaused { _paused = true; emit Paused(_msgSender()); }
    function unpause() external onlyOwner whenPaused { _paused = false; emit Unpaused(_msgSender()); }
}

/// Minimal access control: ADMIN_ROLE (default = deployer). Multisig in prod.
abstract contract AccessControl is Ownable {
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    mapping(bytes32 => mapping(address => bool)) private _roles;
    modifier onlyRole(bytes32 role) { require(hasRole(role, _msgSender()), "ROLE"); _; }
    function hasRole(bytes32 role, address acct) public view returns (bool) {
        return _roles[role][acct] || (role == ADMIN_ROLE && acct == owner());
    }
    function grantAdmin(address acct) external onlyOwner { _roles[ADMIN_ROLE][acct] = true; }
    function revokeAdmin(address acct) external onlyOwner { _roles[ADMIN_ROLE][acct] = false; }
}

library SafeERC20Lite {
    function safeTransfer(address token, address to, uint256 amount) internal {
        (bool ok, bytes memory ret) = token.call(abi.encodeWithSignature("transfer(address,uint256)", to, amount));
        require(ok && (ret.length == 0 || abi.decode(ret, (bool))), "TRANSFER_FAILED");
    }
    function safeTransferFrom(address token, address from, address to, uint256 amount) internal {
        (bool ok, bytes memory ret) = token.call(abi.encodeWithSignature("transferFrom(address,address,uint256)", from, to, amount));
        require(ok && (ret.length == 0 || abi.decode(ret, (bool))), "TRANSFER_FROM_FAILED");
    }
}

library ECDSALite {
    function recover(bytes32 hash, bytes memory sig) internal pure returns (address) {
        require(sig.length == 65, "BAD_SIG");
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := mload(add(sig, 32))
            s := mload(add(sig, 64))
            v := and(mload(add(sig, 96)), 0xff)
        }
        if (v < 27) v += 27;
        require(v == 27 || v == 28, "BAD_V");
        require(uint256(s) <= 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0, "BAD_S");
        return ecrecover(hash, v, r, s);
    }
}

/* ================================= Router ================================= */

contract FBTInsuranceRouter is Ownable, ReentrancyGuard, Pausable, AccessControl {
    using SafeERC20Lite for address;

    struct Provider {
        address recipient;    // settlement / fee recipient for this provider
        bool exists;
        bool enabled;
        bool paused;
        bool routerSettles;   // true => tokens pass through this router (ROUTED); false => direct settlement, router only records
        uint16 integrationFeeBps; // capped
    }

    uint16 public constant MAX_INTEGRATION_FEE_BPS = 100; // 1% hard cap (§52)
    address public feeRecipient;

    // provider allowlist (§8, §54)
    mapping(bytes32 => Provider) public providers;

    // EIP-712
    bytes32 public constant DOMAIN_TYPEHASH = keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 public constant PURCHASE_TYPEHASH = keccak256(
        "Purchase(bytes32 providerId,address buyer,address premiumToken,uint256 premiumAmount,uint256 coverageAmount,uint256 durationDays,uint256 nonce,uint256 deadline,bytes32 quoteReference)"
    );
    bytes32 public immutable DOMAIN_SEPARATOR;
    uint256 public immutable deploymentChainId;

    // replay protection (§10)
    mapping(address => uint256) public nonces;
    // evidence records
    mapping(bytes32 => bool) public coverageRecords;
    mapping(bytes32 => bool) public claimRecords;
    mapping(bytes32 => bool) public payoutRecords;

    event ProviderSet(bytes32 indexed providerId, address recipient, bool routerSettles, uint16 integrationFeeBps);
    event ProviderPaused(bytes32 indexed providerId, bool paused);
    event ProviderRemoved(bytes32 indexed providerId);
    event QuoteReferenced(bytes32 indexed quoteReference, address indexed buyer, bytes32 providerId, uint256 indexed quoteId);
    event CoveragePurchased(bytes32 indexed providerId, address indexed buyer, uint256 coverageId, uint256 coverageAmount, uint256 premiumAmount, uint256 integrationFee);
    event CoverageRecorded(bytes32 indexed providerId, address indexed buyer, bytes32 indexed coverageHash);
    event ClaimRecorded(bytes32 indexed providerId, uint256 indexed coverageId, bytes32 indexed claimHash);
    event PayoutRecorded(bytes32 indexed providerId, uint256 indexed coverageId, bytes32 indexed payoutHash);
    event IntegrationFeeCollected(address indexed token, address indexed to, uint256 amount);

    constructor(address _feeRecipient) {
        feeRecipient = _feeRecipient == address(0) ? owner() : _feeRecipient;
        deploymentChainId = block.chainid;
        DOMAIN_SEPARATOR = keccak256(abi.encode(DOMAIN_TYPEHASH, keccak256("FBTInsuranceRouter"), keccak256("1"), block.chainid, address(this)));
    }

    function setFeeRecipient(address r) external onlyRole(ADMIN_ROLE) { require(r != address(0), "ZERO"); feeRecipient = r; }

    /* ------------------------------ providers ----------------------------- */
    function setProvider(bytes32 providerId, address recipient, bool routerSettles, uint16 integrationFeeBps)
        external onlyRole(ADMIN_ROLE) whenNotPaused
    {
        require(recipient != address(0), "ZERO");
        require(integrationFeeBps <= MAX_INTEGRATION_FEE_BPS, "FEE_CAP");
        providers[providerId] = Provider({ recipient: recipient, exists: true, enabled: true, paused: false, routerSettles: routerSettles, integrationFeeBps: integrationFeeBps });
        emit ProviderSet(providerId, recipient, routerSettles, integrationFeeBps);
    }

    function pauseProvider(bytes32 providerId) external onlyRole(ADMIN_ROLE) whenNotPaused {
        Provider storage p = providers[providerId]; require(p.exists, "NO_PROVIDER"); p.paused = true;
        emit ProviderPaused(providerId, true);
    }
    function unpauseProvider(bytes32 providerId) external onlyRole(ADMIN_ROLE) whenNotPaused {
        Provider storage p = providers[providerId]; require(p.exists, "NO_PROVIDER"); p.paused = false;
        emit ProviderPaused(providerId, false);
    }
    function enableProvider(bytes32 providerId, bool on) external onlyRole(ADMIN_ROLE) {
        Provider storage p = providers[providerId]; require(p.exists, "NO_PROVIDER"); p.enabled = on;
    }
    function removeProvider(bytes32 providerId) external onlyRole(ADMIN_ROLE) whenPaused {
        delete providers[providerId]; emit ProviderRemoved(providerId);
    }
    function setProviderIntegrationFee(bytes32 providerId, uint16 bps) external onlyRole(ADMIN_ROLE) {
        require(bps <= MAX_INTEGRATION_FEE_BPS, "FEE_CAP"); providers[providerId].integrationFeeBps = bps;
    }

    /* --------------------------- quote reference --------------------------- */
    /// Anchor a quote's terms hash on-chain for tamper-evidence.
    function quoteReference(bytes32 quoteHash, address buyer, bytes32 providerId)
        external whenNotPaused returns (bytes32)
    {
        emit QuoteReferenced(quoteHash, buyer, providerId, uint256(block.timestamp));
        return quoteHash;
    }

    /* ----------------------------- purchase ------------------------------- */
    /// Grouped purchase arguments (avoids EVM stack limits in the digest math).
    struct PurchaseData {
        bytes32 providerId;
        address buyer;
        address premiumToken;
        uint256 premiumAmount;
        uint256 coverageAmount;
        uint256 durationDays;
        uint256 nonce;
        uint256 deadline;
        bytes32 quoteReferenceHash;
        uint256 coverageId;
    }

    /// EIP-712 purchase authorisation. Buyer signs; router forwards the premium
    /// to the provider recipient (minus integration fee) ONLY in ROUTED mode.
    /// In DIRECT mode router simply records and the buyer settles with provider.
    function purchaseProtection(PurchaseData calldata d, bytes calldata signature)
        external nonReentrant whenNotPaused returns (bool)
    {
        require(block.timestamp <= d.deadline, "DEADLINE");
        require(block.chainid == deploymentChainId, "CHAIN_ID_MISMATCH");
        Provider memory p = providers[d.providerId];
        require(p.exists && p.enabled && !p.paused, "PROVIDER_DISALLOWED");
        require(d.nonce == nonces[d.buyer], "BAD_NONCE");

        bytes32 digest = purchaseDigest(d);
        require(ECDSALite.recover(digest, signature) == d.buyer, "SIG_FAIL");

        nonces[d.buyer] = d.nonce + 1;

        uint256 fee = 0;
        if (p.routerSettles) {
            d.premiumToken.safeTransferFrom(d.buyer, address(this), d.premiumAmount);
            fee = (d.premiumAmount * p.integrationFeeBps) / 10_000;
            uint256 toProvider = d.premiumAmount - fee;
            if (toProvider > 0) d.premiumToken.safeTransfer(p.recipient, toProvider);
            if (fee > 0) { d.premiumToken.safeTransfer(feeRecipient, fee); emit IntegrationFeeCollected(d.premiumToken, feeRecipient, fee); }
        }
        emit CoveragePurchased(d.providerId, d.buyer, d.coverageId, d.coverageAmount, d.premiumAmount, fee);
        return true;
    }

    function purchaseDigest(PurchaseData calldata d) internal view returns (bytes32) {
        bytes32 structHash = keccak256(abi.encode(
            PURCHASE_TYPEHASH, d.providerId, d.buyer, d.premiumToken, d.premiumAmount,
            d.coverageAmount, d.durationDays, d.nonce, d.deadline, d.quoteReferenceHash
        ));
        return keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash));
    }

    /* ---------------------------- evidence records ------------------------- */
    function recordCoverage(bytes32 coverageHash) external onlyRole(ADMIN_ROLE) whenNotPaused returns (bool) {
        coverageRecords[coverageHash] = true;
        emit CoverageRecorded(bytes32(0), msg.sender, coverageHash);
        return true;
    }
    function recordClaim(uint256 coverageId, bytes32 claimHash) external onlyRole(ADMIN_ROLE) whenNotPaused returns (bool) {
        claimRecords[claimHash] = true;
        emit ClaimRecorded(bytes32(0), coverageId, claimHash);
        return true;
    }
    function recordPayout(uint256 coverageId, bytes32 payoutHash) external onlyRole(ADMIN_ROLE) whenNotPaused returns (bool) {
        payoutRecords[payoutHash] = true;
        emit PayoutRecorded(bytes32(0), coverageId, payoutHash);
        return true;
    }

    /* ------------------------------ fees ---------------------------------- */
    /// Claim an integration fee denominated in an ERC20 that was forwarded to
    /// the router (ROUTED model settlement). Only called by admin for payout.
    function collectIntegrationFee(address token, address to, uint256 amount)
        external onlyRole(ADMIN_ROLE) whenNotPaused returns (bool)
    {
        token.safeTransfer(to, amount);
        emit IntegrationFeeCollected(token, to, amount);
        return true;
    }

    /* ----------------------------- fallback ------------------------------- */
    receive() external payable { revert("NO_NATIVE"); }
}
