// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import "@openzeppelin/contracts/access/AccessControl.sol";

interface IContainerToken {
    function ownerOf(uint256 tokenId) external view returns (address);
}

/**
 * @title ContainerJourney
 * @notice TESTNET ONLY. PRE-AUDIT. PROOF-OF-CONCEPT. Not deployed for live value.
 *
 *         Append-only traceability ledger for GCN container tokens: where a container
 *         has been, when, on whose word, and how far that adds up to.
 *
 * @dev WHAT THIS CONTRACT PROVES AND WHAT IT DOES NOT
 *
 *      It proves: that a named observer, holding OBSERVER_ROLE at the time, committed
 *      to a position and a timestamp, in this order, and has not been able to alter or
 *      remove that commitment since. Append-only is the whole point - there is no edit
 *      and no delete, and a mistake is corrected by appending a correction that leaves
 *      the original visible.
 *
 *      It does NOT prove: that the container physically existed, that it held what the
 *      paperwork says, or that it was ever at the coordinates claimed. A chain cannot
 *      observe a steel box. Only the evidence tier on each waypoint tells you how the
 *      position was obtained, and only TIER1_CONTAINER_TELEMETRY observed the container
 *      itself. Everything else observed a ship or a document.
 *
 *      Distance is a LOWER BOUND: the sum of great-circle hops between attested
 *      positions. Ships do not sail great circles and the log is sparse, so the real
 *      track is always longer. distanceCaveat() keeps that statement on-chain, next to
 *      the number, so no interface can quote the figure without it.
 */
