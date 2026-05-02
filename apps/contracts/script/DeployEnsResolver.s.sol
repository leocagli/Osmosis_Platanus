// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";
import {OffchainResolver} from "../src/ens/OffchainResolver.sol";

contract DeployEnsResolver is Script {
    function run() external {
        string memory gatewayUrl = vm.envString("ENS_GATEWAY_URL");
        address signer = vm.envAddress("ENS_SIGNER_ADDRESS");

        address[] memory signers = new address[](1);
        signers[0] = signer;

        vm.startBroadcast();
        OffchainResolver resolver = new OffchainResolver(gatewayUrl, signers);
        vm.stopBroadcast();

        console.log("OffchainResolver deployed at:", address(resolver));
        console.log("Gateway URL:", gatewayUrl);
        console.log("Signer:", signer);
    }
}
