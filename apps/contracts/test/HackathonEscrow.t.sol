// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "forge-std/Test.sol";
import "../src/HackathonEscrow.sol";
import "../src/mocks/MockUSDC.sol";

contract HackathonEscrowTest is Test {
    MockUSDC internal usdc;
    HackathonEscrow internal escrow;

    address internal owner = address(this);
    address internal sponsor = address(0x99);
    address internal alice = address(0x1);
    address internal bob = address(0x2);
    uint256 internal constant ENTRY_FEE = 10e18;
    uint256 internal constant DEADLINE = 1000;

    function setUp() public {
        vm.warp(100);

        usdc = new MockUSDC("Mock USDC", "USDC", 18);
        escrow = new HackathonEscrow(address(usdc), ENTRY_FEE, DEADLINE, owner, sponsor);

        usdc.mint(alice, 1_000e18);
        usdc.mint(bob, 1_000e18);
        usdc.mint(sponsor, 1_000e18);
    }

    function _approve(address user, uint256 amount) internal {
        vm.prank(user);
        usdc.approve(address(escrow), amount);
    }

    function test_constructor_sets_token_config() public view {
        assertEq(address(escrow.token()), address(usdc));
        assertEq(escrow.entryFee(), ENTRY_FEE);
        assertEq(escrow.deadline(), DEADLINE);
        assertEq(escrow.owner(), owner);
        assertEq(escrow.sponsor(), sponsor);
    }

    function test_join_transfers_entry_fee() public {
        _approve(alice, ENTRY_FEE);

        vm.prank(alice);
        escrow.join();

        assertTrue(escrow.hasJoined(alice));
        assertEq(escrow.getParticipants().length, 1);
        assertEq(usdc.balanceOf(address(escrow)), ENTRY_FEE);
        assertEq(usdc.balanceOf(alice), 990e18);
    }

    function test_join_reverts_without_allowance() public {
        vm.prank(alice);
        vm.expectRevert();
        escrow.join();
    }

    function test_join_reverts_already_joined() public {
        _approve(alice, ENTRY_FEE * 2);

        vm.prank(alice);
        escrow.join();

        vm.prank(alice);
        vm.expectRevert("Already joined");
        escrow.join();
    }

    function test_fund_transfers_tokens_into_escrow() public {
        uint256 amount = 250e18;
        _approve(sponsor, amount);

        vm.prank(sponsor);
        escrow.fund(amount);

        assertEq(usdc.balanceOf(address(escrow)), amount);
        assertEq(escrow.prizePool(), amount);
    }

    function test_finalize_snapshots_current_prize_pool() public {
        _approve(sponsor, 200e18);
        vm.prank(sponsor);
        escrow.fund(200e18);

        _approve(alice, ENTRY_FEE);
        vm.prank(alice);
        escrow.join();

        address[] memory winners = new address[](1);
        winners[0] = alice;
        uint256[] memory shares = new uint256[](1);
        shares[0] = 10000;

        escrow.finalize(winners, shares);

        assertTrue(escrow.finalized());
        assertEq(escrow.totalPrizeAtFinalize(), 210e18);
    }

    function test_claim_distributes_token_shares() public {
        _approve(sponsor, 200e18);
        vm.prank(sponsor);
        escrow.fund(200e18);

        _approve(alice, ENTRY_FEE);
        vm.prank(alice);
        escrow.join();

        _approve(bob, ENTRY_FEE);
        vm.prank(bob);
        escrow.join();

        address[] memory winners = new address[](2);
        winners[0] = alice;
        winners[1] = bob;
        uint256[] memory shares = new uint256[](2);
        shares[0] = 6000;
        shares[1] = 4000;

        escrow.finalize(winners, shares);

        uint256 totalPrize = escrow.totalPrizeAtFinalize();
        uint256 aliceBefore = usdc.balanceOf(alice);
        uint256 bobBefore = usdc.balanceOf(bob);

        vm.prank(alice);
        escrow.claim();
        vm.prank(bob);
        escrow.claim();

        assertEq(usdc.balanceOf(alice), aliceBefore + ((totalPrize * 6000) / 10000));
        assertEq(usdc.balanceOf(bob), bobBefore + ((totalPrize * 4000) / 10000));
        assertEq(usdc.balanceOf(address(escrow)), 0);
    }

    function test_abort_returns_remaining_tokens_to_sponsor() public {
        _approve(sponsor, 300e18);
        vm.prank(sponsor);
        escrow.fund(300e18);

        uint256 sponsorBefore = usdc.balanceOf(sponsor);

        vm.warp(DEADLINE + 1);
        escrow.abort();

        assertTrue(escrow.finalized());
        assertEq(usdc.balanceOf(address(escrow)), 0);
        assertEq(usdc.balanceOf(sponsor), sponsorBefore + 300e18);
    }
}