contract ContainerJourney is AccessControl {
    bytes32 public constant OBSERVER_ROLE = keccak256("OBSERVER_ROLE");

    enum EventType {
        GateOut,        // left an inland depot or shipper site
        LoadedVessel,   // lifted aboard; position is the vessel's from here
        VesselPosition, // position while aboard, inherited from the vessel
        Transshipped,   // moved between vessels at a hub
        Discharged,     // lifted ashore
        GateIn,         // entered a depot or consignee site
        CustomsHold,
        Delivered
    }

    enum Mode { Sea, Road, Rail, Air, Yard }

    /// Strongest first. Only ContainerTelemetry observes the container; the rest observe
    /// a ship or a piece of paper, and the ledger says so rather than flattening them.
    enum Tier { ContainerTelemetry, CarrierEdi, VesselAis, Manual }

    struct Waypoint {
        int32 latE5;           // WGS-84 latitude  x 1e5 (~1.1 m resolution)
        int32 lonE5;           // WGS-84 longitude x 1e5
        uint40 at;             // observation time, unix seconds
        uint32 segmentMeters;  // great-circle metres from the previous waypoint
        uint8 eventType;
        uint8 mode;
        uint8 tier;
        bytes5 unlocode;       // UN/LOCODE when the event happened at a port, else 0x0
        address observer;      // who committed this, at the time they held the role
        bytes32 evidenceHash;  // hash of the AIS record, EDI message or document behind it
    }

    struct Correction {
        uint32 waypointIndex;
        uint40 at;
        address by;
        bytes32 evidenceHash;
        string reason;
    }

    IContainerToken public immutable containerToken;

    mapping(uint256 => Waypoint[]) private _journey;
    mapping(uint256 => Correction[]) private _corrections;
    mapping(uint256 => uint64) public cumulativeMeters;
    mapping(uint256 => uint32) public containerLevelObservations; // count of Tier.ContainerTelemetry
    mapping(uint256 => bytes5[]) private _portCalls;

    /// Plausibility ceiling per Mode, in millimetres/second. A segment that would need a
    /// faster conveyance than this is rejected: it is a typo or a fabricated leg, and
    /// either way it does not belong in a record anyone is meant to rely on.
    mapping(uint8 => uint32) public maxSpeedMmps;

    event WaypointAppended(
        uint256 indexed tokenId,
        uint256 indexed index,
        EventType eventType,
        Tier tier,
        bytes5 unlocode,
        int32 latE5,
        int32 lonE5,
        uint40 at,
        uint32 segmentMeters,
        uint64 cumulativeMeters
    );
    event CorrectionAppended(uint256 indexed tokenId, uint32 waypointIndex, address by, string reason);
    event MaxSpeedUpdated(uint8 mode, uint32 mmps);

    constructor(address token, address admin) {
        require(token != address(0) && admin != address(0), "zero address");
        containerToken = IContainerToken(token);
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(OBSERVER_ROLE, admin);
        maxSpeedMmps[uint8(Mode.Sea)] = 15500;   // ~30 kn
        maxSpeedMmps[uint8(Mode.Road)] = 35000;  // ~126 km/h
        maxSpeedMmps[uint8(Mode.Rail)] = 45000;  // ~162 km/h
        maxSpeedMmps[uint8(Mode.Air)] = 300000;  // ~1080 km/h
        maxSpeedMmps[uint8(Mode.Yard)] = 3000;   // terminal handling
    }

    // --------------------------------------------------------------------- append

    function appendWaypoint(
        uint256 tokenId,
        EventType eventType,
        Mode mode,
        Tier tier,
        bytes5 unlocode,
        int32 latE5,
        int32 lonE5,
        uint40 at,
        uint32 segmentMeters,
        bytes32 evidenceHash
    ) external onlyRole(OBSERVER_ROLE) returns (uint256 index) {
        containerToken.ownerOf(tokenId); // reverts if the container token does not exist
        require(latE5 >= -9000000 && latE5 <= 9000000, "latitude out of range");
        require(lonE5 >= -18000000 && lonE5 <= 18000000, "longitude out of range");
        require(at > 0 && at <= block.timestamp + 1 hours, "timestamp in the future");
        require(evidenceHash != bytes32(0), "evidence hash required");

        Waypoint[] storage j = _journey[tokenId];
        if (j.length == 0) {
            require(segmentMeters == 0, "first waypoint has no segment");
        } else {
            Waypoint storage prev = j[j.length - 1];
            require(at > prev.at, "waypoint not after previous");
            _checkGeometry(prev.latE5, prev.lonE5, latE5, lonE5, segmentMeters);
            uint256 dt = uint256(at) - uint256(prev.at);
            uint256 ceiling = maxSpeedMmps[uint8(mode)];
            require(ceiling > 0, "mode has no speed ceiling");
            require(uint256(segmentMeters) * 1000 <= ceiling * dt, "implausible speed for mode");
        }

        index = j.length;
        j.push(Waypoint({
            latE5: latE5,
            lonE5: lonE5,
            at: at,
            segmentMeters: segmentMeters,
            eventType: uint8(eventType),
            mode: uint8(mode),
            tier: uint8(tier),
            unlocode: unlocode,
            observer: msg.sender,
            evidenceHash: evidenceHash
        }));

        cumulativeMeters[tokenId] += segmentMeters;
        if (tier == Tier.ContainerTelemetry) containerLevelObservations[tokenId] += 1;
        if (unlocode != bytes5(0)) _portCalls[tokenId].push(unlocode);

        _emitAppended(tokenId, index);
    }

    /// @dev Emitted from storage rather than from locals: the append path carries too many
    ///      live variables for the legacy codegen's stack otherwise ("stack too deep").
    function _emitAppended(uint256 tokenId, uint256 index) private {
        Waypoint storage w = _journey[tokenId][index];
        emit WaypointAppended(
            tokenId,
            index,
            EventType(w.eventType),
            Tier(w.tier),
            w.unlocode,
            w.latE5,
            w.lonE5,
            w.at,
            w.segmentMeters,
            cumulativeMeters[tokenId]
        );
    }

    /**
     * @notice Record that an earlier waypoint is wrong. The original stays exactly where
     *         it is. A traceability ledger that lets history be tidied up is not evidence
     *         of anything, so corrections accumulate instead of overwriting.
     */
    function appendCorrection(uint256 tokenId, uint32 waypointIndex, string calldata reason, bytes32 evidenceHash)
        external
        onlyRole(OBSERVER_ROLE)
    {
        require(waypointIndex < _journey[tokenId].length, "no such waypoint");
        require(bytes(reason).length > 0 && bytes(reason).length <= 200, "reason 1-200 chars");
        _corrections[tokenId].push(Correction({
            waypointIndex: waypointIndex,
            at: uint40(block.timestamp),
            by: msg.sender,
            evidenceHash: evidenceHash,
            reason: reason
        }));
        emit CorrectionAppended(tokenId, waypointIndex, msg.sender, reason);
    }

    /**
     * @dev On-chain plausibility band for a claimed great-circle distance, without trig.
     *      One degree of latitude is ~111,320 m everywhere. One degree of longitude is
     *      that at the equator and less elsewhere, so:
     *        lower bound = |dLat| only          (ignoring any east-west movement)
     *        upper bound = |dLat| + |dLon|      (longitude at its widest, the equator)
     *      The true haversine value always sits inside that band. 1% slack each side
     *      absorbs the radius constant and rounding. This catches a transposed sign or a
     *      mistyped coordinate; it is not a substitute for recomputing haversine off-chain.
     */
    function _checkGeometry(int32 lat1, int32 lon1, int32 lat2, int32 lon2, uint32 claimedMeters) internal pure {
        uint256 dLat = _abs(int256(lat2) - int256(lat1));
        uint256 dLon = _abs(int256(lon2) - int256(lon1));
        if (dLon > 18000000) dLon = 36000000 - dLon; // shorter way across the antimeridian
        uint256 lower = (dLat * 11132) / 10000;
        uint256 upper = ((dLat + dLon) * 11132) / 10000;
        require(uint256(claimedMeters) * 100 >= lower * 99, "claimed distance below geometric minimum");
        require(uint256(claimedMeters) * 100 <= upper * 101 + 100, "claimed distance above geometric maximum");
    }

    function _abs(int256 x) internal pure returns (uint256) {
        return x >= 0 ? uint256(x) : uint256(-x);
    }

    function setMaxSpeed(Mode mode, uint32 mmps) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(mmps > 0, "ceiling must be positive");
        maxSpeedMmps[uint8(mode)] = mmps;
        emit MaxSpeedUpdated(uint8(mode), mmps);
    }

    // ---------------------------------------------------------------------- views

    function waypointCount(uint256 tokenId) external view returns (uint256) {
        return _journey[tokenId].length;
    }

    function waypointAt(uint256 tokenId, uint256 index) external view returns (Waypoint memory) {
        require(index < _journey[tokenId].length, "no such waypoint");
        return _journey[tokenId][index];
    }

    function portCalls(uint256 tokenId) external view returns (bytes5[] memory) {
        return _portCalls[tokenId];
    }

    function corrections(uint256 tokenId) external view returns (Correction[] memory) {
        return _corrections[tokenId];
    }

    /// @return count waypoints logged
    /// @return meters attested great-circle total - a LOWER BOUND, see distanceCaveat()
    /// @return firstAt first observation time
    /// @return lastAt last observation time
    /// @return lastLatE5 last attested latitude x 1e5
    /// @return lastLonE5 last attested longitude x 1e5
    /// @return containerObserved waypoints that observed the container itself, not a ship
    function journeySummary(uint256 tokenId)
        external
        view
        returns (
            uint256 count,
            uint64 meters,
            uint40 firstAt,
            uint40 lastAt,
            int32 lastLatE5,
            int32 lastLonE5,
            uint32 containerObserved
        )
    {
        Waypoint[] storage j = _journey[tokenId];
        count = j.length;
        meters = cumulativeMeters[tokenId];
        containerObserved = containerLevelObservations[tokenId];
        if (count > 0) {
            firstAt = j[0].at;
            Waypoint storage last = j[count - 1];
            lastAt = last.at;
            lastLatE5 = last.latE5;
            lastLonE5 = last.lonE5;
        }
    }

    /// @notice The caveat travels with the number, on-chain, so no interface can quote
    ///         cumulativeMeters as "distance travelled" and claim it came from us.
    function distanceCaveat() external pure returns (string memory) {
        return
            "Attested great-circle distance. LOWER BOUND: summed arcs between attested positions only; "
            "real sailed track is longer. Not proof the container existed or was at these coordinates - "
            "see each waypoint's evidence tier.";
    }

    /// @notice False means nothing in this journey observed the container itself.
    function hasContainerLevelEvidence(uint256 tokenId) external view returns (bool) {
        return containerLevelObservations[tokenId] > 0;
    }
}
