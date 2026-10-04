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
    uint256 internal constant FEE_AMOUNT = AMOUNT * 250 / 10_000;
    uint256 internal constant TOTAL_AMOUNT = AMOUNT + FEE_AMOUNT;

    MockUSDG internal token;
    PasinPayEscrow internal escrow;
    address internal creator = address(0xC0FFEE);
    address internal claimant = address(0xB0B);
    address internal attacker = address(0xBAD);
    address internal treasury = address(0xFEE);
    address internal attestor;

    function setUp() external {
        token = new MockUSDG();
        attestor = vm.addr(ATTESTOR_PK);
        escrow = new PasinPayEscrow(address(token), attestor, creator, treasury);
        token.mint(creator, 10_000 ether);
        vm.prank(creator);
        token.approve(address(escrow), type(uint256).max);
    }

    function testCreateAndFund() external {
        uint256 id = _createFund();
        (
            address bountyCreator,
            uint128 amount,
            uint128 feeAmount,
            uint128 totalFunded,,,,,,,,
            PasinPayEscrow.Status status,
        ) = escrow.bounties(id);
        assertEq(bountyCreator, creator);
        assertEq(amount, AMOUNT);
        assertEq(feeAmount, FEE_AMOUNT);
        assertEq(totalFunded, TOTAL_AMOUNT);
        assertEq(uint8(status), uint8(PasinPayEscrow.Status.Funded));
        assertEq(token.balanceOf(address(escrow)), TOTAL_AMOUNT);
    }

    function testCancelOpenBounty() external {
        vm.prank(creator);
        uint256 id = escrow.createBounty(keccak256("repo"), 1, uint64(block.timestamp + 1 days), 60);
        vm.prank(creator);
        escrow.cancelBounty(id);
        (,,,,,,,,,,, PasinPayEscrow.Status status,) = escrow.bounties(id);
        assertEq(uint8(status), uint8(PasinPayEscrow.Status.Cancelled));
        vm.prank(creator);
        vm.expectRevert(PasinPayEscrow.InvalidStatus.selector);
        escrow.fundBounty(id, uint128(AMOUNT));
    }

    function testFundRejectsAfterDeadlineAndDuplicateFunding() external {
        vm.prank(creator);
        uint256 id = escrow.createBounty(keccak256("repo"), 1, uint64(block.timestamp + 1 days), 60);

        vm.prank(creator);
        escrow.fundBounty(id, uint128(AMOUNT));

        vm.prank(creator);
        vm.expectRevert(PasinPayEscrow.InvalidStatus.selector);
        escrow.fundBounty(id, uint128(AMOUNT));

        vm.prank(creator);
        uint256 expiredOpenId = escrow.createBounty(keccak256("expired-repo"), 2, uint64(block.timestamp + 1 days), 60);
        vm.warp(block.timestamp + 1 days + 1);
        vm.prank(creator);
        vm.expectRevert(PasinPayEscrow.InvalidStatus.selector);
        escrow.fundBounty(expiredOpenId, uint128(AMOUNT));
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
        uint256 beforeTreasury = token.balanceOf(treasury);
        escrow.finalizeClaim(id);
        assertEq(token.balanceOf(claimant), beforeBalance + AMOUNT);
        assertEq(token.balanceOf(treasury), beforeTreasury + FEE_AMOUNT);
        assertEq(token.balanceOf(address(escrow)), 0);
        (,,,,,,,,,,, PasinPayEscrow.Status status,) = escrow.bounties(id);
        assertEq(uint8(status), uint8(PasinPayEscrow.Status.Paid));
        vm.expectRevert(PasinPayEscrow.InvalidStatus.selector);
        escrow.finalizeClaim(id);
    }

    function testDisputeBlocksApprovalAndOwnerCanResolvePartialClaim() external {
        uint256 id = _createFund();
        _submitClaim(id, claimant, 7, 1);

        vm.prank(creator);
        escrow.disputeClaim(id);

        vm.prank(creator);
        vm.expectRevert(PasinPayEscrow.Unauthorized.selector);
        escrow.approveClaim(id);

        uint256 claimantBefore = token.balanceOf(claimant);
        uint256 creatorBefore = token.balanceOf(creator);
        uint256 treasuryBefore = token.balanceOf(treasury);
        vm.prank(escrow.owner());
        escrow.resolveDispute(id, 5_000);

        assertEq(token.balanceOf(claimant), claimantBefore + AMOUNT / 2);
        assertEq(token.balanceOf(creator), creatorBefore + AMOUNT / 2);
        assertEq(token.balanceOf(treasury), treasuryBefore + FEE_AMOUNT);
        assertEq(token.balanceOf(address(escrow)), 0);
        (,,,,,,,,,,, PasinPayEscrow.Status status,) = escrow.bounties(id);
        assertEq(uint8(status), uint8(PasinPayEscrow.Status.Paid));
    }

    function testApprovedClaimCannotBeDisputedOrRefunded() external {
        uint256 id = _createFund();
        _submitClaim(id, claimant, 7, 1);
        vm.prank(creator);
        escrow.approveClaim(id);

        vm.warp(block.timestamp + 61);
        vm.prank(creator);
        vm.expectRevert(PasinPayEscrow.Unauthorized.selector);
        escrow.disputeClaim(id);
        vm.expectRevert(PasinPayEscrow.InvalidStatus.selector);
        escrow.refundExpired(id);
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

    function testOnlyTheFirstCanonicalClaimCanWin() external {
        uint256 id = _createFund();
        uint64 expiry = uint64(block.timestamp + 1 hours);
        bytes memory firstSignature = _signature(id, claimant, 7, 1, expiry, ATTESTOR_PK, ATTESTOR_PK);
        bytes memory secondSignature = _signature(id, attacker, 8, 2, expiry, ATTESTOR_PK, ATTESTOR_PK);

        vm.prank(claimant);
        escrow.submitClaim(id, claimant, 7, keccak256("commit"), expiry, 1, firstSignature);

        vm.prank(attacker);
        vm.expectRevert(PasinPayEscrow.InvalidStatus.selector);
        escrow.submitClaim(id, attacker, 8, keccak256("commit"), expiry, 2, secondSignature);

        (,,,,,,,,, address storedClaimant, bytes32 digest,,) = escrow.bounties(id);
        assertEq(storedClaimant, claimant);
        assertTrue(digest != bytes32(0));
    }

    function testRefundExpiredFundedBounty() external {
        uint256 id = _createFund();
        vm.warp(block.timestamp + 2 days);
        uint256 beforeBalance = token.balanceOf(creator);
        escrow.refundExpired(id);
        assertEq(token.balanceOf(creator), beforeBalance + TOTAL_AMOUNT);
        assertEq(token.balanceOf(address(escrow)), 0);
        (,,,,,,,,,,, PasinPayEscrow.Status status,) = escrow.bounties(id);
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
        uint256 before = token.balanceOf(claimant) + token.balanceOf(creator) + token.balanceOf(treasury)
            + token.balanceOf(address(escrow));
        vm.prank(creator);
        escrow.resolveDispute(id, 5_000);
        uint256 afterBalances = token.balanceOf(claimant) + token.balanceOf(creator) + token.balanceOf(treasury)
            + token.balanceOf(address(escrow));
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

    function testFullDisputeRefundReturnsRewardAndFee() external {
        uint256 id = _createFund();
        _submitClaim(id, claimant, 7, 1);
        vm.prank(creator);
        escrow.disputeClaim(id);
        uint256 creatorBefore = token.balanceOf(creator);
        vm.prank(creator);
        escrow.resolveDispute(id, 0);
        assertEq(token.balanceOf(creator), creatorBefore + TOTAL_AMOUNT);
        assertEq(token.balanceOf(treasury), 0);
        assertEq(token.balanceOf(address(escrow)), 0);
    }

    function testFeeConfigurationIsOwnerControlledAndCapped() external {
        assertEq(escrow.feeBps(), 250);
        assertEq(escrow.calculateFee(uint128(10_000)), 250);
        vm.prank(attacker);
        vm.expectRevert();
        escrow.setFeeBps(300);
        vm.prank(creator);
        escrow.setFeeBps(500);
        assertEq(escrow.feeBps(), 500);
        vm.prank(creator);
        vm.expectRevert(PasinPayEscrow.FeeTooHigh.selector);
        escrow.setFeeBps(501);
        vm.prank(creator);
        escrow.setFeeTreasury(address(0x1234));
        assertEq(escrow.feeTreasury(), address(0x1234));
    }

    function testFuzzDisputeSplitPreservesEscrow(uint16 claimantBps) external {
        claimantBps = uint16(bound(claimantBps, 0, 10_000));
        uint256 id = _createFund();
        _submitClaim(id, claimant, 7, 1);
        vm.prank(creator);
        escrow.disputeClaim(id);
        uint256 before = token.balanceOf(creator) + token.balanceOf(claimant) + token.balanceOf(treasury)
            + token.balanceOf(address(escrow));
        vm.prank(creator);
        escrow.resolveDispute(id, claimantBps);
        uint256 afterBalances = token.balanceOf(creator) + token.balanceOf(claimant) + token.balanceOf(treasury)
            + token.balanceOf(address(escrow));
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
