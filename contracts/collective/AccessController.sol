// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/**
 * FBT AI Collective role registry.
 *
 * The only role administrator is the governor (normally a multisig). The AI
 * service has no on-chain role. A Keeper can call narrowly scoped vault and
 * router functions, but cannot grant roles, change policy, or transfer assets
 * to arbitrary destinations. Critical role changes should use a multisig;
 * RiskController separately timelocks allowlist and limit changes.
 */
contract AccessController is AccessControl {
    bytes32 public constant GOVERNOR_ROLE = keccak256("COLLECTIVE_GOVERNOR_ROLE");
    bytes32 public constant GUARDIAN_ROLE = keccak256("COLLECTIVE_GUARDIAN_ROLE");
    bytes32 public constant KEEPER_ROLE = keccak256("COLLECTIVE_KEEPER_ROLE");
    bytes32 public constant FACTORY_ROLE = keccak256("COLLECTIVE_FACTORY_ROLE");
    bytes32 public constant EXECUTION_ROUTER_ROLE = keccak256("COLLECTIVE_EXECUTION_ROUTER_ROLE");
    bytes32 public constant VAULT_ROLE = keccak256("COLLECTIVE_VAULT_ROLE");

    uint48 public constant GOVERNOR_TRANSFER_DELAY = 2 days;

    address public governor;
    address public pendingGovernor;
    uint48 public pendingGovernorAt;

    event GovernorTransferQueued(address indexed currentGovernor, address indexed pendingGovernor, uint48 acceptAfter);
    event GovernorTransferred(address indexed previousGovernor, address indexed newGovernor);

    error ZeroAddress();
    error NotGovernor();
    error DefaultAdminImmutable();
    error NoPendingGovernor();
    error GovernorTransferNotReady(uint48 acceptAfter);
    error InvalidRole();

    modifier onlyGovernor() {
        if (msg.sender != governor) revert NotGovernor();
        _;
    }

    constructor(address governor_, address guardian_) {
        if (governor_ == address(0) || guardian_ == address(0)) revert ZeroAddress();
        governor = governor_;
        // The contract itself is the immutable AccessControl admin. Public
        // grant/revoke entry points are overridden below to require governor.
        _grantRole(DEFAULT_ADMIN_ROLE, address(this));
        _grantRole(GOVERNOR_ROLE, governor_);
        _grantRole(GUARDIAN_ROLE, guardian_);
    }

    function grantRole(bytes32 role, address account) public override onlyGovernor {
        if (role == DEFAULT_ADMIN_ROLE || role == GOVERNOR_ROLE || role == GUARDIAN_ROLE || account == address(0)) revert InvalidRole();
        _grantRole(role, account);
    }

    function revokeRole(bytes32 role, address account) public override onlyGovernor {
        if (role == DEFAULT_ADMIN_ROLE) revert DefaultAdminImmutable();
        // Governor and guardian changes must use their dedicated lifecycle
        // functions so emergency authority and policy control cannot silently
        // disappear through a generic AccessControl call.
        if (role == GOVERNOR_ROLE || role == GUARDIAN_ROLE) revert InvalidRole();
        if (account == address(0)) revert ZeroAddress();
        _revokeRole(role, account);
    }

    function registerVault(address vault) external {
        if (!hasRole(FACTORY_ROLE, msg.sender)) revert InvalidRole();
        if (vault == address(0) || vault.code.length == 0) revert ZeroAddress();
        _grantRole(VAULT_ROLE, vault);
    }

    function setGuardian(address nextGuardian) external onlyGovernor {
        if (nextGuardian == address(0)) revert ZeroAddress();
        address current = getRoleMemberCompat(GUARDIAN_ROLE);
        if (current != address(0)) _revokeRole(GUARDIAN_ROLE, current);
        _grantRole(GUARDIAN_ROLE, nextGuardian);
    }

    /** Start a two-step, delayed governor transfer. */
    function queueGovernorTransfer(address nextGovernor) external onlyGovernor {
        if (nextGovernor == address(0) || nextGovernor == governor) revert ZeroAddress();
        pendingGovernor = nextGovernor;
        pendingGovernorAt = uint48(block.timestamp + GOVERNOR_TRANSFER_DELAY);
        emit GovernorTransferQueued(governor, nextGovernor, pendingGovernorAt);
    }

    function acceptGovernorTransfer() external {
        if (msg.sender != pendingGovernor || pendingGovernor == address(0)) revert NoPendingGovernor();
        if (block.timestamp < pendingGovernorAt) revert GovernorTransferNotReady(pendingGovernorAt);
        address previous = governor;
        address next = pendingGovernor;
        governor = next;
        pendingGovernor = address(0);
        pendingGovernorAt = 0;
        _revokeRole(GOVERNOR_ROLE, previous);
        _grantRole(GOVERNOR_ROLE, next);
        emit GovernorTransferred(previous, next);
    }

    /**
     * A minimal local member lookup used only by setGuardian(). AccessControl
     * intentionally does not enumerate role members; keep guardian rotation
     * explicit instead of silently retaining old guardians.
     */
    address public guardian;

    function getRoleMemberCompat(bytes32 role) internal view returns (address) {
        if (role == GUARDIAN_ROLE) return guardian;
        return address(0);
    }

    function _grantRole(bytes32 role, address account) internal override returns (bool) {
        bool changed = super._grantRole(role, account);
        if (changed && role == GUARDIAN_ROLE) guardian = account;
        return changed;
    }

    function _revokeRole(bytes32 role, address account) internal override returns (bool) {
        bool changed = super._revokeRole(role, account);
        if (changed && role == GUARDIAN_ROLE && guardian == account) guardian = address(0);
        return changed;
    }
}
