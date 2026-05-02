// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract HackathonEscrow is ReentrancyGuard {
    using SafeERC20 for IERC20;

    address public owner;
    address public sponsor;
    IERC20 public immutable token;
    uint256 public entryFee;
    uint256 public deadline;
    bool public finalized;

    address[] public winners;
    mapping(address => uint256) public winnerShareBps;
    mapping(address => bool) public hasClaimed;
    uint256 public totalPrizeAtFinalize;

    mapping(address => bool) public hasJoined;
    address[] public participants;

    event Joined(address indexed participant);
    event Finalized(address[] winners, uint256[] sharesBps);
    event Claimed(address indexed winner, uint256 amount);
    event Funded(address indexed sponsor, uint256 amount);
    event Aborted(address indexed sponsor, uint256 amount);

    constructor(address _token, uint256 _entryFee, uint256 _deadline, address _owner, address _sponsor) {
        require(_token != address(0), "Invalid token");
        token = IERC20(_token);
        owner = _owner;
        sponsor = _sponsor;
        entryFee = _entryFee;
        deadline = _deadline;
    }

    function join() external {
        require(!finalized, "Hackathon finalized");
        require(!hasJoined[msg.sender], "Already joined");

        if (entryFee > 0) {
            token.safeTransferFrom(msg.sender, address(this), entryFee);
        }

        hasJoined[msg.sender] = true;
        participants.push(msg.sender);

        emit Joined(msg.sender);
    }

    function fund(uint256 amount) external {
        require(!finalized, "Hackathon finalized");
        require(amount > 0, "Amount must be positive");

        token.safeTransferFrom(msg.sender, address(this), amount);
        emit Funded(msg.sender, amount);
    }

    function finalize(address[] calldata _winners, uint256[] calldata _sharesBps) external {
        require(msg.sender == owner, "Not owner");
        require(!finalized, "Already finalized");
        require(_winners.length > 0, "No winners");
        require(_winners.length <= 20, "Too many winners");
        require(_winners.length == _sharesBps.length, "Length mismatch");

        uint256 totalBps;
        for (uint256 i = 0; i < _winners.length; i++) {
            require(winnerShareBps[_winners[i]] == 0, "Duplicate winner");
            require(_sharesBps[i] > 0, "Zero share");
            winnerShareBps[_winners[i]] = _sharesBps[i];
            totalBps += _sharesBps[i];
        }
        require(totalBps == 10000, "Shares must sum to 10000");

        winners = _winners;
        totalPrizeAtFinalize = token.balanceOf(address(this));
        finalized = true;

        emit Finalized(_winners, _sharesBps);
    }

    function claim() external nonReentrant {
        require(finalized, "Not finalized");
        uint256 shareBps = winnerShareBps[msg.sender];
        require(shareBps > 0, "Not a winner");
        require(!hasClaimed[msg.sender], "Already claimed");

        hasClaimed[msg.sender] = true;
        uint256 amount = (totalPrizeAtFinalize * shareBps) / 10000;

        token.safeTransfer(msg.sender, amount);
        emit Claimed(msg.sender, amount);
    }

    function abort() external nonReentrant {
        require(msg.sender == owner, "Not owner");
        require(!finalized, "Already finalized");
        require(block.timestamp > deadline, "Hackathon not expired");

        finalized = true;
        uint256 amount = token.balanceOf(address(this));

        token.safeTransfer(sponsor, amount);
        emit Aborted(sponsor, amount);
    }

    function prizePool() external view returns (uint256) {
        return token.balanceOf(address(this));
    }

    function getParticipants() external view returns (address[] memory) {
        return participants;
    }

    function getWinners() external view returns (address[] memory) {
        return winners;
    }

    function getWinnerShare(address _winner) external view returns (uint256) {
        return winnerShareBps[_winner];
    }

    function winnerCount() external view returns (uint256) {
        return winners.length;
    }
}
