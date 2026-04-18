// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {FunctionsClient} from "@chainlink/contracts/src/v0.8/functions/v1_0_0/FunctionsClient.sol";
import {FunctionsRequest} from "@chainlink/contracts/src/v0.8/functions/v1_0_0/libraries/FunctionsRequest.sol";
import {ConfirmedOwner} from "@chainlink/contracts/src/v0.8/shared/access/ConfirmedOwner.sol";
import {AutomationCompatibleInterface} from "@chainlink/contracts/src/v0.8/automation/AutomationCompatible.sol";

contract DBet is FunctionsClient, ConfirmedOwner, AutomationCompatibleInterface {

    using FunctionsRequest for FunctionsRequest.Request;
    bytes32 public donId;
    uint64 public subscriptionId;
    uint32 public gasLimit = 300000;

    uint256 public updateInterval = 7 days;
    uint256 public lastTimeStamp;
    string public fetchMatchesSourceCode;

    uint256 public constant MINIMUM_BET = 0.01 ether;
    uint256 public constant CLAIM_DEADLINE = 7 days;
    uint256 public matchCounter;

    enum RequestType { ResolveMatch, CreateMatch }
    mapping(bytes32 => RequestType) public requestTypes;

    struct MatchData {
        uint8 teamA;
        uint8 teamB;
        bool isResolved;
        uint8 winningTeam; 
        bool betsOpen;
        uint256 startTime;
        uint256 endTime; 
        bool swept;
        uint256 totalClaimed;
        mapping(uint256 => uint256) pools;
    }

    struct BetData {
        uint256 amount;
        uint8 selectedTeam; 
        bool hasClaimed;
    }
    
    mapping(uint256 => MatchData) public matches;
    mapping(uint256 => mapping(address => BetData)) public userBets;
    mapping(bytes32 => uint256) public requestToMatchId;

    event MatchCreated(uint256 indexed matchId, uint8 teamA, uint8 teamB, uint256 startTime);
    event BetPlaced(uint256 indexed matchId, address indexed user, uint8 team, uint256 amount);
    event MatchResolved(uint256 indexed matchId, uint8 winningTeam);
    event RewardClaimed(uint256 indexed matchId, address indexed user, uint256 rewardAmount);
    event FundsSwept(uint256 indexed matchId, uint256 amount);
    event MatchResultRequested(bytes32 indexed requestId, uint256 indexed matchId);
    event MatchesCreationRequested(bytes32 indexed requestId);
    event ResponseError(bytes32 indexed requestId, bytes err);

    constructor(
        address _router,
        bytes32 _donId,
        uint64 _subscriptionId,
        uint256 _updateInterval
    ) FunctionsClient(_router) ConfirmedOwner(msg.sender) {
        donId = _donId;
        subscriptionId = _subscriptionId;
        updateInterval = _updateInterval;
        lastTimeStamp = block.timestamp;
    }

    function setFetchMatchesSourceCode(string memory _sourceCode) external onlyOwner {
        fetchMatchesSourceCode = _sourceCode;
    }

    function setUpdateInterval(uint256 _interval) external onlyOwner {
        updateInterval = _interval;
    }

    function checkUpkeep(bytes calldata) external view override returns (bool upkeepNeeded, bytes memory) {
        upkeepNeeded = (block.timestamp - lastTimeStamp) > updateInterval;
        return (upkeepNeeded, "");
    }

    function performUpkeep(bytes calldata) external override {
        require((block.timestamp - lastTimeStamp) > updateInterval, "Not time yet");
        lastTimeStamp = block.timestamp; // Reseteamos el reloj

        FunctionsRequest.Request memory req;
        req.initializeRequestForInlineJavaScript(fetchMatchesSourceCode);
        
        bytes32 requestId = _sendRequest(req.encodeCBOR(), subscriptionId, gasLimit, donId);

        requestTypes[requestId] = RequestType.CreateMatch;
        
        emit MatchesCreationRequested(requestId);
    }

    // Creación manual por si el Automation falla o quieres añadir uno rápido
    function createMatch(uint8 _teamA, uint8 _teamB, uint256 _startTime) external onlyOwner {
        _createMatchInternal(_teamA, _teamB, _startTime);
    }

    function _createMatchInternal(uint8 _teamA, uint8 _teamB, uint256 _startTime) internal {
        require(_startTime > block.timestamp, "Match start time must be in the future");

        matchCounter++;
        
        MatchData storage newMatch = matches[matchCounter];
        newMatch.teamA = _teamA;
        newMatch.teamB = _teamB;
        newMatch.isResolved = false;
        newMatch.winningTeam = 0;
        newMatch.startTime = _startTime;

        emit MatchCreated(matchCounter, _teamA, _teamB, _startTime);
    }

    function requestMatchResult(uint256 _matchId, string memory _sourceCode, string memory _apiMatchId) external onlyOwner returns (bytes32) {
        require(!matches[_matchId].isResolved, "Match already resolved");
        require(block.timestamp > matches[_matchId].startTime, "Match has not started yet");

        FunctionsRequest.Request memory req;
        req.initializeRequestForInlineJavaScript(_sourceCode);
        
        string[] memory args = new string[](1);
        args[0] = _apiMatchId;
        req.setArgs(args);

        bytes32 requestId = _sendRequest(req.encodeCBOR(), subscriptionId, gasLimit, donId);

        requestToMatchId[requestId] = _matchId;
        requestTypes[requestId] = RequestType.ResolveMatch;

        emit MatchResultRequested(requestId, _matchId);
        
        return requestId;
    }

    function fulfillRequest(bytes32 requestId, bytes memory response, bytes memory err) internal override {
        if (err.length > 0) {
            emit ResponseError(requestId, err);
            return;
        }

        RequestType reqType = requestTypes[requestId];

        if (reqType == RequestType.ResolveMatch) {
            // Lógica original: Resolver un partido existente
            uint256 matchId = requestToMatchId[requestId];
            require(!matches[matchId].isResolved, "Match already resolved");

            uint256 winningTeamUint = abi.decode(response, (uint256));
            uint8 winningTeam = uint8(winningTeamUint);

            require(winningTeam >= 1 && winningTeam <= 3, "Invalid winner selection");

            matches[matchId].isResolved = true;
            matches[matchId].winningTeam = winningTeam;
            matches[matchId].endTime = block.timestamp;
            
            emit MatchResolved(matchId, winningTeam);

        } else if (reqType == RequestType.CreateMatch) {
            uint256 packed = abi.decode(response, (uint256));

            uint8 teamB = uint8(packed);
            uint8 teamA = uint8(packed >> 8);
            uint256 startTime = uint256(uint64(packed >> 16));
            
            _createMatchInternal(teamA, teamB, startTime);
        }
    }

    function bet(uint256 _matchId, uint8 _team) external payable {
        require(block.timestamp < matches[_matchId].startTime, "Match has started, betting is closed");
        require(msg.value >= MINIMUM_BET, "Bet amount too low");
        require(!matches[_matchId].isResolved, "Match already resolved");
        require(_team >= 1 && _team <= 3, "Invalid team selection");
        require(userBets[_matchId][msg.sender].amount == 0, "Bet already placed"); 
        
        matches[_matchId].pools[_team] += msg.value;

        userBets[_matchId][msg.sender] = BetData({
            amount: msg.value,
            selectedTeam: _team,
            hasClaimed: false
        });

        emit BetPlaced(_matchId, msg.sender, _team, msg.value);
    }

    function claimReward(uint256 _matchId) external {
        MatchData storage currentMatch = matches[_matchId];
        BetData storage userBet = userBets[_matchId][msg.sender];

        require(currentMatch.isResolved, "Match is not resolved yet");
        require(userBet.amount > 0, "No bet placed");
        require(!userBet.hasClaimed, "Reward already claimed");
        require(userBet.selectedTeam == currentMatch.winningTeam, "You did not win");
        require(block.timestamp <= currentMatch.endTime + CLAIM_DEADLINE, "Claim period ended");

        userBet.hasClaimed = true;

        uint256 totalMatchPool = currentMatch.pools[1] + currentMatch.pools[2] + currentMatch.pools[3];
        uint256 reward = (userBet.amount * totalMatchPool) / currentMatch.pools[currentMatch.winningTeam];

        currentMatch.totalClaimed += reward;

        (bool success, ) = payable(msg.sender).call{value: reward}("");
        require(success, "Transfer failed");

        emit RewardClaimed(_matchId, msg.sender, reward);
    }

    function sweepUnclaimedFunds(uint256 _matchId) external onlyOwner {
        MatchData storage currentMatch = matches[_matchId];

        require(currentMatch.isResolved, "Match is not resolved yet");
        require(!currentMatch.swept, "Funds already swept for this match");
        require(block.timestamp > currentMatch.endTime + CLAIM_DEADLINE, "Claim deadline not reached yet");

        uint256 totalMatchPool = currentMatch.pools[1] + currentMatch.pools[2] + currentMatch.pools[3];
        uint256 amount = totalMatchPool - currentMatch.totalClaimed;
        
        require(amount > 0, "No funds left to sweep");

        currentMatch.swept = true;

        (bool success, ) = payable(owner()).call{value: amount}("");
        require(success, "Sweep transfer failed");

        emit FundsSwept(_matchId, amount);
    }
}