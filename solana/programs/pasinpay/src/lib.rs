use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{self, Mint, Token, TokenAccount, TransferChecked},
};
use solana_instructions_sysvar::{load_current_index_checked, load_instruction_at_checked};
use solana_sha256_hasher::hash;

// Replaced with the program key generated for the Devnet deployment.
declare_id!("4n7TBwsub1PtVfFv7tT5Y2ZbuFMJ1Kv1wzMTRjiwTTeD");

pub const CONFIG_SEED: &[u8] = b"config";
pub const BOUNTY_SEED: &[u8] = b"bounty";
pub const CLAIM_DOMAIN: &[u8] = b"PASINPAY_SOLANA_CLAIM_V1";
pub const MAX_FEE_BPS: u16 = 500;
pub const CLAIM_MAX_AGE_SECONDS: i64 = 3_600;
pub const INSTRUCTIONS_SYSVAR_ID: Pubkey = pubkey!("Sysvar1nstructions1111111111111111111111111");
pub const ED25519_PROGRAM_ID: Pubkey = pubkey!("Ed25519SigVerify111111111111111111111111111");

#[program]
pub mod pasinpay_escrow {
    use super::*;

    pub fn initialize(
        ctx: Context<Initialize>,
        attestor: Pubkey,
        fee_treasury: Pubkey,
        fee_bps: u16,
        network_domain: [u8; 32],
    ) -> Result<()> {
        require!(attestor != Pubkey::default(), EscrowError::InvalidInput);
        require!(fee_treasury != Pubkey::default(), EscrowError::InvalidInput);
        require!(fee_bps <= MAX_FEE_BPS, EscrowError::FeeTooHigh);
        require!(ctx.accounts.mint.decimals == 6, EscrowError::InvalidMint);

        let config = &mut ctx.accounts.config;
        config.authority = ctx.accounts.authority.key();
        config.attestor = attestor;
        config.fee_treasury = fee_treasury;
        config.mint = ctx.accounts.mint.key();
        config.network_domain = network_domain;
        config.fee_bps = fee_bps;
        config.next_bounty_id = 1;
        config.bump = ctx.bumps.config;
        emit!(ConfigInitialized {
            authority: config.authority,
            attestor,
            fee_treasury,
            mint: config.mint,
            fee_bps,
        });
        Ok(())
    }

    pub fn update_config(
        ctx: Context<UpdateConfig>,
        attestor: Pubkey,
        fee_treasury: Pubkey,
        fee_bps: u16,
    ) -> Result<()> {
        require!(attestor != Pubkey::default(), EscrowError::InvalidInput);
        require!(fee_treasury != Pubkey::default(), EscrowError::InvalidInput);
        require!(fee_bps <= MAX_FEE_BPS, EscrowError::FeeTooHigh);
        let config = &mut ctx.accounts.config;
        let previous_attestor = config.attestor;
        let previous_treasury = config.fee_treasury;
        let previous_fee_bps = config.fee_bps;
        config.attestor = attestor;
        config.fee_treasury = fee_treasury;
        config.fee_bps = fee_bps;
        emit!(ConfigUpdated {
            authority: config.authority,
            previous_attestor,
            attestor,
            previous_treasury,
            fee_treasury,
            previous_fee_bps,
            fee_bps,
        });
        Ok(())
    }

    pub fn create_bounty(
        ctx: Context<CreateBounty>,
        repository_hash: [u8; 32],
        issue_number: u32,
        deadline: i64,
        review_window: i64,
    ) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        require!(repository_hash != [0; 32], EscrowError::InvalidInput);
        require!(issue_number > 0, EscrowError::InvalidInput);
        require!(deadline > now, EscrowError::InvalidInput);
        require!(review_window > 0, EscrowError::InvalidInput);

        let config = &mut ctx.accounts.config;
        let id = config.next_bounty_id;
        config.next_bounty_id = id.checked_add(1).ok_or(EscrowError::Arithmetic)?;

