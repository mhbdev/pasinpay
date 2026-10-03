// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {PasinPayEscrow} from "../src/PasinPayEscrow.sol";

contract Deploy is Script {
    function run() external returns (PasinPayEscrow escrow) {
        address usdg = vm.envAddress("PASINPAY_USDG_ADDRESS");
        address attestor = vm.envAddress("PASINPAY_ATTESTOR_ADDRESS");
        address owner = vm.envAddress("PASINPAY_OWNER_ADDRESS");
        address feeTreasury = vm.envAddress("PASINPAY_FEE_TREASURY_ADDRESS");
        vm.startBroadcast();
        escrow = new PasinPayEscrow(usdg, attestor, owner, feeTreasury);
        vm.stopBroadcast();
    }
}
