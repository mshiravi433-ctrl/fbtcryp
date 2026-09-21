// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title FBTProtocolConfig
/// @notice Central protocol governance and security limits for FBT Intent OS
contract FBTProtocolConfig {
    string public constant PROTOCOL_VERSION = "1.0.0";
    uint256 public constant MAX_FEE_CEILING_BPS = 100; // 1% absolute hard cap

    address public owner;
    address public feeRecipient;
    uint256 public protocolFeeBps; // default protocol fee bps
    bool public paused;

    mapping(address => bool) public authorizedSettlers;

    event ProtocolPaused(address indexed operator);
    event ProtocolUnpaused(address indexed operator);
    event FeeConfigUpdated(uint256 newFeeBps, address newFeeRecipient);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event SettlerAuthorized(address indexed settler, bool authorized);

    error Unauthorized();
    error ProtocolIsPaused();
    error FeeExceedsCeiling(uint256 proposed, uint256 ceiling);
    error ZeroAddress();

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert ProtocolIsPaused();
        _;
    }

    constructor(address _feeRecipient, uint256 _feeBps) {
        if (_feeRecipient == address(0)) revert ZeroAddress();
        if (_feeBps > MAX_FEE_CEILING_BPS) revert FeeExceedsCeiling(_feeBps, MAX_FEE_CEILING_BPS);

        owner = msg.sender;
        feeRecipient = _feeRecipient;
        protocolFeeBps = _feeBps;
    }

    function setPaused(bool _paused) external onlyOwner {
        paused = _paused;
        if (_paused) {
            emit ProtocolPaused(msg.sender);
        } else {
            emit ProtocolUnpaused(msg.sender);
        }
    }

    function setFeeConfig(uint256 _newFeeBps, address _newRecipient) external onlyOwner {
        if (_newRecipient == address(0)) revert ZeroAddress();
        if (_newFeeBps > MAX_FEE_CEILING_BPS) revert FeeExceedsCeiling(_newFeeBps, MAX_FEE_CEILING_BPS);

        protocolFeeBps = _newFeeBps;
        feeRecipient = _newRecipient;
        emit FeeConfigUpdated(_newFeeBps, _newRecipient);
    }

    function setSettlerAuthorization(address settler, bool authorized) external onlyOwner {
        if (settler == address(0)) revert ZeroAddress();
        authorizedSettlers[settler] = authorized;
        emit SettlerAuthorized(settler, authorized);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }
}
