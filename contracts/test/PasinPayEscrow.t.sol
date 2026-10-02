// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {PasinPayEscrow} from "../src/PasinPayEscrow.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockUSDG is ERC20 {
    constructor() ERC20("Global Dollar", "USDG") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract PasinPayEscrowTest is Test {
    bytes32 internal constant CLAIM_TYPEHASH = keccak256(
        "Claim(uint256 bountyId,bytes32 repositoryHash,uint32 issueNumber,uint256 prNumber,bytes32 commitHash,address recipient,uint64 expiresAt,uint256 nonce)"
    );
    bytes32 internal constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    uint256 internal constant ATTESTOR_PK = 0xA771;
    uint256 internal constant AMOUNT = 500 ether;

    MockUSDG internal token;
    PasinPayEscrow internal escrow;
    address internal creator = address(0xC0FFEE);
    address internal claimant = address(0xB0B);
    address internal attacker = address(0xBAD);
    address internal attestor;

    function setUp() external {
        token = new MockUSDG();
        attestor = vm.addr(ATTESTOR_PK);
        escrow = new PasinPayEscrow(address(token), attestor, creator);
        token.mint(creator, 10_000 ether);
        vm.prank(creator);
        token.approve(address(escrow), type(uint256).max);
    }

    function testCreateAndFund() external {
        uint256 id = _createFund();
        (address bountyCreator, uint128 amount,,,,,,,, PasinPayEscrow.Status status,) = escrow.bounties(id);
        assertEq(bountyCreator, creator);
        assertEq(amount, AMOUNT);
        assertEq(uint8(status), uint8(PasinPayEscrow.Status.Funded));
        assertEq(token.balanceOf(address(escrow)), AMOUNT);
    }

    function testCancelOpenBounty() external {
        vm.prank(creator);
        uint256 id = escrow.createBounty(keccak256("repo"), 1, uint64(block.timestamp + 1 days), 60);
        vm.prank(creator);
        escrow.cancelBounty(id);
        (,,,,,,,,, PasinPayEscrow.Status status,) = escrow.bounties(id);
        assertEq(uint8(status), uint8(PasinPayEscrow.Status.Cancelled));
        vm.prank(creator);
        vm.expectRevert(PasinPayEscrow.InvalidStatus.selector);
        escrow.fundBounty(id, uint128(AMOUNT));
    }

    function testRejectInvalidCreateAndUnauthorizedFunding() external {
        vm.prank(creator);
        vm.expectRevert(PasinPayEscrow.InvalidInput.selector);
        escrow.createBounty(bytes32(0), 1, uint64(block.timestamp + 1 days), 60);

        vm.prank(creator);
        uint256 id = escrow.createBounty(keccak256("repo"), 1, uint64(block.timestamp + 1 days), 60);
        vm.prank(attacker);
        vm.expectRevert(PasinPayEscrow.InvalidStatus.selector);
        escrow.fundBounty(id, uint128(AMOUNT));
    }

    function testClaimApprovalReviewAndPayment() external {
        uint256 id = _createFund();
        _submitClaim(id, claimant, 7, 1);

        vm.prank(attacker);
        vm.expectRevert(PasinPayEscrow.Unauthorized.selector);
        escrow.approveClaim(id);
        vm.prank(creator);
        escrow.approveClaim(id);
        vm.prank(creator);
        vm.expectRevert(PasinPayEscrow.AlreadyApproved.selector);
        escrow.approveClaim(id);

        vm.expectRevert(PasinPayEscrow.ReviewWindowOpen.selector);
        escrow.finalizeClaim(id);
        vm.warp(block.timestamp + 61);
        uint256 beforeBalance = token.balanceOf(claimant);
        escrow.finalizeClaim(id);
        assertEq(token.balanceOf(claimant), beforeBalance + AMOUNT);
        (,,,,,,,,, PasinPayEscrow.Status status,) = escrow.bounties(id);
        assertEq(uint8(status), uint8(PasinPayEscrow.Status.Paid));
        vm.expectRevert(PasinPayEscrow.InvalidStatus.selector);
        escrow.finalizeClaim(id);
    }

    function testRejectWrongClaimSignatureRecipientExpiryAndReplay() external {
        uint256 id = _createFund();
        bytes memory badSignature = _signature(id, claimant, 7, 1, uint64(block.timestamp + 30 days), 0, 0xBEEF);
        vm.prank(claimant);
        vm.expectRevert(PasinPayEscrow.InvalidSignature.selector);
        escrow.submitClaim(id, claimant, 7, keccak256("commit"), uint64(block.timestamp + 1 hours), 0, badSignature);

        bytes memory signature = _signature(id, claimant, 7, 0, uint64(block.timestamp + 1 hours), 0, ATTESTOR_PK);
        vm.prank(attacker);
        vm.expectRevert(PasinPayEscrow.InvalidStatus.selector);
        escrow.submitClaim(id, claimant, 7, keccak256("commit"), uint64(block.timestamp + 1 hours), 0, signature);

        vm.warp(block.timestamp + 2 days);
        vm.prank(claimant);
        vm.expectRevert(PasinPayEscrow.ClaimExpired.selector);
        escrow.submitClaim(id, claimant, 7, keccak256("commit"), uint64(block.timestamp + 1 hours), 0, signature);

        vm.warp(block.timestamp - 2 days);
        vm.prank(claimant);
        escrow.submitClaim(id, claimant, 7, keccak256("commit"), uint64(block.timestamp + 1 hours), 0, signature);
        vm.prank(claimant);
        vm.expectRevert(PasinPayEscrow.InvalidStatus.selector);
        escrow.submitClaim(id, claimant, 7, keccak256("commit"), uint64(block.timestamp + 1 hours), 0, signature);
    }

    function testRefundExpiredFundedBounty() external {
        uint256 id = _createFund();
        vm.warp(block.timestamp + 2 days);
        uint256 beforeBalance = token.balanceOf(creator);
        escrow.refundExpired(id);
        assertEq(token.balanceOf(creator), beforeBalance + AMOUNT);
        (,,,,,,,,, PasinPayEscrow.Status status,) = escrow.bounties(id);
        assertEq(uint8(status), uint8(PasinPayEscrow.Status.Refunded));
    }

    function testDisputeResolvePreservesEscrow() external {
        uint256 id = _createFund();
        _submitClaim(id, claimant, 7, 1);
        vm.prank(creator);
        escrow.disputeClaim(id);
        vm.prank(attacker);
        vm.expectRevert();
        escrow.resolveDispute(id, 5_000);
        uint256 before = token.balanceOf(claimant) + token.balanceOf(creator) + token.balanceOf(address(escrow));
        vm.prank(creator);
        escrow.resolveDispute(id, 5_000);
        uint256 afterBalances = token.balanceOf(claimant) + token.balanceOf(creator) + token.balanceOf(address(escrow));
        assertEq(afterBalances, before);
    }

    function testAttestorRotation() external {
        address nextAttestor = address(0x1234);
        vm.prank(creator);
        escrow.setAttestor(nextAttestor);
        assertEq(escrow.attestor(), nextAttestor);
        vm.prank(attacker);
        vm.expectRevert();
        escrow.setAttestor(address(0x4567));
    }

    function testFuzzDisputeSplitPreservesEscrow(uint16 claimantBps) external {
        claimantBps = uint16(bound(claimantBps, 0, 10_000));
        uint256 id = _createFund();
        _submitClaim(id, claimant, 7, 1);
        vm.prank(creator);
        escrow.disputeClaim(id);
        uint256 before = token.balanceOf(creator) + token.balanceOf(claimant) + token.balanceOf(address(escrow));
        vm.prank(creator);
        escrow.resolveDispute(id, claimantBps);
        uint256 afterBalances = token.balanceOf(creator) + token.balanceOf(claimant) + token.balanceOf(address(escrow));
        assertEq(afterBalances, before);
    }

    function _createFund() internal returns (uint256 id) {
        vm.prank(creator);
        id = escrow.createBounty(keccak256("acme/storefront"), 17, uint64(block.timestamp + 1 days), 60);
        vm.prank(creator);
        escrow.fundBounty(id, uint128(AMOUNT));
    }

    function _submitClaim(uint256 id, address recipient, uint256 prNumber, uint256 nonce) internal {
        uint64 expiry = uint64(block.timestamp + 1 hours);
        bytes memory signature = _signature(id, recipient, prNumber, nonce, expiry, ATTESTOR_PK, ATTESTOR_PK);
        vm.prank(recipient);
        escrow.submitClaim(id, recipient, prNumber, keccak256("commit"), expiry, nonce, signature);
    }

    function _signature(
        uint256 id,
        address recipient,
        uint256 prNumber,
        uint256 nonce,
        uint64 expiry,
        uint256 privateKey,
        uint256 signerKey
    ) internal view returns (bytes memory) {
        bytes32 structHash = keccak256(
            abi.encode(
                CLAIM_TYPEHASH,
                id,
                keccak256("acme/storefront"),
                uint32(17),
                prNumber,
                keccak256("commit"),
                recipient,
                expiry,
                nonce
            )
        );
        bytes32 domainSeparator = keccak256(
            abi.encode(DOMAIN_TYPEHASH, keccak256("PasinPay"), keccak256("1"), block.chainid, address(escrow))
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerKey == 0 ? privateKey : signerKey, digest);
        return abi.encodePacked(r, s, v);
    }
}