        let bounty = &mut ctx.accounts.bounty;
        bounty.id = id;
        bounty.creator = ctx.accounts.creator.key();
        bounty.repository_hash = repository_hash;
        bounty.issue_number = issue_number;
        bounty.deadline = deadline;
        bounty.review_window = review_window;
        bounty.review_ends = 0;
        bounty.amount = 0;
        bounty.fee_amount = 0;
        bounty.total_funded = 0;
        bounty.claimant = Pubkey::default();
        bounty.claim_pr_number = 0;
        bounty.claim_commit_hash = [0; 32];
        bounty.claim_digest = [0; 32];
        bounty.claim_nonce = [0; 32];
        bounty.status = BountyStatus::Open;
        bounty.approved = false;
        bounty.bump = ctx.bumps.bounty;
        emit!(BountyCreated {
            bounty_id: id,
            bounty: bounty.key(),
            creator: bounty.creator,
            repository_hash,
            issue_number,
            deadline,
        });
        Ok(())
    }

    pub fn fund_bounty(ctx: Context<FundBounty>, reward_amount: u64) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let bounty = &mut ctx.accounts.bounty;
        require!(
            bounty.status == BountyStatus::Open,
            EscrowError::InvalidStatus
        );
        require!(
            bounty.creator == ctx.accounts.creator.key(),
            EscrowError::Unauthorized
        );
        require!(reward_amount > 0, EscrowError::InvalidInput);
        require!(now < bounty.deadline, EscrowError::DeadlinePassed);

        let fee_amount = reward_amount
            .checked_mul(u64::from(ctx.accounts.config.fee_bps))
            .ok_or(EscrowError::Arithmetic)?
            / 10_000;
        let total_funded = reward_amount
            .checked_add(fee_amount)
            .ok_or(EscrowError::Arithmetic)?;
        token::transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.key(),
                TransferChecked {
                    from: ctx.accounts.creator_token.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.vault_token.to_account_info(),
                    authority: ctx.accounts.creator.to_account_info(),
                },
            ),
            total_funded,
            ctx.accounts.mint.decimals,
        )?;

        bounty.amount = reward_amount;
        bounty.fee_amount = fee_amount;
        bounty.total_funded = total_funded;
        bounty.status = BountyStatus::Funded;
        emit!(BountyFunded {
            bounty_id: bounty.id,
            reward_amount,
            fee_amount,
            total_amount: total_funded,
        });
        Ok(())
    }

    pub fn claim_bounty(
        ctx: Context<ClaimBounty>,
        pr_number: u32,
        commit_hash: [u8; 32],
        expires_at: i64,
        nonce: [u8; 32],
    ) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let bounty = &mut ctx.accounts.bounty;
        require!(
            bounty.status == BountyStatus::Funded,
            EscrowError::InvalidStatus
        );
        require!(
            pr_number > 0 && commit_hash != [0; 32],
            EscrowError::InvalidInput
        );
        require!(expires_at > now, EscrowError::AttestationExpired);
        require!(
            expires_at <= bounty.deadline,
            EscrowError::AttestationExpired
        );
        require!(
            expires_at <= now + CLAIM_MAX_AGE_SECONDS,
            EscrowError::AttestationExpired
        );
        require!(nonce != [0; 32], EscrowError::InvalidInput);

        let message = claim_message(
            ctx.program_id,
            &ctx.accounts.config,
            &bounty.key(),
            bounty.id,
            bounty.repository_hash,
            bounty.issue_number,
            pr_number,
            commit_hash,
            &ctx.accounts.claimant.key(),
            expires_at,
            nonce,
        );
        verify_previous_ed25519_instruction(
            &ctx.accounts.instructions.to_account_info(),
            &ctx.accounts.config.attestor,
            &message,
        )?;

        bounty.claimant = ctx.accounts.claimant.key();
        bounty.claim_pr_number = pr_number;
        bounty.claim_commit_hash = commit_hash;
        bounty.claim_nonce = nonce;
        bounty.claim_digest = hash(&message).to_bytes();
        bounty.review_ends = now
            .checked_add(bounty.review_window)
            .ok_or(EscrowError::Arithmetic)?;
        bounty.status = BountyStatus::ClaimPending;
        emit!(ClaimSubmitted {
            bounty_id: bounty.id,
            claimant: bounty.claimant,
            pr_number,
            commit_hash,
            review_ends: bounty.review_ends,
        });
        Ok(())
    }

    pub fn approve_claim(ctx: Context<CreatorAction>) -> Result<()> {
        let bounty = &mut ctx.accounts.bounty;
        require!(
            bounty.status == BountyStatus::ClaimPending,
            EscrowError::InvalidStatus
        );
        require!(
            bounty.creator == ctx.accounts.creator.key(),
            EscrowError::Unauthorized
        );
        require!(!bounty.approved, EscrowError::AlreadyApproved);
        bounty.approved = true;
        emit!(ClaimApproved {
            bounty_id: bounty.id
        });
        Ok(())
    }

    pub fn dispute_claim(ctx: Context<CreatorAction>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let bounty = &mut ctx.accounts.bounty;
        require!(
            bounty.status == BountyStatus::ClaimPending,
            EscrowError::InvalidStatus
        );
        require!(
            bounty.creator == ctx.accounts.creator.key(),
            EscrowError::Unauthorized
        );
        require!(
            !(bounty.approved && now >= bounty.review_ends),
            EscrowError::ReviewWindowClosed
        );
        bounty.status = BountyStatus::Disputed;
        emit!(ClaimDisputed {
            bounty_id: bounty.id
        });
        Ok(())
    }

    pub fn finalize_claim(ctx: Context<SettleClaim>) -> Result<()> {
        let bounty = &mut ctx.accounts.bounty;
        require!(
            bounty.status == BountyStatus::ClaimPending,
            EscrowError::InvalidStatus
        );
        require!(bounty.approved, EscrowError::NotApproved);
        require!(
            Clock::get()?.unix_timestamp >= bounty.review_ends,
            EscrowError::ReviewWindowOpen
        );
        require!(
            ctx.accounts.claimant_token.owner == bounty.claimant,
            EscrowError::InvalidTokenAccount
        );
        require!(
            ctx.accounts.fee_token.owner == ctx.accounts.config.fee_treasury,
            EscrowError::InvalidTokenAccount
        );
        bounty.status = BountyStatus::Paid;
        transfer_from_bounty(
            ctx.accounts.token_program.key(),
            ctx.accounts.mint.to_account_info(),
            ctx.accounts.vault_token.to_account_info(),
            ctx.accounts.claimant_token.to_account_info(),
            bounty.to_account_info(),
            bounty.id,
            bounty.bump,
            bounty.amount,
            ctx.accounts.mint.decimals,
        )?;
        if bounty.fee_amount > 0 {
            transfer_from_bounty(
                ctx.accounts.token_program.key(),
                ctx.accounts.mint.to_account_info(),
                ctx.accounts.vault_token.to_account_info(),
                ctx.accounts.fee_token.to_account_info(),
                bounty.to_account_info(),
                bounty.id,
                bounty.bump,
                bounty.fee_amount,
                ctx.accounts.mint.decimals,
            )?;
        }
        emit!(BountyPaid {
            bounty_id: bounty.id,
            recipient: bounty.claimant,
            amount: bounty.amount,
        });
        if bounty.fee_amount > 0 {
            emit!(PlatformFeePaid {
                bounty_id: bounty.id,
                treasury: ctx.accounts.config.fee_treasury,
                amount: bounty.fee_amount,
            });
        }
        Ok(())
    }

    pub fn resolve_dispute(ctx: Context<ResolveDispute>, claimant_bps: u16) -> Result<()> {
        require!(claimant_bps <= 10_000, EscrowError::InvalidInput);
        let bounty = &mut ctx.accounts.bounty;
        require!(
            bounty.status == BountyStatus::Disputed,
            EscrowError::InvalidStatus
        );
        require!(
            ctx.accounts.authority.key() == ctx.accounts.config.authority,
            EscrowError::Unauthorized
        );
        require!(
            ctx.accounts.creator_token.owner == bounty.creator,
            EscrowError::InvalidTokenAccount
        );
        require!(
            ctx.accounts.claimant_token.owner == bounty.claimant,
            EscrowError::InvalidTokenAccount
        );

        let claimant_amount = bounty
            .amount
            .checked_mul(u64::from(claimant_bps))
            .ok_or(EscrowError::Arithmetic)?
            / 10_000;
        let creator_amount = bounty.amount - claimant_amount;
        if claimant_amount > 0 {
            require!(
                ctx.accounts.fee_token.owner == ctx.accounts.config.fee_treasury,
                EscrowError::InvalidTokenAccount
            );
            bounty.status = BountyStatus::Paid;
            transfer_from_bounty(
                ctx.accounts.token_program.key(),
                ctx.accounts.mint.to_account_info(),
                ctx.accounts.vault_token.to_account_info(),
                ctx.accounts.claimant_token.to_account_info(),
                bounty.to_account_info(),
                bounty.id,
                bounty.bump,
                claimant_amount,
                ctx.accounts.mint.decimals,
            )?;
            transfer_from_bounty(
                ctx.accounts.token_program.key(),
                ctx.accounts.mint.to_account_info(),
                ctx.accounts.vault_token.to_account_info(),
                ctx.accounts.creator_token.to_account_info(),
                bounty.to_account_info(),
                bounty.id,
                bounty.bump,
                creator_amount,
                ctx.accounts.mint.decimals,
            )?;
            if bounty.fee_amount > 0 {
                transfer_from_bounty(
                    ctx.accounts.token_program.key(),
                    ctx.accounts.mint.to_account_info(),
                    ctx.accounts.vault_token.to_account_info(),
                    ctx.accounts.fee_token.to_account_info(),
                    bounty.to_account_info(),
                    bounty.id,
                    bounty.bump,
                    bounty.fee_amount,
                    ctx.accounts.mint.decimals,
                )?;
                emit!(PlatformFeePaid {
                    bounty_id: bounty.id,
                    treasury: ctx.accounts.config.fee_treasury,
                    amount: bounty.fee_amount,
                });
            }
            emit!(BountyPaid {
                bounty_id: bounty.id,
                recipient: bounty.claimant,
                amount: claimant_amount,
            });
        } else {
            bounty.status = BountyStatus::Refunded;
            transfer_from_bounty(
                ctx.accounts.token_program.key(),
                ctx.accounts.mint.to_account_info(),
                ctx.accounts.vault_token.to_account_info(),
                ctx.accounts.creator_token.to_account_info(),
                bounty.to_account_info(),
                bounty.id,
                bounty.bump,
                bounty.total_funded,
                ctx.accounts.mint.decimals,
            )?;
            emit!(BountyRefunded {
                bounty_id: bounty.id,
                amount: bounty.total_funded,
            });
        }
        emit!(DisputeResolved {
            bounty_id: bounty.id,
            claimant_bps,
            claimant_amount,
            creator_amount,
        });
        Ok(())
    }

    pub fn refund_expired(ctx: Context<RefundExpired>) -> Result<()> {
        let bounty = &mut ctx.accounts.bounty;
        require!(
            bounty.status == BountyStatus::Funded || bounty.status == BountyStatus::ClaimPending,
            EscrowError::InvalidStatus
        );
        require!(
            Clock::get()?.unix_timestamp > bounty.deadline,
            EscrowError::DeadlineNotPassed
        );
        require!(!bounty.approved, EscrowError::AlreadyApproved);
        require!(
            ctx.accounts.creator_token.owner == bounty.creator,
            EscrowError::InvalidTokenAccount
        );
        bounty.status = BountyStatus::Refunded;
        transfer_from_bounty(
            ctx.accounts.token_program.key(),
            ctx.accounts.mint.to_account_info(),
            ctx.accounts.vault_token.to_account_info(),
            ctx.accounts.creator_token.to_account_info(),
            bounty.to_account_info(),
            bounty.id,
            bounty.bump,
            bounty.total_funded,
            ctx.accounts.mint.decimals,
        )?;
        emit!(BountyRefunded {
            bounty_id: bounty.id,
            amount: bounty.total_funded,
        });
        Ok(())
    }

    pub fn cancel_bounty(ctx: Context<CreatorAction>) -> Result<()> {
        let bounty = &mut ctx.accounts.bounty;
        require!(
            bounty.status == BountyStatus::Open,
            EscrowError::InvalidStatus
        );
        require!(
            bounty.creator == ctx.accounts.creator.key(),
            EscrowError::Unauthorized
        );
        bounty.status = BountyStatus::Cancelled;
        emit!(BountyCancelled {
            bounty_id: bounty.id
        });
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        init,
        payer = authority,
        space = 8 + Config::INIT_SPACE,
        seeds = [CONFIG_SEED],
        bump
    )]
    pub config: Account<'info, Config>,
    #[account(owner = token_program.key())]
    pub mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateConfig<'info> {
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump, has_one = authority)]
    pub config: Account<'info, Config>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct CreateBounty<'info> {
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(
        init,
        payer = creator,
        space = 8 + Bounty::INIT_SPACE,
        seeds = [BOUNTY_SEED, &config.next_bounty_id.to_le_bytes()],
        bump
    )]
    pub bounty: Account<'info, Bounty>,
    #[account(mut)]
    pub creator: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct FundBounty<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut, has_one = creator, seeds = [BOUNTY_SEED, &bounty.id.to_le_bytes()], bump = bounty.bump)]
    pub bounty: Account<'info, Bounty>,
    #[account(mut)]
    pub creator: Signer<'info>,
    #[account(address = config.mint)]
    pub mint: Account<'info, Mint>,
    #[account(mut, token::mint = mint, token::authority = creator)]
    pub creator_token: Account<'info, TokenAccount>,
    #[account(
        init_if_needed,
        payer = creator,
        associated_token::mint = mint,
        associated_token::authority = bounty
    )]
    pub vault_token: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ClaimBounty<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [BOUNTY_SEED, &bounty.id.to_le_bytes()], bump = bounty.bump)]
    pub bounty: Account<'info, Bounty>,
    pub claimant: Signer<'info>,
    /// CHECK: The address is fixed to the canonical instructions sysvar and only read.
    #[account(address = INSTRUCTIONS_SYSVAR_ID)]
    pub instructions: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct CreatorAction<'info> {
    #[account(mut, seeds = [BOUNTY_SEED, &bounty.id.to_le_bytes()], bump = bounty.bump)]
    pub bounty: Account<'info, Bounty>,
    pub creator: Signer<'info>,
}

