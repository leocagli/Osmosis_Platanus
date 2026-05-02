// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "forge-std/Test.sol";
import "../src/HackathonFactory.sol";
import "../src/HackathonEscrow.sol";
import "../src/mocks/MockUSDC.sol";

contract HackathonFactoryTest is Test {
    HackathonFactory internal factory;
    MockUSDC internal usdc;

    address internal owner = address(this);
    address internal alice = address(0x1);
    uint256 internal constant DEADLINE = 1000;

    function setUp() public {
        vm.warp(100);
        factory = new HackathonFactory();
        usdc = new MockUSDC("Mock USDC", "USDC", 18);
    }

    function test_create_hackathon() public {
        address escrowAddr = factory.createHackathon(address(usdc), 0, DEADLINE);

        assertEq(factory.hackathonCount(), 1);
        assertEq(factory.hackathons(0), escrowAddr);

        HackathonEscrow escrow = HackathonEscrow(escrowAddr);
        assertEq(escrow.owner(), owner);
        assertEq(escrow.sponsor(), owner);
        assertEq(address(escrow.token()), address(usdc));
        assertEq(escrow.entryFee(), 0);
        assertEq(escrow.deadline(), DEADLINE);
    }

    function test_create_revert_not_owner() public {
        vm.prank(alice);
        vm.expectRevert("Not owner");
        factory.createHackathon(address(usdc), 0, DEADLINE);
    }

    function test_created_escrow_supports_funding_and_claims() public {
        address escrowAddr = factory.createHackathon(address(usdc), 0, DEADLINE);
        HackathonEscrow escrow = HackathonEscrow(escrowAddr);

        usdc.mint(owner, 500e18);
        usdc.approve(address(escrow), 200e18);
        escrow.fund(200e18);

        address[] memory winners = new address[](1);
        winners[0] = alice;
        uint256[] memory shares = new uint256[](1);
        shares[0] = 10000;

        escrow.finalize(winners, shares);

        uint256 beforeBalance = usdc.balanceOf(alice);
        vm.prank(alice);
        escrow.claim();

        assertEq(usdc.balanceOf(alice), beforeBalance + 200e18);
    }
}
