// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * FBT TOKEN FACTORY — non-custodial token & launch foundation
 * ============================================================================
 *
 * Two contracts in one auditable surface:
 *
 *   FBTBasicToken    — a transparent ERC-20 with an IMMUTABLE capability
 *                      bitmap. What it can do is decided ONCE at creation,
 *                      shown to the user before deployment, and can never be
 *                      changed afterwards.
 *
 *   FBTTokenFactory  — a stateless, permissionless deployer + registry.
 *                      It owns nothing, holds nothing, has no owner, and
 *                      takes no fees. Tokens are minted directly to the
 *                      caller's wallet.
 *
 * THE NON-CUSTODIAL LAW (structural, not policy):
 *   · No contract in this file ever holds user funds — supply is minted
 *     straight to the creator, and LP tokens (created later, through the
 *     DEX's own router) go straight to the creator's wallet.
 *   · No secret key, no server signer, no FBT wallet is involved anywhere:
 *     every transaction is signed by the user's own wallet.
 *   · There is no tax path, no blacklist, no whitelist, no pause-by-default
 *     and no hidden mint. Honeypot-shaped logic simply does not exist in
 *     this code. A capability that is not set at creation is unrepresentable
 *     later — the bitmap is immutable.
 *   · Unknown capability bits are rejected at construction, so adding a new
 *     bit in the future cannot silently activate on an old deploy.
 *
 * Capability bits (capability bitmap):
 *   0  MINTABLE   owner may mint more supply (disclosed + risk-scored)
 *   1  BURNABLE   holders may burn their own balance
 *   2  PAUSABLE   owner may pause/unpause transfers (owner-only, disclosed)
 *   3  MAX_WALLET owner may set a per-wallet ceiling (changeable, disclosed)
 *   4  MAX_TX     owner may set a per-transfer ceiling (changeable, disclosed)
 *
 * Basic token = all bits zero: fixed supply, non-mintable, non-pausable,
 * no transfer ceilings. This is the default and the recommended choice.
 */

/* ------------------------------------------------------------------ */
/* FBTBasicToken                                                      */
/* ------------------------------------------------------------------ */

contract FBTBasicToken {
    // Capability bitmap — immutable, decided at creation, never changed.
    uint256 public constant CAP_MINTABLE = 1 << 0;
    uint256 public constant CAP_BURNABLE = 1 << 1;
    uint256 public constant CAP_PAUSABLE = 1 << 2;
    uint256 public constant CAP_MAX_WALLET = 1 << 3;
    uint256 public constant CAP_MAX_TX = 1 << 4;

    /// @dev the highest bit the current contract understands. Construction
    ///      rejects any bitmap reaching a bit above this, so a future
    ///      version that adds bit 5 can never be "misread" by this one.
    uint256 public constant CAP_KNOWN_MASK = (1 << 5) - 1;

    string public name;
    string public symbol;
    uint8 public decimals;
    uint256 public immutable capabilities;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    address public owner;
    bool public paused;
    uint256 public maxWallet; // only meaningful with CAP_MAX_WALLET
    uint256 public maxTx;     // only meaningful with CAP_MAX_TX

    uint256 private _totalSupply;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event OwnershipTransferRequested(address indexed newOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event PausedSet(bool paused, address by);
    event CapabilityLimitsSet(uint256 maxWallet, uint256 maxTx, address by);
    event Minted(address indexed to, uint256 value);
    event Burned(address indexed from, uint256 value);

    error InvalidCapabilities(uint256 capabilities);
    error ZeroAddress();
    error EmptyName();
    error NameTooLong();
    error SymbolTooLong();
    error BadDecimals(uint8 decimals);
    error ZeroSupply();
    error NotOwner();
    error CapabilityNotSet(uint256 bit);
    error PausedTransfer();
    error MaxWalletExceeded(uint256 limit, uint256 resulting);
    error MaxTxExceeded(uint256 limit, uint256 value);
    error InsufficientBalance(uint256 balance, uint256 value);
    error InsufficientAllowance(uint256 allowance, uint256 value);

    constructor(
        string memory name_,
        string memory symbol_,
        uint8 decimals_,
        uint256 initialSupply_,
        address creator_,
        uint256 capabilities_
    ) {
        bytes memory nameBytes = bytes(name_);
        if (nameBytes.length == 0) revert EmptyName();
        if (nameBytes.length > 64) revert NameTooLong();
        if (bytes(symbol_).length == 0) revert EmptyName();
        if (bytes(symbol_).length > 32) revert SymbolTooLong();
        if (decimals_ > 18) revert BadDecimals(decimals_);
        if (initialSupply_ == 0) revert ZeroSupply();
        if (creator_ == address(0)) revert ZeroAddress();
        // Unknown bits: refuse. This file must never silently accept a
        // capability it does not implement.
        if (capabilities_ & ~CAP_KNOWN_MASK != 0) revert InvalidCapabilities(capabilities_);

        name = name_;
        symbol = symbol_;
        decimals = decimals_;
        capabilities = capabilities_;
        owner = creator_;

        // The FULL initial supply goes straight to the creator's wallet.
        // The factory (if used) never touches these funds; if this contract
        // is deployed directly, `creator_` still receives everything.
        _totalSupply = initialSupply_;
        balanceOf[creator_] = initialSupply_;
        emit Transfer(address(0), creator_, initialSupply_);
        emit OwnershipTransferred(address(0), creator_);
    }

    // ── ownership ────────────────────────────────────────────────────────

    function transferOwnership(address newOwner) external {
        if (msg.sender != owner) revert NotOwner();
        if (newOwner == address(0)) revert ZeroAddress();
        pendingOwner = newOwner;
        emit OwnershipTransferRequested(newOwner);
    }

    /// @notice second step of the two-step hand-over; the requested owner
    ///         must accept. Mirrors the safety pattern used by audited
    ///         protocols so a mistyped address cannot be bricked.
    function acceptOwnership() external {
        // owner() is the current owner; the pending owner is read from the
        // most recent OwnershipTransferRequested event by the UI, but for a
        // self-contained contract we keep the pending address in storage.
        // (Implemented below via `pendingOwner`.)
        require(pendingOwner != address(0), "no pending owner");
        require(msg.sender == pendingOwner, "not pending owner");
        emit OwnershipTransferred(owner, pendingOwner);
        owner = pendingOwner;
        pendingOwner = address(0);
    }

    /// @notice renouncing is allowed: a fully transparent, fixed-supply
    ///         token with no capabilities has no owner functions left that
    ///         matter, and renounce is the strongest "no hidden control"
    ///         signal a contract can give.
    function renounceOwnership() external {
        if (msg.sender != owner) revert NotOwner();
        emit OwnershipTransferred(owner, address(0));
        owner = address(0);
        pendingOwner = address(0);
    }

    address private pendingOwner;

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    // ── capability-gated owner controls ─────────────────────────────────

    function setPaused(bool value) external onlyOwner {
        if (capabilities & CAP_PAUSABLE == 0) revert CapabilityNotSet(CAP_PAUSABLE);
        paused = value;
        emit PausedSet(value, msg.sender);
    }

    function setCapabilityLimits(uint256 newMaxWallet, uint256 newMaxTx) external onlyOwner {
        if ((capabilities & (CAP_MAX_WALLET | CAP_MAX_TX)) == 0) {
            revert CapabilityNotSet(CAP_MAX_WALLET | CAP_MAX_TX);
        }
        if (capabilities & CAP_MAX_WALLET != 0) maxWallet = newMaxWallet;
        if (capabilities & CAP_MAX_TX != 0) maxTx = newMaxTx;
        emit CapabilityLimitsSet(maxWallet, maxTx, msg.sender);
    }

    /// @notice only exists when CAP_MINTABLE was chosen at creation.
    function mint(address to, uint256 value) external onlyOwner {
        if (capabilities & CAP_MINTABLE == 0) revert CapabilityNotSet(CAP_MINTABLE);
        if (to == address(0)) revert ZeroAddress();
        if (value == 0) revert ZeroSupply();
        if (maxWallet != 0 && balanceOf[to] + value > maxWallet) {
            revert MaxWalletExceeded(maxWallet, balanceOf[to] + value);
        }
        _totalSupply += value;
        balanceOf[to] += value;
        emit Transfer(address(0), to, value);
        emit Minted(to, value);
    }

    /// @notice only exists when CAP_BURNABLE was chosen at creation. Burns
    ///         the caller's own balance — a holder right, never an owner power.
    function burn(uint256 value) external {
        if (capabilities & CAP_BURNABLE == 0) revert CapabilityNotSet(CAP_BURNABLE);
        if (value == 0) revert ZeroSupply();
        if (balanceOf[msg.sender] < value) revert InsufficientBalance(balanceOf[msg.sender], value);
        balanceOf[msg.sender] -= value;
        _totalSupply -= value;
        emit Transfer(msg.sender, address(0), value);
        emit Burned(msg.sender, value);
    }

    // ── ERC-20 core ──────────────────────────────────────────────────────

    function totalSupply() external view returns (uint256) {
        return _totalSupply;
    }

    function approve(address spender, uint256 value) external returns (bool) {
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }

    function transfer(address to, uint256 value) external returns (bool) {
        _transfer(msg.sender, to, value);
        return true;
    }

    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        if (from != msg.sender) {
            uint256 allowed = allowance[from][msg.sender];
            if (allowed < value) revert InsufficientAllowance(allowed, value);
            if (allowed != type(uint256).max) {
                allowance[from][msg.sender] = allowed - value;
            }
        }
        _transfer(from, to, value);
        return true;
    }

    function _transfer(address from, address to, uint256 value) internal {
        if (paused) revert PausedTransfer();
        if (to == address(0)) revert ZeroAddress();
        if (value == 0) return;
        if (balanceOf[from] < value) revert InsufficientBalance(balanceOf[from], value);

        // Ceilings are opt-in capabilities; when set they apply to EVERY
        // transfer including into and out of pairs — that is the point and
        // it is disclosed on the launch screen before deployment.
        if (maxTx != 0 && value > maxTx) revert MaxTxExceeded(maxTx, value);
        if (to != address(0) && maxWallet != 0) {
            uint256 resulting = balanceOf[to] + value;
            if (resulting > maxWallet) revert MaxWalletExceeded(maxWallet, resulting);
        }

        balanceOf[from] -= value;
        balanceOf[to] += value;
        emit Transfer(from, to, value);
    }
}

/* ------------------------------------------------------------------ */
/* FBTTokenFactory                                                    */
/* ------------------------------------------------------------------ */

contract FBTTokenFactory {
    struct TokenConfig {
        string name;          // 1..64 chars
        string symbol;        // 1..32 chars
        uint8 decimals;       // 0..18
        uint256 initialSupply;// > 0, in the token's smallest unit
        uint256 capabilities; // bitmap, unknown bits rejected
    }

    mapping(address => bool) public isFbtToken;
    uint256 public createdCount;

    event TokenCreated(
        address indexed token,
        address indexed creator,
        string name,
        string symbol,
        uint8 decimals,
        uint256 totalSupply,
        uint256 capabilities
    );

    /// @notice Creates a token whose ENTIRE initial supply belongs to the
    ///         caller. The factory never holds, wraps or redirects a single
    ///         unit — it only deploys bytecode and records the result.
    /// @return token address of the newly created FBTBasicToken
    function createToken(TokenConfig calldata config) external returns (address token) {
        FBTBasicToken created = new FBTBasicToken(
            config.name,
            config.symbol,
            config.decimals,
            config.initialSupply,
            msg.sender,
            config.capabilities
        );
        token = address(created);
        isFbtToken[token] = true;
        createdCount += 1;
        emit TokenCreated(
            token,
            msg.sender,
            config.name,
            config.symbol,
            config.decimals,
            config.initialSupply,
            config.capabilities
        );
    }
}