#[derive(Accounts)]
pub struct SettleClaim<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [BOUNTY_SEED, &bounty.id.to_le_bytes()], bump = bounty.bump)]
    pub bounty: Account<'info, Bounty>,
    #[account(address = config.mint)]
    pub mint: Account<'info, Mint>,
    #[account(mut, token::mint = mint, token::authority = bounty)]
    pub vault_token: Account<'info, TokenAccount>,
    #[account(mut, token::mint = mint, token::authority = bounty.claimant)]
    pub claimant_token: Account<'info, TokenAccount>,
    #[account(mut, token::mint = mint, token::authority = config.fee_treasury)]
    pub fee_token: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct ResolveDispute<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = authority)]
    pub config: Account<'info, Config>,
    pub authority: Signer<'info>,
    #[account(mut, seeds = [BOUNTY_SEED, &bounty.id.to_le_bytes()], bump = bounty.bump)]
    pub bounty: Account<'info, Bounty>,
    #[account(address = config.mint)]
    pub mint: Account<'info, Mint>,
    #[account(mut, token::mint = mint, token::authority = bounty)]
    pub vault_token: Account<'info, TokenAccount>,
    #[account(mut, token::mint = mint, token::authority = bounty.creator)]
    pub creator_token: Account<'info, TokenAccount>,
    #[account(mut, token::mint = mint, token::authority = bounty.claimant)]
    pub claimant_token: Account<'info, TokenAccount>,
    #[account(mut, token::mint = mint, token::authority = config.fee_treasury)]
    pub fee_token: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct RefundExpired<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [BOUNTY_SEED, &bounty.id.to_le_bytes()], bump = bounty.bump)]
    pub bounty: Account<'info, Bounty>,
    #[account(address = config.mint)]
    pub mint: Account<'info, Mint>,
    #[account(mut, token::mint = mint, token::authority = bounty)]
    pub vault_token: Account<'info, TokenAccount>,
    #[account(mut, token::mint = mint, token::authority = bounty.creator)]
    pub creator_token: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[account]
