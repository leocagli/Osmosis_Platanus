// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "./HackathonEscrow.sol";

contract HackathonFactory {
    address public owner;
    address[] public hackathons;

    event HackathonCreated(address indexed escrow, address indexed token, uint256 entryFee, uint256 deadline);

    constructor() {
        owner = msg.sender;
    }

    function createHackathon(address _token, uint256 _entryFee, uint256 _deadline) external returns (address) {
        require(msg.sender == owner, "Not owner");
        HackathonEscrow escrow = new HackathonEscrow(_token, _entryFee, _deadline, msg.sender, msg.sender);
        hackathons.push(address(escrow));
        emit HackathonCreated(address(escrow), _token, _entryFee, _deadline);
        return address(escrow);
    }

    function getHackathons() external view returns (address[] memory) {
        return hackathons;
    }

    function hackathonCount() external view returns (uint256) {
        return hackathons.length;
    }
}
