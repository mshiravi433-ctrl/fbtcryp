// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ICollectiveAccessController} from "./interfaces/ICollective.sol";

/**
 * Shared fail-closed circuit breaker for every Collective vault and the
 * ExecutionRouter. Pausing stops deposits, investments and swaps; it does not
 * seize assets or disable income claims / already-funded withdrawal payouts.
 * No rescue, sweep, or arbitrary-token transfer function exists here.
 */
contract EmergencyModule {
    ICollectiveAccessController public immutable accessController;
    bool public paused;
    uint64 public incidentNumber;

    struct Incident {
        bytes32 code;
        bytes32 evidenceHash;
        uint64 startedAt;
        bool resolved;
    }

    mapping(uint64 => Incident) public incidents;

    event EmergencyPaused(uint64 indexed incidentNumber, bytes32 indexed code, bytes32 evidenceHash, address indexed caller);
    event EmergencyResumed(uint64 indexed incidentNumber, address indexed caller);
    event IncidentResolved(uint64 indexed incidentNumber, bytes32 evidenceHash, address indexed caller);

    error NotGuardian();
    error NotGovernor();
    error AlreadyPaused();
    error NotPaused();
    error IncidentNotResolved();
    error NotCurrentIncident();

    constructor(ICollectiveAccessController access_) {
        require(address(access_) != address(0), "ZERO_ACCESS");
        accessController = access_;
    }

    function pause(bytes32 code, bytes32 evidenceHash) external {
        if (!accessController.hasRole(accessController.GUARDIAN_ROLE(), msg.sender)) revert NotGuardian();
        if (paused) revert AlreadyPaused();
        paused = true;
        uint64 id = ++incidentNumber;
        incidents[id] = Incident({code: code, evidenceHash: evidenceHash, startedAt: uint64(block.timestamp), resolved: false});
        emit EmergencyPaused(id, code, evidenceHash, msg.sender);
    }

    function resolveIncident(uint64 id, bytes32 evidenceHash) external {
        if (!accessController.hasRole(accessController.GOVERNOR_ROLE(), msg.sender)) revert NotGovernor();
        if (!paused || id != incidentNumber) revert NotCurrentIncident();
        Incident storage incident = incidents[id];
        if (incident.startedAt == 0) revert NotCurrentIncident();
        incident.resolved = true;
        incident.evidenceHash = evidenceHash;
        emit IncidentResolved(id, evidenceHash, msg.sender);
    }

    function resume(uint64 id) external {
        if (!accessController.hasRole(accessController.GOVERNOR_ROLE(), msg.sender)) revert NotGovernor();
        if (!paused) revert NotPaused();
        if (id != incidentNumber) revert NotCurrentIncident();
        Incident storage incident = incidents[id];
        if (!incident.resolved) revert IncidentNotResolved();
        paused = false;
        emit EmergencyResumed(id, msg.sender);
    }
}
