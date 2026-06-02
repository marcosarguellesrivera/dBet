// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {FunctionsClient} from "@chainlink/contracts/src/v0.8/functions/v1_0_0/FunctionsClient.sol";
import {FunctionsRequest} from "@chainlink/contracts/src/v0.8/functions/v1_0_0/libraries/FunctionsRequest.sol";
import {ConfirmedOwner} from "@chainlink/contracts/src/v0.8/shared/access/ConfirmedOwner.sol";
import {AutomationCompatibleInterface} from "@chainlink/contracts/src/v0.8/automation/AutomationCompatible.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

/// @title DBet - Decentralized Sports Betting Platform
/// @notice This contract manages sports bets, match creation via Chainlink Automation, and result fetching via Chainlink Functions.
contract DBet is FunctionsClient, ConfirmedOwner, AutomationCompatibleInterface {

    using FunctionsRequest for FunctionsRequest.Request;
    bytes32 public donId;
    uint64 public subscriptionId;
    uint256 public updateInterval;

    uint32 public gasLimit = 300000;
    
    uint256 public lastTimeStamp;
    string public fetchMatchesSourceCode;
    string public fetchResultSourceCode;

    uint256 public constant MINIMUM_BET = 0.01 ether;
    uint256 public constant CLAIM_DEADLINE = 7 days;
    uint256 public matchCounter;
    uint256 public nextMatchToResolve = 1;

    enum RequestType { ResolveMatch, CreateMatch }
    mapping(bytes32 => RequestType) public requestTypes;

    struct MatchData {
        uint256 apiMatchId;
        uint16 teamA;
        uint16 teamB;
        bool isResolved;
        uint16 winningTeam; 
        bool betsOpen;
        uint256 startTime;
        uint256 endTime; 
        bool swept;
        uint256 totalClaimed;
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
    mapping(bytes32 => uint256) public requestToMatchId;

    event MatchCreated(uint256 indexed matchId, uint16 teamA, uint16 teamB, uint256 startTime);
    event BetPlaced(uint256 indexed matchId, address indexed user, uint16 team, uint256 amount);
    event MatchResolved(uint256 indexed matchId, uint16 winningTeam);
    event RewardClaimed(uint256 indexed matchId, address indexed user, uint256 rewardAmount);
    event FundsSwept(uint256 indexed matchId, uint256 amount);
    event MatchResultRequested(bytes32 indexed requestId, uint256 indexed matchId);
    event MatchesCreationRequested(bytes32 indexed requestId);
    event ResponseError(bytes32 indexed requestId, bytes err);

    /// @notice Initializes the contract with Chainlink parameters
    /// @param _router The Chainlink Functions Router address
    /// @param _donId The Decentralized Oracle Network ID
    /// @param _subscriptionId The billing subscription ID for Chainlink Functions
    /// @param _updateInterval The time interval (in seconds) for Chainlink Automation
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

    /// @notice Updates the JavaScript source code used to create matches
    /// @param _sourceCode The new JavaScript string
    function setFetchMatchesSourceCode(string memory _sourceCode) external onlyOwner {
        fetchMatchesSourceCode = _sourceCode;
    }

    /// @notice Updates the JavaScript source code used to fill match results
    /// @param _sourceCode The new JavaScript string
    function setFetchResultSourceCode(string memory _sourceCode) external onlyOwner {
        fetchResultSourceCode = _sourceCode;
    }

    /// @notice Updates the time interval for automation
    /// @param _interval New interval in seconds
    function setUpdateInterval(uint256 _interval) external onlyOwner {
        updateInterval = _interval;
    }

    /// @notice Used by Chainlink Automation to check if upkeep is needed
    /// @param - Ignored calldata
    /// @return upkeepNeeded Boolean indicating if it's time to run performUpkeep
    /// @return - Empty bytes
    function checkUpkeep(bytes calldata) external view override returns (bool upkeepNeeded, bytes memory) {
        for (uint256 i = nextMatchToResolve; i <= matchCounter; i++) {
            if (!matches[i].isResolved && block.timestamp > (matches[i].startTime + 2 hours)) {
                return (true, abi.encode(uint8(1), i)); 
            }
        }

        if ((block.timestamp - lastTimeStamp) > updateInterval) {
            return (true, abi.encode(uint8(0), uint256(0)));
        }

        return (false, "");
    }

    /// @notice Executed by Chainlink Automation when checkUpkeep returns true
    /// @dev Sends a request to the Oracle to fetch the latest matches
    /// @param performData Data needed to perform the request
    function performUpkeep(bytes calldata performData) external override {
        (uint8 actionType, uint256 matchIdToResolve) = abi.decode(performData, (uint8, uint256));

        if (actionType == 1) {
            MatchData storage pendingMatch = matches[matchIdToResolve];
            require(!pendingMatch.isResolved, "Match already resolved");
            
            FunctionsRequest.Request memory req;
            req.initializeRequestForInlineJavaScript(fetchResultSourceCode);
            
            string[] memory args = new string[](1);
            args[0] = Strings.toString(pendingMatch.apiMatchId); 
            req.setArgs(args);

            bytes32 requestId = _sendRequest(req.encodeCBOR(), subscriptionId, gasLimit, donId);
            requestToMatchId[requestId] = matchIdToResolve;
            requestTypes[requestId] = RequestType.ResolveMatch;
            
            emit MatchResultRequested(requestId, matchIdToResolve);

        } else if (actionType == 0) {
            require((block.timestamp - lastTimeStamp) > updateInterval, "Not time yet");
            lastTimeStamp = block.timestamp;

            FunctionsRequest.Request memory req;
            req.initializeRequestForInlineJavaScript(fetchMatchesSourceCode);
            
            bytes32 requestId = _sendRequest(req.encodeCBOR(), subscriptionId, gasLimit, donId);
            requestTypes[requestId] = RequestType.CreateMatch;
            
            emit MatchesCreationRequested(requestId);
        }
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
        require(_startTime > block.timestamp, "Match start time must be in the future");

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

    /// @notice Callback function invoked by the Chainlink Router to return the API data
    /// @dev Handles both match creation (array of packed bits) and match resolution
    /// @param requestId The ID of the request being fulfilled
    /// @param response The bytes data returned by the Oracle script
    /// @param err Any error messages returned by the Oracle
    function fulfillRequest(bytes32 requestId, bytes memory response, bytes memory err) internal override {
        if (err.length > 0) {
            emit ResponseError(requestId, err);
            return;
        }

        RequestType reqType = requestTypes[requestId];

        if (reqType == RequestType.ResolveMatch) {
            uint256 matchId = requestToMatchId[requestId];
            require(!matches[matchId].isResolved, "Match already resolved");

            uint256 winningTeamUint = abi.decode(response, (uint256));
            uint16 winningTeam = uint16(winningTeamUint);

            require(winningTeam >= 1 && winningTeam <= 3, "Invalid winner selection");

            matches[matchId].isResolved = true;
            matches[matchId].winningTeam = winningTeam;
            matches[matchId].endTime = block.timestamp;
            
            emit MatchResolved(matchId, winningTeam);
            if(matchId == nextMatchToResolve) {
                nextMatchToResolve++;
            } 
        } else if (reqType == RequestType.CreateMatch) {
            uint256[] memory packedMatches = abi.decode(response, (uint256[]));

            for(uint i = 0; i < packedMatches.length; i++) {
                uint256 packed = packedMatches[i];

                uint16 teamB = uint16(packed);
                uint16 teamA = uint16(packed >> 16);
                uint32 apiMatchId = uint32(packed >> 32);
                uint256 startTime = uint256(uint64(packed >> 64));
                
                _createMatchInternal(apiMatchId, teamA, teamB, startTime);
            }
        }
    }

    /// @notice Allows a user to place a bet on a specific team/outcome
    /// @param _matchId The internal ID of the match
    /// @param _team The selected outcome (1: Home, 2: Away, 3: Draw)
    function bet(uint256 _matchId, uint16 _team) external payable {
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

    /// @notice Allows a winning user to claim their proportional reward from the pool
    /// @param _matchId The internal ID of the resolved match
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

    /// @notice Allows the owner to sweep any funds left unclaimed after the deadline
    /// @param _matchId The internal ID of the resolved match
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