#[derive(InitSpace)]
pub struct Config {
    pub authority: Pubkey,
    pub attestor: Pubkey,
    pub fee_treasury: Pubkey,
    pub mint: Pubkey,
    pub network_domain: [u8; 32],
    pub fee_bps: u16,
    pub next_bounty_id: u64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Bounty {
    pub id: u64,
    pub creator: Pubkey,
    pub repository_hash: [u8; 32],
    pub issue_number: u32,
    pub deadline: i64,
    pub review_window: i64,
    pub review_ends: i64,
    pub amount: u64,
    pub fee_amount: u64,
    pub total_funded: u64,
    pub claimant: Pubkey,
    pub claim_pr_number: u32,
    pub claim_commit_hash: [u8; 32],
    pub claim_digest: [u8; 32],
    pub claim_nonce: [u8; 32],
    pub status: BountyStatus,
    pub approved: bool,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum BountyStatus {
    Open,
    Funded,
    ClaimPending,
    Paid,
    Disputed,
    Refunded,
    Cancelled,
}

fn claim_message(
    program_id: &Pubkey,
    config: &Config,
    bounty_key: &Pubkey,
    bounty_id: u64,
    repository_hash: [u8; 32],
    issue_number: u32,
    pr_number: u32,
    commit_hash: [u8; 32],
    claimant: &Pubkey,
    expires_at: i64,
    nonce: [u8; 32],
) -> Vec<u8> {
    let mut message = Vec::with_capacity(32 + 32 + 32 + 8 + 32 + 4 + 4 + 32 + 32 + 8 + 32);
    message.extend_from_slice(CLAIM_DOMAIN);
    message.extend_from_slice(program_id.as_ref());
    message.extend_from_slice(&config.network_domain);
    message.extend_from_slice(bounty_key.as_ref());
    message.extend_from_slice(&bounty_id.to_le_bytes());
    message.extend_from_slice(&repository_hash);
    message.extend_from_slice(&issue_number.to_le_bytes());
    message.extend_from_slice(&pr_number.to_le_bytes());
    message.extend_from_slice(&commit_hash);
    message.extend_from_slice(claimant.as_ref());
    message.extend_from_slice(&expires_at.to_le_bytes());
    message.extend_from_slice(&nonce);
    message
}

fn verify_previous_ed25519_instruction(
    instructions_info: &AccountInfo,
    expected_attestor: &Pubkey,
    expected_message: &[u8],
) -> Result<()> {
    let current_index = load_current_index_checked(instructions_info)
        .map_err(|_| error!(EscrowError::InvalidAttestation))?;
    require!(current_index > 0, EscrowError::InvalidAttestation);
    let instruction =
        load_instruction_at_checked(usize::from(current_index - 1), instructions_info)
            .map_err(|_| error!(EscrowError::InvalidAttestation))?;
    require_keys_eq!(
        instruction.program_id,
        ED25519_PROGRAM_ID,
        EscrowError::InvalidAttestation
    );
    let data = instruction.data;
    require!(data.len() >= 112, EscrowError::InvalidAttestation);
    require!(
        data[0] == 1 && data[1] == 0,
        EscrowError::InvalidAttestation
    );
    let u16_at = |offset: usize| -> u16 { u16::from_le_bytes([data[offset], data[offset + 1]]) };
    require!(u16_at(2) == 16, EscrowError::InvalidAttestation);
    require!(u16_at(4) == u16::MAX, EscrowError::InvalidAttestation);
    require!(u16_at(6) == 80, EscrowError::InvalidAttestation);
    require!(u16_at(8) == u16::MAX, EscrowError::InvalidAttestation);
    require!(u16_at(10) == 112, EscrowError::InvalidAttestation);
    require!(
        usize::from(u16_at(12)) == expected_message.len(),
        EscrowError::InvalidAttestation
    );
    require!(u16_at(14) == u16::MAX, EscrowError::InvalidAttestation);
    require!(
        data.len() == 112 + expected_message.len(),
        EscrowError::InvalidAttestation
    );
    require!(
        data[80..112] == expected_attestor.to_bytes(),
        EscrowError::InvalidAttestation
    );
    require!(
        data[112..] == *expected_message,
        EscrowError::InvalidAttestation
    );
    Ok(())
}

fn transfer_from_bounty<'info>(
    token_program: Pubkey,
    mint: AccountInfo<'info>,
    vault: AccountInfo<'info>,
    destination: AccountInfo<'info>,
    bounty: AccountInfo<'info>,
    id: u64,
    bump: u8,
    amount: u64,
    decimals: u8,
) -> Result<()> {
    let id_bytes = id.to_le_bytes();
    let bump = [bump];
    let seeds: &[&[u8]] = &[BOUNTY_SEED, &id_bytes, &bump];
    token::transfer_checked(
        CpiContext::new_with_signer(
            token_program,
            TransferChecked {
                from: vault,
                mint,
                to: destination,
                authority: bounty,
            },
            &[seeds],
        ),
        amount,
        decimals,
    )?;
    Ok(())
}

#[event]
pub struct ConfigInitialized {
    pub authority: Pubkey,
    pub attestor: Pubkey,
    pub fee_treasury: Pubkey,
    pub mint: Pubkey,
    pub fee_bps: u16,
}
#[event]
pub struct ConfigUpdated {
    pub authority: Pubkey,
    pub previous_attestor: Pubkey,
    pub attestor: Pubkey,
    pub previous_treasury: Pubkey,
    pub fee_treasury: Pubkey,
    pub previous_fee_bps: u16,
    pub fee_bps: u16,
}
#[event]
pub struct BountyCreated {
    pub bounty_id: u64,
    pub bounty: Pubkey,
    pub creator: Pubkey,
    pub repository_hash: [u8; 32],
    pub issue_number: u32,
    pub deadline: i64,
}
#[event]
pub struct BountyFunded {
    pub bounty_id: u64,
    pub reward_amount: u64,
    pub fee_amount: u64,
    pub total_amount: u64,
}
#[event]
pub struct ClaimSubmitted {
    pub bounty_id: u64,
    pub claimant: Pubkey,
    pub pr_number: u32,
    pub commit_hash: [u8; 32],
    pub review_ends: i64,
}
#[event]
pub struct ClaimApproved {
    pub bounty_id: u64,
}
#[event]
pub struct ClaimDisputed {
    pub bounty_id: u64,
}
#[event]
pub struct BountyPaid {
    pub bounty_id: u64,
    pub recipient: Pubkey,
    pub amount: u64,
}
#[event]
pub struct BountyRefunded {
    pub bounty_id: u64,
    pub amount: u64,
}
#[event]
pub struct BountyCancelled {
    pub bounty_id: u64,
}
#[event]
pub struct PlatformFeePaid {
    pub bounty_id: u64,
    pub treasury: Pubkey,
    pub amount: u64,
}
#[event]
pub struct DisputeResolved {
    pub bounty_id: u64,
    pub claimant_bps: u16,
    pub claimant_amount: u64,
    pub creator_amount: u64,
}

#[error_code]
pub enum EscrowError {
    #[msg("The supplied input is invalid.")]
    InvalidInput,
    #[msg("The escrow is not in a state that permits this action.")]
    InvalidStatus,
    #[msg("The signer is not authorized for this action.")]
    Unauthorized,
    #[msg("The transaction fee exceeds the maximum supported rate.")]
    FeeTooHigh,
    #[msg("The configured token mint must be a six-decimal SPL token.")]
    InvalidMint,
    #[msg("The bounty deadline has passed.")]
    DeadlinePassed,
    #[msg("The bounty deadline has not passed yet.")]
    DeadlineNotPassed,
    #[msg("The claim attestation is expired or outside its permitted lifetime.")]
    AttestationExpired,
    #[msg("The Ed25519 attestation instruction is invalid or does not match this claim.")]
    InvalidAttestation,
    #[msg("The review window has not ended.")]
    ReviewWindowOpen,
    #[msg("The claim has not been approved.")]
    NotApproved,
    #[msg("The claim cannot be disputed after the review period has ended.")]
    ReviewWindowClosed,
    #[msg("The claim has already been approved.")]
    AlreadyApproved,
    #[msg("The supplied token account owner is incorrect.")]
    InvalidTokenAccount,
    #[msg("Arithmetic overflow.")]
    Arithmetic,
}
