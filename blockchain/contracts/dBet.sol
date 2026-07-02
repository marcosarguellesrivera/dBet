// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ConfirmedOwner} from "@chainlink/contracts/src/v0.8/shared/access/ConfirmedOwner.sol";

/// @title DBet - Decentralized Sports Betting Platform
/// @notice This contract manages sports bets, match creation via Chainlink Automation, and result fetching via Chainlink Functions.
contract DBet is ConfirmedOwner {

    address public keystoneForwarder;

    modifier onlyForwarder() {
        require(msg.sender == keystoneForwarder, "Acceso denegado: Solo el Forwarder de CRE");
        _;
    }

    function setKeystoneForwarder(address _forwarder) external onlyOwner {
        keystoneForwarder = _forwarder;
    }

    uint256 public constant MINIMUM_BET = 0.01 ether;
    uint256 public constant CLAIM_DEADLINE = 7 days;
    uint256 public matchCounter;

    struct MatchData {
        uint256 startTime;
        uint256 endTime; 
        uint256 totalClaimed;
        uint32 apiMatchId;
        uint16 teamA;
        uint16 teamB;
        uint16 winningTeam; 
        bool isResolved;
        bool betsOpen;
        bool swept;
        mapping(uint256 => uint256) pools;
    }

    struct BetData {
        uint256 amount;
        uint16 selectedTeam; 
        bool hasClaimed;
    }
    
    mapping(uint256 => MatchData) public matches;
    mapping(bytes32 => bool) public matchExists;
    mapping(uint256 => mapping(address => BetData)) public userBets;

    event MatchCreated(uint256 indexed matchId, uint16 teamA, uint16 teamB, uint256 startTime);
    event BetPlaced(uint256 indexed matchId, address indexed user, uint16 team, uint256 amount);
    event MatchResolved(uint256 indexed matchId, uint16 winningTeam);
    event RewardClaimed(uint256 indexed matchId, address indexed user, uint256 rewardAmount);
    event FundsSwept(uint256 indexed matchId, uint256 amount);

    constructor() ConfirmedOwner(msg.sender) {}

    /// @notice Receives the packed matches from the CRE's workflow
    function receiveMatches(bytes calldata payload) external onlyForwarder {
        uint256[] memory packedMatches = abi.decode(payload, (uint256[]));

        for(uint i = 0; i < packedMatches.length; i++) {
            uint256 packed = packedMatches[i];

            uint16 teamB = uint16(packed);
            uint16 teamA = uint16(packed >> 16);
            uint32 apiMatchId = uint32(packed >> 32);
            uint256 startTime = uint256(uint64(packed >> 64));
            
            _createMatchInternal(apiMatchId, teamA, teamB, startTime);
        }
    }

    /// @notice Receives the official result of a match from the CRE's workflow
    function resolveMatch(uint256 matchId, uint16 winningTeam) external onlyForwarder {
        require(!matches[matchId].isResolved, "El partido ya se ha resuelto");
        require(winningTeam >= 1 && winningTeam <= 3, "El ganador no es valido");

        matches[matchId].isResolved = true;
        matches[matchId].winningTeam = winningTeam;
        matches[matchId].endTime = block.timestamp;
        
        emit MatchResolved(matchId, winningTeam);
    }

    /// @notice Allows the owner to manually create a match bypassing the oracle
    /// @param _apiMatchId ID of the match
    /// @param _teamA ID of the home team
    /// @param _teamB ID of the away team
    /// @param _startTime Unix timestamp of the match start
    function createMatch(uint32 _apiMatchId, uint16 _teamA, uint16 _teamB, uint256 _startTime) external onlyOwner {
        _createMatchInternal(_apiMatchId, _teamA, _teamB, _startTime);
    }

    /// @notice Internal logic to create a match and prevent duplicates
    /// @dev Uses keccak256 hash to verify uniqueness based on teams and start time
    function _createMatchInternal(uint32 _apiMatchId, uint16 _teamA, uint16 _teamB, uint256 _startTime) internal {
        require(_startTime > block.timestamp, "El inicio del partido debe ser futuro");

        bytes32 matchHash = keccak256(abi.encodePacked(_teamA, _teamB, _startTime));

        if (matchExists[matchHash]) {
            return;
        }
        matchExists[matchHash] = true;
        matchCounter++;
        
        MatchData storage newMatch = matches[matchCounter];
        newMatch.apiMatchId = _apiMatchId;
        newMatch.teamA = _teamA;
        newMatch.teamB = _teamB;
        newMatch.isResolved = false;
        newMatch.winningTeam = 0;
        newMatch.startTime = _startTime;

        emit MatchCreated(matchCounter, _teamA, _teamB, _startTime);
    }

    /// @notice Allows a user to place a bet on a specific team/outcome
    /// @param _matchId The internal ID of the match
    /// @param _team The selected outcome (1: Home, 2: Away, 3: Draw)
    function bet(uint256 _matchId, uint16 _team) external payable {
        require(block.timestamp < matches[_matchId].startTime, "El partido ha comenzado, no se aceptan apuestas");
        require(msg.value >= MINIMUM_BET, "Cantidad apostada muy baja");
        require(!matches[_matchId].isResolved, "El partido ya se ha resuelto");
        require(_team >= 1 && _team <= 3, "El ganador no es valido");
        require(userBets[_matchId][msg.sender].amount == 0, "Ya se ha apostado a este partido"); 
        
        matches[_matchId].pools[_team] += msg.value;

        userBets[_matchId][msg.sender] = BetData({
            amount: msg.value,
            selectedTeam: _team,
            hasClaimed: false
        });

        emit BetPlaced(_matchId, msg.sender, _team, msg.value);
    }

    /// @notice Allows a winning user to claim their proportional reward from the pool
    /// @param _matchId The internal ID of the resolved match
    function claimReward(uint256 _matchId) external {
        MatchData storage currentMatch = matches[_matchId];
        BetData storage userBet = userBets[_matchId][msg.sender];

        require(currentMatch.isResolved, "Partido sin resolver");
        require(userBet.amount > 0, "No se ha apostado a este partido");
        require(!userBet.hasClaimed, "Recompensa ya reclamada");
        require(userBet.selectedTeam == currentMatch.winningTeam, "No has obtenido ninguna recompensa");
        require(block.timestamp <= currentMatch.endTime + CLAIM_DEADLINE, "Ya no se pueden reclamar las recompensas");

        userBet.hasClaimed = true;

        uint256 totalMatchPool = currentMatch.pools[1] + currentMatch.pools[2] + currentMatch.pools[3];
        uint256 reward = (userBet.amount * totalMatchPool) / currentMatch.pools[currentMatch.winningTeam];

        currentMatch.totalClaimed += reward;

        (bool success, ) = payable(msg.sender).call{value: reward}("");
        require(success, "Transfer failed");

        emit RewardClaimed(_matchId, msg.sender, reward);
    }

    /// @notice Allows the owner to sweep any funds left unclaimed after the deadline
    /// @param _matchId The internal ID of the resolved match
    function sweepUnclaimedFunds(uint256 _matchId) external onlyOwner {
        MatchData storage currentMatch = matches[_matchId];

        require(currentMatch.isResolved, "El partido no se ha resuelto");
        require(!currentMatch.swept, "Fondos ya barridos");
        require(block.timestamp > currentMatch.endTime + CLAIM_DEADLINE, "El periodo de barrido no ha comenzado");

        uint256 totalMatchPool = currentMatch.pools[1] + currentMatch.pools[2] + currentMatch.pools[3];
        uint256 amount = totalMatchPool - currentMatch.totalClaimed;
        
        require(amount > 0, "No hay fondos que barrer");

        currentMatch.swept = true;

        (bool success, ) = payable(owner()).call{value: amount}("");
        require(success, "Fallo en el barrido de fondos");

        emit FundsSwept(_matchId, amount);
    }
}