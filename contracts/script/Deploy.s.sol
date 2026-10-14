// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {PasinPayEscrow} from "../src/PasinPayEscrow.sol";

contract Deploy is Script {
    function run() external returns (PasinPayEscrow escrow) {
        address token = vm.envOr(
            "PASINPAY_TOKEN_ADDRESS",
            vm.envOr("PASINPAY_USDG_ADDRESS", address(0))
        );
        require(token != address(0), "TOKEN_ADDRESS_REQUIRED");
        address attestor = vm.envAddress("PASINPAY_ATTESTOR_ADDRESS");
        address owner = vm.envAddress("PASINPAY_OWNER_ADDRESS");
        address feeTreasury = vm.envAddress("PASINPAY_FEE_TREASURY_ADDRESS");
        vm.startBroadcast();
        escrow = new PasinPayEscrow(token, attestor, owner, feeTreasury);
        vm.stopBroadcast();
    }
}
