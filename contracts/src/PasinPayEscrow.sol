// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract PasinPayEscrow is EIP712, Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum Status {
        Open,
        Funded,
        ClaimPending,
        Paid,
        Disputed,
        Refunded,
        Cancelled
    }

    struct Bounty {
        address creator;
        uint128 amount;
        uint128 feeAmount;
        uint128 totalFunded;
        uint64 deadline;
        uint64 reviewWindow;
        uint64 reviewEnds;
        uint32 issueNumber;
        bytes32 repositoryHash;
        address claimant;
        bytes32 claimDigest;
        Status status;
        bool approved;
    }

    struct Claim {
        uint256 bountyId;
        bytes32 repositoryHash;
        uint32 issueNumber;
        uint256 prNumber;
        bytes32 commitHash;
        address recipient;
        uint64 expiresAt;
        uint256 nonce;
    }

    bytes32 private constant CLAIM_TYPEHASH = keccak256(
        "Claim(uint256 bountyId,bytes32 repositoryHash,uint32 issueNumber,uint256 prNumber,bytes32 commitHash,address recipient,uint64 expiresAt,uint256 nonce)"
    );
    bytes32 private constant X402_FUNDING_TYPEHASH = keccak256(
        "X402Funding(uint256 bountyId,address payer,uint128 rewardAmount,uint128 feeAmount,bytes32 authorizationHash,uint64 intentDeadline)"
    );
    bytes32 private constant TRANSFER_WITH_AUTHORIZATION_TYPEHASH = keccak256(
        "TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
    );

    IERC20 public immutable USDG;
    address public attestor;
    address public feeTreasury;
    uint16 public feeBps;
    uint16 public constant MAX_FEE_BPS = 500;
    uint256 public nextBountyId = 1;
    uint256 public totalEscrowed;
    mapping(uint256 => Bounty) public bounties;
    mapping(uint256 => mapping(uint256 => bool)) public usedNonces;
    mapping(address => mapping(bytes32 => bool)) public usedX402Nonces;

    error InvalidStatus();
    error Unauthorized();
    error InvalidInput();
    error InvalidSignature();
    error ClaimExpired();
    error ReviewWindowOpen();
    error AlreadyApproved();
    error FeeTooHigh();

    event BountyCreated(
        uint256 indexed bountyId,
        address indexed creator,
        bytes32 indexed repositoryHash,
        uint32 issueNumber,
        uint64 deadline
    );
    event BountyCancelled(uint256 indexed bountyId);
    event BountyFunded(uint256 indexed bountyId, uint128 rewardAmount, uint128 feeAmount, uint128 totalAmount);
    event X402BountyFunded(
        uint256 indexed bountyId, address indexed payer, bytes32 indexed authorizationNonce, uint128 totalAmount
    );
    event ClaimSubmitted(uint256 indexed bountyId, address indexed claimant, uint256 prNumber, bytes32 commitHash);
    event ClaimApproved(uint256 indexed bountyId);
    event ClaimDisputed(uint256 indexed bountyId);
    event BountyPaid(uint256 indexed bountyId, address indexed recipient, uint128 amount);
    event BountyRefunded(uint256 indexed bountyId, uint128 amount);
    event AttestorUpdated(address indexed previousAttestor, address indexed newAttestor);
    event FeeTreasuryUpdated(address indexed previousTreasury, address indexed newTreasury);
    event FeeBpsUpdated(uint16 previousFeeBps, uint16 newFeeBps);
    event PlatformFeePaid(uint256 indexed bountyId, address indexed treasury, uint128 amount);

    constructor(address usdg, address initialAttestor, address initialOwner, address initialFeeTreasury)
        EIP712("PasinPay", "1")
        Ownable(initialOwner)
    {
        if (
            usdg == address(0) || initialAttestor == address(0) || initialOwner == address(0)
                || initialFeeTreasury == address(0)
        ) {
            revert InvalidInput();
        }
        USDG = IERC20(usdg);
        attestor = initialAttestor;
        feeTreasury = initialFeeTreasury;
        feeBps = 250;
    }

    function createBounty(bytes32 repositoryHash, uint32 issueNumber, uint64 deadline, uint64 reviewWindow)
        external
        returns (uint256 bountyId)
    {
        if (repositoryHash == bytes32(0) || issueNumber == 0 || deadline <= block.timestamp || reviewWindow == 0) revert InvalidInput();
        bountyId = nextBountyId++;
        bounties[bountyId] = Bounty({
            creator: msg.sender,
            amount: 0,
            feeAmount: 0,
            totalFunded: 0,
            deadline: deadline,
            reviewWindow: reviewWindow,
            reviewEnds: 0,
            issueNumber: issueNumber,
            repositoryHash: repositoryHash,
            claimant: address(0),
            claimDigest: bytes32(0),
            status: Status.Open,
            approved: false
        });
        emit BountyCreated(bountyId, msg.sender, repositoryHash, issueNumber, deadline);
    }

    function fundBounty(uint256 bountyId, uint128 rewardAmount) external nonReentrant {
        Bounty storage bounty = _bounty(bountyId);
        if (
            bounty.status != Status.Open || bounty.creator != msg.sender || rewardAmount == 0
                || block.timestamp >= bounty.deadline
        ) revert InvalidStatus();
        uint128 feeAmount = calculateFee(rewardAmount);
        uint256 totalAmount = uint256(rewardAmount) + feeAmount;
        if (totalAmount > type(uint128).max) revert InvalidInput();
        bounty.amount = rewardAmount;
        bounty.feeAmount = feeAmount;
        bounty.totalFunded = uint128(totalAmount);
        bounty.status = Status.Funded;
        totalEscrowed += totalAmount;
        USDG.safeTransferFrom(msg.sender, address(this), totalAmount);
        emit BountyFunded(bountyId, rewardAmount, feeAmount, uint128(totalAmount));
    }

    /// @notice Funds an existing bounty with an x402-compatible EIP-3009 authorization.
    /// @dev The second signature binds the otherwise bounty-agnostic token authorization
    ///      to this bounty, amount, payer, and expiry. The token transfer and accounting
    ///      update happen atomically, so an authorization cannot leave unallocated funds.
    function fundBountyWithX402(
        uint256 bountyId,
        uint128 rewardAmount,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 authorizationNonce,
        bytes calldata authorizationSignature,
        uint64 intentDeadline,
        bytes calldata intentSignature
    ) external nonReentrant {
        Bounty storage bounty = _bounty(bountyId);
        if (
            bounty.status != Status.Open || rewardAmount == 0 || block.timestamp >= bounty.deadline
                || intentDeadline < block.timestamp || validAfter > block.timestamp || validBefore < block.timestamp
                || validBefore > intentDeadline || usedX402Nonces[bounty.creator][authorizationNonce]
        ) revert InvalidStatus();

        uint128 feeAmount = calculateFee(rewardAmount);
        uint256 totalAmount = uint256(rewardAmount) + feeAmount;
        if (totalAmount > type(uint128).max) revert InvalidInput();
        bytes32 authorizationHash = keccak256(
            abi.encode(bounty.creator, address(this), totalAmount, validAfter, validBefore, authorizationNonce)
        );
        bytes32 intentDigest = _hashTypedDataV4(
            keccak256(
                abi.encode(
                    X402_FUNDING_TYPEHASH,
                    bountyId,
                    bounty.creator,
                    rewardAmount,
                    feeAmount,
                    authorizationHash,
                    intentDeadline
                )
            )
        );
        if (ECDSA.recover(intentDigest, intentSignature) != bounty.creator) revert InvalidSignature();

        _validateX402Authorization(
            bounty.creator,
            uint128(totalAmount),
            validAfter,
            validBefore,
            authorizationNonce,
            authorizationSignature
        );
        usedX402Nonces[bounty.creator][authorizationNonce] = true;
        if (!_authorizationUsed(bounty.creator, authorizationNonce)) {
            _transferWithAuthorization(
                bounty.creator,
                uint128(totalAmount),
                validAfter,
                validBefore,
                authorizationNonce,
                authorizationSignature
            );
        } else if (USDG.balanceOf(address(this)) < totalEscrowed + totalAmount) {
            // A standard x402 facilitator may have settled the EIP-3009 transfer first.
            // Only attribute it when the exact signed authorization is consumed and the
            // escrow has enough unallocated tokens to cover this bounty.
            revert InvalidInput();
        }

        bounty.amount = rewardAmount;
        bounty.feeAmount = feeAmount;
        bounty.totalFunded = uint128(totalAmount);
        bounty.status = Status.Funded;
        totalEscrowed += totalAmount;
        emit BountyFunded(bountyId, rewardAmount, feeAmount, uint128(totalAmount));
        emit X402BountyFunded(bountyId, bounty.creator, authorizationNonce, uint128(totalAmount));
    }

    function submitClaim(
        uint256 bountyId,
        address recipient,
        uint256 prNumber,
        bytes32 commitHash,
        uint64 expiresAt,
        uint256 nonce,
        bytes calldata signature
    ) external nonReentrant {
        Bounty storage bounty = _bounty(bountyId);
        if (bounty.status != Status.Funded || recipient != msg.sender || prNumber == 0 || commitHash == bytes32(0)) {
            revert InvalidStatus();
        }
        if (expiresAt <= block.timestamp || expiresAt > bounty.deadline) revert ClaimExpired();
        if (usedNonces[bountyId][nonce]) revert InvalidInput();

        Claim memory claim = Claim(
            bountyId, bounty.repositoryHash, bounty.issueNumber, prNumber, commitHash, recipient, expiresAt, nonce
        );
        bytes32 digest = _hashTypedDataV4(
            keccak256(
                abi.encode(
                    CLAIM_TYPEHASH,
                    claim.bountyId,
                    claim.repositoryHash,
                    claim.issueNumber,
                    claim.prNumber,
                    claim.commitHash,
                    claim.recipient,
                    claim.expiresAt,
                    claim.nonce
                )
            )
        );
        if (ECDSA.recover(digest, signature) != attestor) revert InvalidSignature();

        usedNonces[bountyId][nonce] = true;
        bounty.claimant = recipient;
        bounty.claimDigest = digest;
        bounty.reviewEnds = uint64(block.timestamp + bounty.reviewWindow);
        bounty.status = Status.ClaimPending;
        emit ClaimSubmitted(bountyId, recipient, prNumber, commitHash);
    }

    function approveClaim(uint256 bountyId) external {
        Bounty storage bounty = _bounty(bountyId);
        if (bounty.status != Status.ClaimPending || bounty.creator != msg.sender) revert Unauthorized();
        if (bounty.approved) revert AlreadyApproved();
        bounty.approved = true;
        emit ClaimApproved(bountyId);
    }

    function finalizeClaim(uint256 bountyId) external nonReentrant {
        Bounty storage bounty = _bounty(bountyId);
        if (bounty.status != Status.ClaimPending || !bounty.approved) revert InvalidStatus();
        if (block.timestamp < bounty.reviewEnds) revert ReviewWindowOpen();
        bounty.status = Status.Paid;
        totalEscrowed -= bounty.totalFunded;
        USDG.safeTransfer(bounty.claimant, bounty.amount);
        emit BountyPaid(bountyId, bounty.claimant, bounty.amount);
        _payFee(bountyId, bounty.feeAmount);
    }

    function disputeClaim(uint256 bountyId) external {
        Bounty storage bounty = _bounty(bountyId);
        if (
            bounty.status != Status.ClaimPending || bounty.creator != msg.sender
                || (bounty.approved && block.timestamp >= bounty.reviewEnds)
        ) revert Unauthorized();
        bounty.status = Status.Disputed;
        emit ClaimDisputed(bountyId);
    }

    function resolveDispute(uint256 bountyId, uint16 claimantBps) external onlyOwner nonReentrant {
        Bounty storage bounty = _bounty(bountyId);
        if (bounty.status != Status.Disputed || claimantBps > 10_000) revert InvalidStatus();
        uint128 claimantAmount = uint128(uint256(bounty.amount) * claimantBps / 10_000);
        uint128 creatorAmount = bounty.amount - claimantAmount;
        bounty.status = claimantAmount > 0 ? Status.Paid : Status.Refunded;
        totalEscrowed -= bounty.totalFunded;
        if (claimantAmount > 0) {
            USDG.safeTransfer(bounty.claimant, claimantAmount);
            emit BountyPaid(bountyId, bounty.claimant, claimantAmount);
            _payFee(bountyId, bounty.feeAmount);
        }
        if (claimantAmount == 0) {
            USDG.safeTransfer(bounty.creator, bounty.totalFunded);
            emit BountyRefunded(bountyId, bounty.totalFunded);
        } else if (creatorAmount > 0) {
            USDG.safeTransfer(bounty.creator, creatorAmount);
            emit BountyRefunded(bountyId, creatorAmount);
        }
    }

    function refundExpired(uint256 bountyId) external nonReentrant {
        Bounty storage bounty = _bounty(bountyId);
        if (
            (bounty.status != Status.Funded && bounty.status != Status.ClaimPending)
                || block.timestamp <= bounty.deadline || bounty.approved
        ) revert InvalidStatus();
        bounty.status = Status.Refunded;
        totalEscrowed -= bounty.totalFunded;
        USDG.safeTransfer(bounty.creator, bounty.totalFunded);
        emit BountyRefunded(bountyId, bounty.totalFunded);
    }

    function cancelBounty(uint256 bountyId) external {
        Bounty storage bounty = _bounty(bountyId);
        if (bounty.status != Status.Open || bounty.creator != msg.sender) revert Unauthorized();
        bounty.status = Status.Cancelled;
        emit BountyCancelled(bountyId);
    }

    function setAttestor(address newAttestor) external onlyOwner {
        if (newAttestor == address(0)) revert InvalidInput();
        emit AttestorUpdated(attestor, newAttestor);
        attestor = newAttestor;
    }

    function setFeeTreasury(address newTreasury) external onlyOwner {
        if (newTreasury == address(0)) revert InvalidInput();
        emit FeeTreasuryUpdated(feeTreasury, newTreasury);
        feeTreasury = newTreasury;
    }

    function setFeeBps(uint16 newFeeBps) external onlyOwner {
        if (newFeeBps > MAX_FEE_BPS) revert FeeTooHigh();
        emit FeeBpsUpdated(feeBps, newFeeBps);
        feeBps = newFeeBps;
    }

    function calculateFee(uint128 rewardAmount) public view returns (uint128) {
        return uint128(uint256(rewardAmount) * feeBps / 10_000);
    }

    function _payFee(uint256 bountyId, uint128 feeAmount) internal {
        if (feeAmount == 0) return;
        USDG.safeTransfer(feeTreasury, feeAmount);
        emit PlatformFeePaid(bountyId, feeTreasury, feeAmount);
    }

    function _transferWithAuthorization(
        address from,
        uint128 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        bytes calldata signature
    ) internal {
        if (signature.length != 65) revert InvalidSignature();
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }
        if (v < 27) v += 27;
        (bool success, bytes memory result) = address(USDG).call(
            abi.encodeWithSignature(
                "transferWithAuthorization(address,address,uint256,uint256,uint256,bytes32,uint8,bytes32,bytes32)",
                from,
                address(this),
                uint256(value),
                validAfter,
                validBefore,
                nonce,
                v,
                r,
                s
            )
        );
        if (!success) {
            if (result.length > 0) assembly { revert(add(result, 32), mload(result)) }
            revert InvalidSignature();
        }
    }

    function _validateX402Authorization(
        address from,
        uint128 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        bytes calldata signature
    ) internal view {
        if (signature.length != 65) revert InvalidSignature();
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }
        if (v < 27) v += 27;
        (bool success, bytes memory result) = address(USDG).staticcall(
            abi.encodeWithSignature("DOMAIN_SEPARATOR()")
        );
        if (!success || result.length != 32) revert InvalidSignature();
        bytes32 tokenDomainSeparator = abi.decode(result, (bytes32));
        bytes32 structHash = keccak256(
            abi.encode(
                TRANSFER_WITH_AUTHORIZATION_TYPEHASH,
                from,
                address(this),
                uint256(value),
                validAfter,
                validBefore,
                nonce
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", tokenDomainSeparator, structHash));
        if (ECDSA.recover(digest, v, r, s) != from) revert InvalidSignature();
    }

    function _authorizationUsed(address authorizer, bytes32 nonce) internal view returns (bool) {
        (bool success, bytes memory result) = address(USDG).staticcall(
            abi.encodeWithSignature("authorizationState(address,bytes32)", authorizer, nonce)
        );
        if (!success || result.length != 32) revert InvalidInput();
        return abi.decode(result, (bool));
    }

    function _bounty(uint256 bountyId) internal view returns (Bounty storage bounty) {
        bounty = bounties[bountyId];
        if (bounty.creator == address(0)) revert InvalidInput();
    }
}
