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

    IERC20 public immutable USDG;
    address public attestor;
    uint256 public nextBountyId = 1;
    mapping(uint256 => Bounty) public bounties;
    mapping(uint256 => mapping(uint256 => bool)) public usedNonces;

    error InvalidStatus();
    error Unauthorized();
    error InvalidInput();
    error InvalidSignature();
    error ClaimExpired();
    error ReviewWindowOpen();
    error AlreadyApproved();

    event BountyCreated(
        uint256 indexed bountyId,
        address indexed creator,
        bytes32 indexed repositoryHash,
        uint32 issueNumber,
        uint64 deadline
    );
    event BountyCancelled(uint256 indexed bountyId);
    event BountyFunded(uint256 indexed bountyId, uint128 amount);
    event ClaimSubmitted(uint256 indexed bountyId, address indexed claimant, uint256 prNumber, bytes32 commitHash);
    event ClaimApproved(uint256 indexed bountyId);
    event ClaimDisputed(uint256 indexed bountyId);
    event BountyPaid(uint256 indexed bountyId, address indexed recipient, uint128 amount);
    event BountyRefunded(uint256 indexed bountyId, uint128 amount);
    event AttestorUpdated(address indexed previousAttestor, address indexed newAttestor);

    constructor(address usdg, address initialAttestor, address initialOwner)
        EIP712("PasinPay", "1")
        Ownable(initialOwner)
    {
        if (usdg == address(0) || initialAttestor == address(0) || initialOwner == address(0)) {
            revert InvalidInput();
        }
        USDG = IERC20(usdg);
        attestor = initialAttestor;
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

    function fundBounty(uint256 bountyId, uint128 amount) external nonReentrant {
        Bounty storage bounty = _bounty(bountyId);
        if (
            bounty.status != Status.Open || bounty.creator != msg.sender || amount == 0
                || block.timestamp >= bounty.deadline
        ) revert InvalidStatus();
        bounty.amount = amount;
        bounty.status = Status.Funded;
        USDG.safeTransferFrom(msg.sender, address(this), amount);
        emit BountyFunded(bountyId, amount);
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
        USDG.safeTransfer(bounty.claimant, bounty.amount);
        emit BountyPaid(bountyId, bounty.claimant, bounty.amount);
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
        if (claimantAmount > 0) {
            USDG.safeTransfer(bounty.claimant, claimantAmount);
            emit BountyPaid(bountyId, bounty.claimant, claimantAmount);
        }
        if (creatorAmount > 0) {
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
        USDG.safeTransfer(bounty.creator, bounty.amount);
        emit BountyRefunded(bountyId, bounty.amount);
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

    function _bounty(uint256 bountyId) internal view returns (Bounty storage bounty) {
        bounty = bounties[bountyId];
        if (bounty.creator == address(0)) revert InvalidInput();
    }
}
