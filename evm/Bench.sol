// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IArbitratorV2} from "kleros/arbitration/interfaces/IArbitratorV2.sol";
import {IArbitrableV2} from "kleros/arbitration/interfaces/IArbitrableV2.sol";

/**
 * @title Bench
 * @notice A Kleros IArbitratorV2 arbitrator whose court is Internet Court on GenLayer.
 *
 * Any contract written for Kleros v2 (IArbitrableV2) can name Bench as its arbitrator, unchanged. A dispute it creates
 * is ruled by an Intelligent Contract on GenLayer from the case's own text and the sources it cites, and the ruling is
 * delivered by that contract itself, through its Ghost on GenLayer Chain. No relayer, no key, no owner in between.
 *
 * Bench's extra data is the keccak256 of the case: the Kleros dispute template (JSON with the question and the
 * answers) the parties agreed on. Kleros publishes a template only as an event, after the dispute exists, so anybody
 * files the text with fileCase(), and Bench accepts it only if it hashes to what the dispute committed to. The court
 * always judges the agreed words.
 *
 * Rulings follow Kleros: 0 means the court refuses to arbitrate, 1..n picks an answer. Only the court rules, once,
 * within the dispute's number of choices. Delivery to the arbitrable is retried with execute() if it ever fails.
 * Arbitration is free here: arbitrationCost is 0, and no fee token is taken.
 */
contract Bench is IArbitratorV2 {
    struct Dispute {
        IArbitrableV2 arbitrable;
        uint64 createdAt;
        bool filed;
        bool ruled;
        bool executed;
        uint256 choices;
        bytes32 caseHash;
        uint256 ruling;
        bytes32 reason;
    }

    uint256 public constant MAX_CHOICES = 20;
    uint256 public constant MAX_CASE = 4000;

    address public immutable deployer;
    address public court;
    Dispute[] internal disputes;
    mapping(uint256 => bytes) internal cases;

    event CourtSet(address court);
    event CaseFiled(uint256 indexed disputeID, address indexed by);

    constructor() {
        deployer = msg.sender;
    }

    /// @notice Names the court, once. After this nobody, the deployer included, can change it.
    function setCourt(address _court) external {
        require(msg.sender == deployer, "Bench:only-deployer");
        require(court == address(0) && _court != address(0), "Bench:court-set");
        court = _court;
        emit CourtSet(_court);
    }

    // ------------------------------------------------------------------ IArbitratorV2

    function createDispute(uint256 _numberOfChoices, bytes calldata _extraData) external payable override returns (uint256) {
        require(msg.value == 0, "Bench:free");
        return _create(_numberOfChoices, _extraData);
    }

    function createDispute(uint256 _numberOfChoices, bytes calldata _extraData, IERC20, uint256 _feeAmount) external override returns (uint256) {
        require(_feeAmount == 0, "Bench:free");
        return _create(_numberOfChoices, _extraData);
    }

    function arbitrationCost(bytes calldata) external pure override returns (uint256) {
        return 0;
    }

    function arbitrationCost(bytes calldata, IERC20) external pure override returns (uint256) {
        return 0;
    }

    function currentRuling(uint256 _disputeID) external view override returns (uint256 ruling, bool tied, bool overridden) {
        return (disputes[_disputeID].ruling, false, false);
    }

    function _create(uint256 _choices, bytes calldata _extraData) internal returns (uint256 id) {
        require(_choices >= 1 && _choices <= MAX_CHOICES, "Bench:choices");
        require(_extraData.length == 32, "Bench:extra-data-is-case-hash");
        bytes32 caseHash = abi.decode(_extraData, (bytes32));
        require(caseHash != bytes32(0), "Bench:extra-data-is-case-hash");
        id = disputes.length;
        disputes.push(Dispute({ arbitrable: IArbitrableV2(msg.sender), createdAt: uint64(block.timestamp), filed: false, ruled: false,
            executed: false, choices: _choices, caseHash: caseHash, ruling: 0, reason: bytes32(0) }));
        emit DisputeCreation(id, IArbitrableV2(msg.sender));
    }

    // ------------------------------------------------------------------ the case and the ruling

    /// @notice Files a dispute's case text. Anybody may; it is accepted only if it hashes to the dispute's extra data.
    function fileCase(uint256 _disputeID, bytes calldata _case) external {
        Dispute storage d = disputes[_disputeID];
        require(!d.filed, "Bench:already-filed");
        require(_case.length > 0 && _case.length <= MAX_CASE, "Bench:case-length");
        require(keccak256(_case) == d.caseHash, "Bench:case-mismatch");
        d.filed = true;
        cases[_disputeID] = _case;
        emit CaseFiled(_disputeID, msg.sender);
    }

    /// @notice The court's ruling, delivered to the arbitrable in the same call.
    function rule(uint256 _disputeID, uint256 _ruling, bytes32 _reason) external {
        require(msg.sender == court, "Bench:only-court");
        Dispute storage d = disputes[_disputeID];
        require(d.filed, "Bench:no-case");
        require(!d.ruled, "Bench:already-ruled");
        require(_ruling <= d.choices, "Bench:ruling-out-of-range");
        d.ruled = true;
        d.ruling = _ruling;
        d.reason = _reason;
        emit Ruling(d.arbitrable, _disputeID, _ruling);
        _execute(_disputeID);
    }

    /// @notice Delivers a recorded ruling to the arbitrable, if it did not land when the court ruled. Open to anybody.
    function execute(uint256 _disputeID) external {
        Dispute storage d = disputes[_disputeID];
        require(d.ruled && !d.executed, "Bench:nothing-to-execute");
        _execute(_disputeID);
    }

    function _execute(uint256 _disputeID) internal {
        Dispute storage d = disputes[_disputeID];
        try d.arbitrable.rule(_disputeID, d.ruling) {
            d.executed = true;
            emit RulingExecuted(d.arbitrable, _disputeID, d.ruling);
        } catch {}
    }

    // ------------------------------------------------------------------ reads, flat for any caller

    function caseText(uint256 _disputeID) external view returns (string memory) {
        return string(cases[_disputeID]);
    }

    function facts(uint256 _disputeID)
        external
        view
        returns (address arbitrable, uint256 choices, bool filed, bool ruled, uint256 ruling, bool executed)
    {
        Dispute storage d = disputes[_disputeID];
        return (address(d.arbitrable), d.choices, d.filed, d.ruled, d.ruling, d.executed);
    }

    function disputeCount() external view returns (uint256) {
        return disputes.length;
    }
}
