// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {Script, console} from "forge-std/Script.sol";
import {HackathonEscrow} from "../src/HackathonEscrow.sol";
import {HackathonFactory} from "../src/HackathonFactory.sol";
import {MockUSDC} from "../src/mocks/MockUSDC.sol";

contract DeployHackathonEscrow is Script {
    function run() external returns (HackathonEscrow escrow) {
        address token = vm.envAddress("USDC_ADDRESS");
        uint256 entryFee = vm.envOr("ENTRY_FEE_UNITS", uint256(0));
        uint256 deadline = vm.envUint("DEADLINE_UNIX");

        vm.startBroadcast();
        escrow = new HackathonEscrow(token, entryFee, deadline, msg.sender, msg.sender);
        vm.stopBroadcast();

        console.log("HackathonEscrow deployed at:", address(escrow));
        console.log("USDC token:", token);
        console.log("Entry fee (token units):", entryFee);
        console.log("Deadline (unix):", deadline);
    }
}

contract DeployFactory is Script {
    function run() external returns (HackathonFactory factory) {
        vm.startBroadcast();
        factory = new HackathonFactory();
        vm.stopBroadcast();

        console.log("HackathonFactory deployed at:", address(factory));
    }
}

contract DeployMockUSDC is Script {
    function run() external returns (MockUSDC token) {
        string memory name = vm.envOr("MOCK_USDC_NAME", string("Mock USDC"));
        string memory symbol = vm.envOr("MOCK_USDC_SYMBOL", string("USDC"));
        uint8 decimals = uint8(vm.envOr("MOCK_USDC_DECIMALS", uint256(6)));

        vm.startBroadcast();
        token = new MockUSDC(name, symbol, decimals);
        vm.stopBroadcast();

        console.log("MockUSDC deployed at:", address(token));
        console.log("Name:", name);
        console.log("Symbol:", symbol);
        console.log("Decimals:", uint256(decimals));
    }
}

contract MintMockUSDC is Script {
    function run() external {
        address token = vm.envAddress("USDC_ADDRESS");
        address recipient = vm.envAddress("MINT_TO");
        uint256 amount = vm.envUint("MINT_AMOUNT_UNITS");

        vm.startBroadcast();
        MockUSDC(token).mint(recipient, amount);
        vm.stopBroadcast();

        console.log("Minted MockUSDC");
        console.log("Token:", token);
        console.log("Recipient:", recipient);
        console.log("Amount (units):", amount);
    }
}
