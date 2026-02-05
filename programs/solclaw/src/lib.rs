use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

declare_id!("J4qipHcPyaPkVs8ymCLcpgqSDJeoSn3k1LJLK7Q9DZ5H");

// USDC Mint on Solana Devnet
pub const USDC_MINT: &str = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";

#[program]
pub mod solclaw {
    use super::*;

    // ============================================================
    // CORE INSTRUCTIONS
    // ============================================================

    /// Register a new agent with a human-readable name
    /// Creates a PDA vault for USDC storage
    pub fn register_agent(ctx: Context<RegisterAgent>, name: String) -> Result<()> {
        require!(name.len() >= 1 && name.len() <= 32, SolclawError::InvalidNameLength);

        let agent = &mut ctx.accounts.agent_registry;
        let clock = Clock::get()?;

        // Store name hash for PDA derivation
        let name_bytes = name.as_bytes();
        let mut name_hash = [0u8; 32];
        name_hash[..name_bytes.len().min(32)].copy_from_slice(&name_bytes[..name_bytes.len().min(32)]);

        agent.name_hash = name_hash;
        agent.name = name.clone();
        agent.authority = ctx.accounts.authority.key();
        agent.vault = ctx.accounts.vault.key();
        agent.created_at = clock.unix_timestamp;
        agent.total_sent = 0;
        agent.total_received = 0;
        agent.bump = ctx.bumps.agent_registry;
        agent.vault_bump = ctx.bumps.vault;

        // v3: Initialize spending cap fields
        agent.daily_limit = 0;      // No limit by default
        agent.daily_spent = 0;
        agent.last_spend_day = 0;

        msg!("Agent registered: {} -> vault: {}", name, ctx.accounts.vault.key());

        Ok(())
    }

    /// Deposit USDC into the agent's vault
    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        require!(amount > 0, SolclawError::InvalidAmount);

        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.user_token_account.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                    authority: ctx.accounts.authority.to_account_info(),
                },
            ),
            amount,
        )?;

        msg!("Deposited {} USDC to vault {}", amount, ctx.accounts.vault.key());

        Ok(())
    }

    /// Transfer USDC from sender vault to receiver vault by name
    /// v3: Added optional memo parameter
    pub fn transfer_by_name(
        ctx: Context<TransferByName>,
        amount: u64,
        memo: Option<String>,
    ) -> Result<()> {
        require!(amount > 0, SolclawError::InvalidAmount);

        // v3: Validate memo length
        if let Some(ref m) = memo {
            require!(m.len() <= 128, SolclawError::MemoTooLong);
        }

        let sender_registry = &mut ctx.accounts.sender_registry;

        // Verify sender authority
        require!(
            sender_registry.authority == ctx.accounts.authority.key(),
            SolclawError::Unauthorized
        );

        // v3: Check and update spending cap
        let clock = Clock::get()?;
        check_and_update_spending_cap(sender_registry, amount, &clock)?;

        // Create signer seeds for the sender vault PDA
        let name_bytes = sender_registry.name.as_bytes();
        let seeds = &[
            b"vault",
            name_bytes,
            &[sender_registry.vault_bump],
        ];
        let signer_seeds = &[&seeds[..]];

        // Transfer USDC from sender vault to receiver vault
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.sender_vault.to_account_info(),
                    to: ctx.accounts.receiver_vault.to_account_info(),
                    authority: ctx.accounts.sender_vault.to_account_info(),
                },
                signer_seeds,
            ),
            amount,
        )?;

        // Update stats
        sender_registry.total_sent = sender_registry.total_sent.checked_add(amount).unwrap_or(u64::MAX);

        let receiver = &mut ctx.accounts.receiver_registry;
        receiver.total_received = receiver.total_received.checked_add(amount).unwrap_or(u64::MAX);

        // v3: Emit transfer event with memo
        emit!(TransferEvent {
            sender: sender_registry.name.clone(),
            receiver: receiver.name.clone(),
            amount,
            memo: memo.unwrap_or_default(),
            timestamp: clock.unix_timestamp,
        });

        msg!(
            "Transferred {} USDC from {} to {}",
            amount,
            sender_registry.name,
            receiver.name
        );

        Ok(())
    }

    /// Withdraw USDC from vault to user's token account
    pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
        require!(amount > 0, SolclawError::InvalidAmount);

        let agent_registry = &ctx.accounts.agent_registry;

        // Verify authority
        require!(
            agent_registry.authority == ctx.accounts.authority.key(),
            SolclawError::Unauthorized
        );

        // Create signer seeds for the vault PDA
        let name_bytes = agent_registry.name.as_bytes();
        let seeds = &[
            b"vault",
            name_bytes,
            &[agent_registry.vault_bump],
        ];
        let signer_seeds = &[&seeds[..]];

        // Transfer USDC from vault to user
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.vault.to_account_info(),
                    to: ctx.accounts.destination.to_account_info(),
                    authority: ctx.accounts.vault.to_account_info(),
                },
                signer_seeds,
            ),
            amount,
        )?;

        msg!("Withdrew {} USDC from vault {}", amount, ctx.accounts.vault.key());

        Ok(())
    }

    // ============================================================
    // BATCH PAYMENT
    // ============================================================

    /// Batch pay multiple agents in one transaction.
    /// v3: Added memo support per payment entry
    pub fn batch_payment<'info>(
        ctx: Context<'_, '_, '_, 'info, BatchPayment<'info>>,
        payments: Vec<BatchPaymentEntry>,
    ) -> Result<()> {
        require!(payments.len() >= 1 && payments.len() <= 10, SolclawError::InvalidBatchSize);

        let sender_registry = &mut ctx.accounts.sender_registry;

        // Verify sender authority
        require!(
            ctx.accounts.authority.key() == sender_registry.authority,
            SolclawError::Unauthorized
        );

        // v3: Validate memo lengths
        for payment in payments.iter() {
            if let Some(ref m) = payment.memo {
                require!(m.len() <= 128, SolclawError::MemoTooLong);
            }
        }

        let remaining = &ctx.remaining_accounts;
        require!(
            remaining.len() == payments.len() * 2,
            SolclawError::InvalidRemainingAccounts
        );

        // v3: Calculate total and check spending cap
        let total: u64 = payments.iter().map(|p| p.amount).sum();
        let clock = Clock::get()?;
        check_and_update_spending_cap(sender_registry, total, &clock)?;

        // Create signer seeds for the sender vault PDA
        let name_bytes = sender_registry.name.as_bytes();
        let vault_bump = sender_registry.vault_bump;
        let seeds = &[
            b"vault".as_ref(),
            name_bytes,
            &[vault_bump],
        ];
        let signer_seeds = &[&seeds[..]];

        let mut total_sent: u64 = 0;
        let mut recipients: Vec<String> = Vec::new();
        let mut amounts: Vec<u64> = Vec::new();
        let mut memos: Vec<String> = Vec::new();

        for (i, payment) in payments.iter().enumerate() {
            require!(payment.amount > 0, SolclawError::InvalidAmount);

            let recipient_registry_info = &remaining[i * 2];
            let recipient_vault_info = &remaining[i * 2 + 1];

            // Validate recipient registry PDA
            let (expected_registry_pda, _) = Pubkey::find_program_address(
                &[b"agent", payment.recipient_name.as_bytes()],
                ctx.program_id,
            );
            require!(
                recipient_registry_info.key() == expected_registry_pda,
                SolclawError::NameMismatch
            );

            // Validate recipient vault PDA
            let (expected_vault_pda, _) = Pubkey::find_program_address(
                &[b"vault", payment.recipient_name.as_bytes()],
                ctx.program_id,
            );
            require!(
                recipient_vault_info.key() == expected_vault_pda,
                SolclawError::VaultMismatch
            );

            // Transfer USDC
            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    Transfer {
                        from: ctx.accounts.sender_vault.to_account_info(),
                        to: recipient_vault_info.to_account_info(),
                        authority: ctx.accounts.sender_vault.to_account_info(),
                    },
                    signer_seeds,
                ),
                payment.amount,
            )?;

            total_sent = total_sent.checked_add(payment.amount).ok_or(SolclawError::Overflow)?;
            recipients.push(payment.recipient_name.clone());
            amounts.push(payment.amount);
            memos.push(payment.memo.clone().unwrap_or_default());
        }

        // Update sender stats
        sender_registry.total_sent = sender_registry.total_sent.checked_add(total_sent).ok_or(SolclawError::Overflow)?;

        // v3: Emit batch payment event with memos
        emit!(BatchPaymentEvent {
            sender: sender_registry.name.clone(),
            recipients,
            amounts,
            memos,
            total: total_sent,
            timestamp: clock.unix_timestamp,
        });

        msg!("Batch payment: {} USDC to {} recipients", total_sent, payments.len());

        Ok(())
    }

    // ============================================================
    // SPLIT PAYMENT
    // ============================================================

    /// Split a total USDC amount across multiple agents proportionally.
    /// v3: Added memo support
    pub fn split_payment<'info>(
        ctx: Context<'_, '_, '_, 'info, SplitPayment<'info>>,
        total_amount: u64,
        recipients: Vec<SplitRecipient>,
        memo: Option<String>,
    ) -> Result<()> {
        require!(
            recipients.len() >= 2 && recipients.len() <= 10,
            SolclawError::TooManySplitRecipients
        );

        // v3: Validate memo length
        if let Some(ref m) = memo {
            require!(m.len() <= 128, SolclawError::MemoTooLong);
        }

        // Verify shares sum to 10000
        let total_bps: u64 = recipients.iter().map(|r| r.share_bps as u64).sum();
        require!(total_bps == 10000, SolclawError::InvalidSplitShares);

        let sender_registry = &mut ctx.accounts.sender_registry;

        require!(
            ctx.accounts.authority.key() == sender_registry.authority,
            SolclawError::Unauthorized
        );

        let remaining = &ctx.remaining_accounts;
        require!(
            remaining.len() == recipients.len() * 2,
            SolclawError::InvalidRemainingAccounts
        );

        // v3: Check spending cap
        let clock = Clock::get()?;
        check_and_update_spending_cap(sender_registry, total_amount, &clock)?;

        // Create signer seeds
        let name_bytes = sender_registry.name.as_bytes();
        let vault_bump = sender_registry.vault_bump;
        let seeds = &[
            b"vault".as_ref(),
            name_bytes,
            &[vault_bump],
        ];
        let signer_seeds = &[&seeds[..]];

        // Calculate amounts, handling dust
        let mut distributed: u64 = 0;
        let mut recipient_names: Vec<String> = Vec::new();
        let mut amounts: Vec<u64> = Vec::new();

        for (i, recipient) in recipients.iter().enumerate() {
            let amount = if i == recipients.len() - 1 {
                // Last recipient gets the remainder
                total_amount.checked_sub(distributed).ok_or(SolclawError::Overflow)?
            } else {
                // amount = total * share_bps / 10000
                ((total_amount as u128)
                    .checked_mul(recipient.share_bps as u128)
                    .ok_or(SolclawError::Overflow)?
                    / 10000) as u64
            };

            if amount == 0 {
                distributed = distributed.checked_add(amount).ok_or(SolclawError::Overflow)?;
                continue;
            }

            let recipient_registry_info = &remaining[i * 2];
            let recipient_vault_info = &remaining[i * 2 + 1];

            // Validate recipient registry PDA
            let (expected_registry_pda, _) = Pubkey::find_program_address(
                &[b"agent", recipient.name.as_bytes()],
                ctx.program_id,
            );
            require!(
                recipient_registry_info.key() == expected_registry_pda,
                SolclawError::NameMismatch
            );

            // Validate recipient vault PDA
            let (expected_vault_pda, _) = Pubkey::find_program_address(
                &[b"vault", recipient.name.as_bytes()],
                ctx.program_id,
            );
            require!(
                recipient_vault_info.key() == expected_vault_pda,
                SolclawError::VaultMismatch
            );

            // Transfer
            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    Transfer {
                        from: ctx.accounts.sender_vault.to_account_info(),
                        to: recipient_vault_info.to_account_info(),
                        authority: ctx.accounts.sender_vault.to_account_info(),
                    },
                    signer_seeds,
                ),
                amount,
            )?;

            distributed = distributed.checked_add(amount).ok_or(SolclawError::Overflow)?;
            recipient_names.push(recipient.name.clone());
            amounts.push(amount);
        }

        // Update sender stats
        sender_registry.total_sent = sender_registry.total_sent.checked_add(total_amount).ok_or(SolclawError::Overflow)?;

        // v3: Emit split payment event with memo
        emit!(SplitPaymentEvent {
            sender: sender_registry.name.clone(),
            recipients: recipient_names,
            amounts,
            total: total_amount,
            memo: memo.unwrap_or_default(),
            timestamp: clock.unix_timestamp,
        });

        msg!("Split payment: {} USDC to {} recipients", total_amount, recipients.len());

        Ok(())
    }

    // ============================================================
    // RECURRING PAYMENTS (SUBSCRIPTIONS)
    // ============================================================

    /// Create a new recurring payment subscription
    pub fn create_subscription(
        ctx: Context<CreateSubscription>,
        receiver_name: String,
        amount: u64,
        interval_seconds: i64,
    ) -> Result<()> {
        require!(amount > 0, SolclawError::InvalidAmount);
        require!(interval_seconds >= 60, SolclawError::InvalidInterval);

        let sender_registry = &ctx.accounts.sender_registry;
        let receiver_registry = &ctx.accounts.receiver_registry;

        require!(
            ctx.accounts.authority.key() == sender_registry.authority,
            SolclawError::Unauthorized
        );

        // Verify receiver name matches
        let mut expected_hash = [0u8; 32];
        let name_bytes = receiver_name.as_bytes();
        expected_hash[..name_bytes.len().min(32)].copy_from_slice(&name_bytes[..name_bytes.len().min(32)]);
        require!(
            receiver_registry.name_hash == expected_hash,
            SolclawError::NameMismatch
        );

        let now = Clock::get()?.unix_timestamp;

        let subscription = &mut ctx.accounts.subscription;
        subscription.sender = sender_registry.key();
        subscription.receiver = receiver_registry.key();
        subscription.sender_name = sender_registry.name.clone();
        subscription.receiver_name = receiver_name;
        subscription.amount = amount;
        subscription.interval_seconds = interval_seconds;
        subscription.last_executed = now;
        subscription.next_due = now + interval_seconds;
        subscription.is_active = true;
        subscription.authority = ctx.accounts.authority.key();
        subscription.total_paid = 0;
        subscription.execution_count = 0;
        subscription.bump = ctx.bumps.subscription;

        msg!(
            "Subscription created: {} -> {}, {} USDC every {} seconds",
            subscription.sender_name,
            subscription.receiver_name,
            amount,
            interval_seconds
        );

        Ok(())
    }

    /// Execute a due subscription payment. ANYONE can call this (permissionless crank).
    /// v3: Added spending cap check and auto-generated memo
    pub fn execute_subscription(ctx: Context<ExecuteSubscription>) -> Result<()> {
        let subscription = &mut ctx.accounts.subscription;

        require!(subscription.is_active, SolclawError::SubscriptionNotActive);

        let now = Clock::get()?.unix_timestamp;
        require!(now >= subscription.next_due, SolclawError::SubscriptionNotDue);

        let sender_registry = &mut ctx.accounts.sender_registry;

        // v3: Check spending cap
        let clock = Clock::get()?;
        check_and_update_spending_cap(sender_registry, subscription.amount, &clock)?;

        // Create signer seeds for the sender vault
        let name_bytes = sender_registry.name.as_bytes();
        let seeds = &[
            b"vault".as_ref(),
            name_bytes,
            &[sender_registry.vault_bump],
        ];
        let signer_seeds = &[&seeds[..]];

        // Execute the transfer
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.sender_vault.to_account_info(),
                    to: ctx.accounts.receiver_vault.to_account_info(),
                    authority: ctx.accounts.sender_vault.to_account_info(),
                },
                signer_seeds,
            ),
            subscription.amount,
        )?;

        // Update subscription state
        subscription.last_executed = now;
        subscription.next_due = now + subscription.interval_seconds;
        subscription.total_paid = subscription
            .total_paid
            .checked_add(subscription.amount)
            .ok_or(SolclawError::Overflow)?;
        subscription.execution_count += 1;

        // Update sender stats
        sender_registry.total_sent = sender_registry
            .total_sent
            .checked_add(subscription.amount)
            .ok_or(SolclawError::Overflow)?;

        // Update receiver stats
        let receiver = &mut ctx.accounts.receiver_registry;
        receiver.total_received = receiver
            .total_received
            .checked_add(subscription.amount)
            .ok_or(SolclawError::Overflow)?;

        // v3: Emit subscription executed event with auto-generated memo
        emit!(SubscriptionExecutedEvent {
            sender: subscription.sender_name.clone(),
            receiver: subscription.receiver_name.clone(),
            amount: subscription.amount,
            memo: format!("Subscription payment #{}", subscription.execution_count),
            execution_count: subscription.execution_count,
            timestamp: now,
        });

        msg!(
            "Subscription executed: {} -> {}, {} USDC (execution #{})",
            subscription.sender_name,
            subscription.receiver_name,
            subscription.amount,
            subscription.execution_count
        );

        Ok(())
    }

    /// Cancel a subscription. Only the sender (authority) can cancel.
    pub fn cancel_subscription(ctx: Context<CancelSubscription>) -> Result<()> {
        let subscription = &mut ctx.accounts.subscription;

        require!(
            ctx.accounts.authority.key() == subscription.authority,
            SolclawError::Unauthorized
        );

        subscription.is_active = false;

        msg!(
            "Subscription cancelled: {} -> {}, total paid: {} USDC over {} executions",
            subscription.sender_name,
            subscription.receiver_name,
            subscription.total_paid,
            subscription.execution_count
        );

        Ok(())
    }

    // ============================================================
    // v3: SPENDING CAP
    // ============================================================

    /// Set or remove a daily spending limit for an agent.
    /// Only the agent's authority can call this.
    /// Set to 0 to remove the limit.
    pub fn set_daily_limit(ctx: Context<SetDailyLimit>, limit_usdc: u64) -> Result<()> {
        let registry = &mut ctx.accounts.registry;

        require!(
            ctx.accounts.authority.key() == registry.authority,
            SolclawError::Unauthorized
        );

        registry.daily_limit = limit_usdc;

        emit!(DailyLimitSetEvent {
            agent: registry.name.clone(),
            limit_usdc,
            timestamp: Clock::get()?.unix_timestamp,
        });

        msg!(
            "Daily limit set for {}: {} USDC",
            registry.name,
            if limit_usdc == 0 { "unlimited".to_string() } else { format!("{}", limit_usdc as f64 / 1_000_000.0) }
        );

        Ok(())
    }

    // ============================================================
    // v3: ALLOWANCE (Approve / TransferFrom)
    // ============================================================

    /// Approve another agent to pull USDC from your vault, up to `amount`.
    /// If an allowance already exists, this REPLACES the amount (not adds to it).
    pub fn approve(
        ctx: Context<Approve>,
        spender_name: String,
        amount: u64,
    ) -> Result<()> {
        let owner_registry = &ctx.accounts.owner_registry;
        let spender_registry = &ctx.accounts.spender_registry;

        // Verify caller is the owner
        require!(
            ctx.accounts.authority.key() == owner_registry.authority,
            SolclawError::Unauthorized
        );

        // Verify spender name matches
        let mut expected_hash = [0u8; 32];
        let name_bytes = spender_name.as_bytes();
        expected_hash[..name_bytes.len().min(32)].copy_from_slice(&name_bytes[..name_bytes.len().min(32)]);
        require!(
            spender_registry.name_hash == expected_hash,
            SolclawError::NameMismatch
        );

        // Can't approve yourself
        require!(
            owner_registry.key() != spender_registry.key(),
            SolclawError::CannotApproveSelf
        );

        let allowance = &mut ctx.accounts.allowance;
        allowance.owner = owner_registry.key();
        allowance.spender = spender_registry.key();
        allowance.owner_name = owner_registry.name.clone();
        allowance.spender_name = spender_name.clone();
        allowance.amount = amount;
        allowance.total_pulled = 0;
        allowance.pull_count = 0;
        allowance.is_active = true;
        allowance.authority = ctx.accounts.authority.key();
        allowance.bump = ctx.bumps.allowance;

        emit!(AllowanceApprovedEvent {
            owner: owner_registry.name.clone(),
            spender: spender_name,
            amount,
            timestamp: Clock::get()?.unix_timestamp,
        });

        msg!(
            "Allowance approved: {} can pull up to {} USDC from {}",
            allowance.spender_name,
            amount as f64 / 1_000_000.0,
            allowance.owner_name
        );

        Ok(())
    }

    /// Pull USDC from an owner's vault using an approved allowance.
    /// The SPENDER calls this (not the owner).
    pub fn transfer_from(
        ctx: Context<TransferFrom>,
        amount: u64,
        memo: Option<String>,
    ) -> Result<()> {
        require!(amount > 0, SolclawError::InvalidAmount);

        if let Some(ref m) = memo {
            require!(m.len() <= 128, SolclawError::MemoTooLong);
        }

        let allowance = &mut ctx.accounts.allowance;
        let owner_registry = &mut ctx.accounts.owner_registry;
        let spender_registry = &mut ctx.accounts.spender_registry;

        // Verify the spender is the one calling
        require!(
            ctx.accounts.spender_authority.key() == spender_registry.authority,
            SolclawError::Unauthorized
        );

        // Verify allowance is active
        require!(allowance.is_active, SolclawError::AllowanceNotActive);

        // Verify allowance matches the owner and spender
        require!(
            allowance.owner == owner_registry.key(),
            SolclawError::AllowanceMismatch
        );
        require!(
            allowance.spender == spender_registry.key(),
            SolclawError::AllowanceMismatch
        );

        // Verify enough allowance remaining
        require!(
            amount <= allowance.amount,
            SolclawError::AllowanceExceeded
        );

        // Check owner's spending cap (the owner's daily limit still applies!)
        let clock = Clock::get()?;
        check_and_update_spending_cap(owner_registry, amount, &clock)?;

        // Execute the transfer from owner's vault to spender's vault
        let name_bytes = owner_registry.name.as_bytes();
        let seeds = &[
            b"vault",
            name_bytes,
            &[owner_registry.vault_bump],
        ];
        let signer_seeds = &[&seeds[..]];

        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.owner_vault.to_account_info(),
                    to: ctx.accounts.spender_vault.to_account_info(),
                    authority: ctx.accounts.owner_vault.to_account_info(),
                },
                signer_seeds,
            ),
            amount,
        )?;

        // Decrease allowance
        allowance.amount = allowance.amount
            .checked_sub(amount)
            .ok_or(SolclawError::Overflow)?;
        allowance.total_pulled = allowance.total_pulled
            .checked_add(amount)
            .ok_or(SolclawError::Overflow)?;
        allowance.pull_count += 1;

        // Update stats
        owner_registry.total_sent = owner_registry.total_sent
            .checked_add(amount)
            .ok_or(SolclawError::Overflow)?;
        spender_registry.total_received = spender_registry.total_received
            .checked_add(amount)
            .ok_or(SolclawError::Overflow)?;

        emit!(TransferFromEvent {
            owner: owner_registry.name.clone(),
            spender: spender_registry.name.clone(),
            amount,
            memo: memo.unwrap_or_default(),
            remaining_allowance: allowance.amount,
            pull_number: allowance.pull_count,
            timestamp: clock.unix_timestamp,
        });

        msg!(
            "TransferFrom: {} pulled {} USDC from {} (remaining allowance: {})",
            spender_registry.name,
            amount as f64 / 1_000_000.0,
            owner_registry.name,
            allowance.amount as f64 / 1_000_000.0
        );

        Ok(())
    }

    /// Revoke an allowance. Only the owner can revoke.
    pub fn revoke_allowance(ctx: Context<RevokeAllowance>) -> Result<()> {
        let allowance = &mut ctx.accounts.allowance;

        require!(
            ctx.accounts.authority.key() == allowance.authority,
            SolclawError::Unauthorized
        );

        allowance.is_active = false;
        allowance.amount = 0;

        emit!(AllowanceRevokedEvent {
            owner: allowance.owner_name.clone(),
            spender: allowance.spender_name.clone(),
            total_pulled: allowance.total_pulled,
            pull_count: allowance.pull_count,
            timestamp: Clock::get()?.unix_timestamp,
        });

        msg!(
            "Allowance revoked: {} can no longer pull from {}",
            allowance.spender_name,
            allowance.owner_name
        );

        Ok(())
    }

    /// Increase an existing allowance by a given amount.
    pub fn increase_allowance(
        ctx: Context<ModifyAllowance>,
        additional_amount: u64,
    ) -> Result<()> {
        let allowance = &mut ctx.accounts.allowance;

        require!(
            ctx.accounts.authority.key() == allowance.authority,
            SolclawError::Unauthorized
        );
        require!(allowance.is_active, SolclawError::AllowanceNotActive);

        allowance.amount = allowance.amount
            .checked_add(additional_amount)
            .ok_or(SolclawError::Overflow)?;

        emit!(AllowanceModifiedEvent {
            owner: allowance.owner_name.clone(),
            spender: allowance.spender_name.clone(),
            new_amount: allowance.amount,
            action: "increase".to_string(),
            timestamp: Clock::get()?.unix_timestamp,
        });

        msg!(
            "Allowance increased: {} can now pull up to {} USDC from {}",
            allowance.spender_name,
            allowance.amount as f64 / 1_000_000.0,
            allowance.owner_name
        );

        Ok(())
    }

    // ============================================================
    // v4: INVOICE SYSTEM
    // ============================================================

    /// Initialize the global invoice counter. Call once after program deploy.
    pub fn init_invoice_counter(ctx: Context<InitInvoiceCounter>) -> Result<()> {
        let counter = &mut ctx.accounts.counter;
        counter.count = 0;
        counter.bump = ctx.bumps.counter;
        msg!("Invoice counter initialized");
        Ok(())
    }

    /// Create a payment request (invoice).
    /// The requester asks the payer for a specific amount.
    pub fn create_invoice(
        ctx: Context<CreateInvoice>,
        payer_name: String,
        amount: u64,
        memo: String,
        expires_in_seconds: i64,
    ) -> Result<()> {
        require!(amount > 0, SolclawError::InvalidAmount);
        require!(memo.len() <= 128, SolclawError::MemoTooLong);
        require!(expires_in_seconds >= 0, SolclawError::InvalidExpiry);

        let requester_registry = &ctx.accounts.requester_registry;
        let payer_registry = &ctx.accounts.payer_registry;

        // Verify caller is the requester
        require!(
            ctx.accounts.authority.key() == requester_registry.authority,
            SolclawError::Unauthorized
        );

        // Verify payer name matches
        let mut expected_hash = [0u8; 32];
        let name_bytes = payer_name.as_bytes();
        expected_hash[..name_bytes.len().min(32)].copy_from_slice(&name_bytes[..name_bytes.len().min(32)]);
        require!(
            payer_registry.name_hash == expected_hash,
            SolclawError::NameMismatch
        );

        // Can't invoice yourself
        require!(
            requester_registry.key() != payer_registry.key(),
            SolclawError::CannotInvoiceSelf
        );

        // Increment global counter
        let counter = &mut ctx.accounts.counter;
        let invoice_id = counter.count;
        counter.count = counter.count
            .checked_add(1)
            .ok_or(SolclawError::Overflow)?;

        let now = Clock::get()?.unix_timestamp;

        let invoice = &mut ctx.accounts.invoice;
        invoice.id = invoice_id;
        invoice.requester = requester_registry.key();
        invoice.payer = payer_registry.key();
        invoice.requester_name = requester_registry.name.clone();
        invoice.payer_name = payer_name.clone();
        invoice.amount = amount;
        invoice.memo = memo.clone();
        invoice.status = Invoice::STATUS_PENDING;
        invoice.created_at = now;
        invoice.expires_at = if expires_in_seconds > 0 {
            now + expires_in_seconds
        } else {
            0 // Never expires
        };
        invoice.paid_at = 0;
        invoice.authority = ctx.accounts.authority.key();
        invoice.bump = ctx.bumps.invoice;

        emit!(InvoiceCreatedEvent {
            invoice_id,
            requester: requester_registry.name.clone(),
            payer: payer_name,
            amount,
            memo,
            expires_at: invoice.expires_at,
            timestamp: now,
        });

        msg!(
            "Invoice #{} created: {} requesting {} USDC from {}",
            invoice_id,
            requester_registry.name,
            amount as f64 / 1_000_000.0,
            invoice.payer_name
        );

        Ok(())
    }

    /// Pay a pending invoice. Only the designated payer can call this.
    /// Transfers USDC and marks the invoice as paid in one atomic TX.
    pub fn pay_invoice(ctx: Context<PayInvoice>) -> Result<()> {
        let invoice = &mut ctx.accounts.invoice;
        let payer_registry = &mut ctx.accounts.payer_registry;
        let requester_registry = &mut ctx.accounts.requester_registry;

        // Verify invoice is pending
        require!(
            invoice.status == Invoice::STATUS_PENDING,
            SolclawError::InvoiceNotPending
        );

        // Verify caller is the payer
        require!(
            ctx.accounts.authority.key() == payer_registry.authority,
            SolclawError::Unauthorized
        );

        // Check expiry
        let now = Clock::get()?.unix_timestamp;
        if invoice.expires_at > 0 {
            require!(
                now <= invoice.expires_at,
                SolclawError::InvoiceExpired
            );
        }

        // Check spending cap BEFORE transfer
        let clock = Clock::get()?;
        check_and_update_spending_cap(payer_registry, invoice.amount, &clock)?;

        // Execute USDC transfer: payer vault → requester vault
        let name_bytes = payer_registry.name.as_bytes();
        let seeds = &[
            b"vault",
            name_bytes,
            &[payer_registry.vault_bump],
        ];
        let signer_seeds = &[&seeds[..]];

        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.payer_vault.to_account_info(),
                    to: ctx.accounts.requester_vault.to_account_info(),
                    authority: ctx.accounts.payer_vault.to_account_info(),
                },
                signer_seeds,
            ),
            invoice.amount,
        )?;

        // Update invoice status
        invoice.status = Invoice::STATUS_PAID;
        invoice.paid_at = now;

        // Update stats
        payer_registry.total_sent = payer_registry.total_sent
            .checked_add(invoice.amount)
            .ok_or(SolclawError::Overflow)?;
        requester_registry.total_received = requester_registry.total_received
            .checked_add(invoice.amount)
            .ok_or(SolclawError::Overflow)?;

        emit!(InvoicePaidEvent {
            invoice_id: invoice.id,
            requester: invoice.requester_name.clone(),
            payer: invoice.payer_name.clone(),
            amount: invoice.amount,
            memo: invoice.memo.clone(),
            timestamp: now,
        });

        msg!(
            "Invoice #{} paid: {} USDC from {} to {}",
            invoice.id,
            invoice.amount as f64 / 1_000_000.0,
            invoice.payer_name,
            invoice.requester_name
        );

        Ok(())
    }

    /// Reject a pending invoice. Only the designated payer can reject.
    pub fn reject_invoice(ctx: Context<RejectInvoice>) -> Result<()> {
        let invoice = &mut ctx.accounts.invoice;

        require!(
            invoice.status == Invoice::STATUS_PENDING,
            SolclawError::InvoiceNotPending
        );

        // Only the payer can reject
        let payer_registry = &ctx.accounts.payer_registry;
        require!(
            ctx.accounts.authority.key() == payer_registry.authority,
            SolclawError::Unauthorized
        );
        require!(
            invoice.payer == payer_registry.key(),
            SolclawError::InvoiceMismatch
        );

        invoice.status = Invoice::STATUS_REJECTED;

        emit!(InvoiceRejectedEvent {
            invoice_id: invoice.id,
            requester: invoice.requester_name.clone(),
            payer: invoice.payer_name.clone(),
            amount: invoice.amount,
            timestamp: Clock::get()?.unix_timestamp,
        });

        msg!(
            "Invoice #{} rejected by {}",
            invoice.id,
            invoice.payer_name
        );

        Ok(())
    }

    /// Cancel a pending invoice. Only the requester (creator) can cancel.
    pub fn cancel_invoice(ctx: Context<CancelInvoice>) -> Result<()> {
        let invoice = &mut ctx.accounts.invoice;

        require!(
            invoice.status == Invoice::STATUS_PENDING,
            SolclawError::InvoiceNotPending
        );

        // Only the requester can cancel
        require!(
            ctx.accounts.authority.key() == invoice.authority,
            SolclawError::Unauthorized
        );

        invoice.status = Invoice::STATUS_CANCELLED;

        emit!(InvoiceCancelledEvent {
            invoice_id: invoice.id,
            requester: invoice.requester_name.clone(),
            payer: invoice.payer_name.clone(),
            amount: invoice.amount,
            timestamp: Clock::get()?.unix_timestamp,
        });

        msg!(
            "Invoice #{} cancelled by {}",
            invoice.id,
            invoice.requester_name
        );

        Ok(())
    }
}

// ============================================================
// HELPER FUNCTIONS
// ============================================================

/// Check and update spending cap. Call this BEFORE every outgoing transfer.
/// Returns Ok(()) if the spend is allowed, Err if it exceeds the daily limit.
fn check_and_update_spending_cap(
    registry: &mut Account<AgentRegistry>,
    amount: u64,
    clock: &Clock,
) -> Result<()> {
    // If no limit set, allow everything
    if registry.daily_limit == 0 {
        return Ok(());
    }

    let today = clock.unix_timestamp / 86400;

    // Reset daily_spent if it's a new day
    if today != registry.last_spend_day {
        registry.daily_spent = 0;
        registry.last_spend_day = today;
    }

    // Check if this spend would exceed the limit
    let new_total = registry.daily_spent
        .checked_add(amount)
        .ok_or(SolclawError::Overflow)?;

    require!(
        new_total <= registry.daily_limit,
        SolclawError::SpendingCapExceeded
    );

    // Update spent amount
    registry.daily_spent = new_total;

    Ok(())
}

// ============================================================
// ACCOUNT STRUCTS
// ============================================================

#[derive(Accounts)]
#[instruction(name: String)]
pub struct RegisterAgent<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + AgentRegistry::INIT_SPACE,
        seeds = [b"agent", name.as_bytes()],
        bump
    )]
    pub agent_registry: Account<'info, AgentRegistry>,

    #[account(
        init,
        payer = authority,
        seeds = [b"vault", name.as_bytes()],
        bump,
        token::mint = usdc_mint,
        token::authority = vault,
    )]
    pub vault: Account<'info, TokenAccount>,

    #[account(
        constraint = usdc_mint.key().to_string() == USDC_MINT @ SolclawError::InvalidMint
    )]
    pub usdc_mint: Account<'info, Mint>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(
        seeds = [b"agent", agent_registry.name.as_bytes()],
        bump = agent_registry.bump,
    )]
    pub agent_registry: Account<'info, AgentRegistry>,

    #[account(
        mut,
        seeds = [b"vault", agent_registry.name.as_bytes()],
        bump = agent_registry.vault_bump,
    )]
    pub vault: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = user_token_account.mint == vault.mint @ SolclawError::InvalidMint
    )]
    pub user_token_account: Account<'info, TokenAccount>,

    pub authority: Signer<'info>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct TransferByName<'info> {
    #[account(
        mut,
        seeds = [b"agent", sender_registry.name.as_bytes()],
        bump = sender_registry.bump,
    )]
    pub sender_registry: Account<'info, AgentRegistry>,

    #[account(
        mut,
        seeds = [b"vault", sender_registry.name.as_bytes()],
        bump = sender_registry.vault_bump,
    )]
    pub sender_vault: Account<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [b"agent", receiver_registry.name.as_bytes()],
        bump = receiver_registry.bump,
    )]
    pub receiver_registry: Account<'info, AgentRegistry>,

    #[account(
        mut,
        seeds = [b"vault", receiver_registry.name.as_bytes()],
        bump = receiver_registry.vault_bump,
    )]
    pub receiver_vault: Account<'info, TokenAccount>,

    #[account(
        constraint = sender_registry.authority == authority.key() @ SolclawError::Unauthorized
    )]
    pub authority: Signer<'info>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(
        seeds = [b"agent", agent_registry.name.as_bytes()],
        bump = agent_registry.bump,
    )]
    pub agent_registry: Account<'info, AgentRegistry>,

    #[account(
        mut,
        seeds = [b"vault", agent_registry.name.as_bytes()],
        bump = agent_registry.vault_bump,
    )]
    pub vault: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = destination.mint == vault.mint @ SolclawError::InvalidMint
    )]
    pub destination: Account<'info, TokenAccount>,

    #[account(
        constraint = agent_registry.authority == authority.key() @ SolclawError::Unauthorized
    )]
    pub authority: Signer<'info>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct BatchPayment<'info> {
    #[account(
        mut,
        seeds = [b"agent", sender_registry.name.as_bytes()],
        bump = sender_registry.bump,
    )]
    pub sender_registry: Account<'info, AgentRegistry>,

    #[account(
        mut,
        seeds = [b"vault", sender_registry.name.as_bytes()],
        bump = sender_registry.vault_bump,
    )]
    pub sender_vault: Account<'info, TokenAccount>,

    #[account(
        constraint = sender_registry.authority == authority.key() @ SolclawError::Unauthorized
    )]
    pub authority: Signer<'info>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct SplitPayment<'info> {
    #[account(
        mut,
        seeds = [b"agent", sender_registry.name.as_bytes()],
        bump = sender_registry.bump,
    )]
    pub sender_registry: Account<'info, AgentRegistry>,

    #[account(
        mut,
        seeds = [b"vault", sender_registry.name.as_bytes()],
        bump = sender_registry.vault_bump,
    )]
    pub sender_vault: Account<'info, TokenAccount>,

    #[account(
        constraint = sender_registry.authority == authority.key() @ SolclawError::Unauthorized
    )]
    pub authority: Signer<'info>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
#[instruction(receiver_name: String)]
pub struct CreateSubscription<'info> {
    #[account(
        init,
        payer = payer,
        space = 8 + Subscription::INIT_SPACE,
        seeds = [
            b"subscription",
            sender_registry.key().as_ref(),
            receiver_registry.key().as_ref(),
        ],
        bump,
    )]
    pub subscription: Account<'info, Subscription>,

    #[account(
        seeds = [b"agent", sender_registry.name.as_bytes()],
        bump = sender_registry.bump,
    )]
    pub sender_registry: Account<'info, AgentRegistry>,

    #[account(
        seeds = [b"agent", receiver_registry.name.as_bytes()],
        bump = receiver_registry.bump,
    )]
    pub receiver_registry: Account<'info, AgentRegistry>,

    #[account(
        constraint = sender_registry.authority == authority.key() @ SolclawError::Unauthorized
    )]
    pub authority: Signer<'info>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ExecuteSubscription<'info> {
    #[account(
        mut,
        constraint = subscription.sender == sender_registry.key() @ SolclawError::InvalidSubscription,
        constraint = subscription.receiver == receiver_registry.key() @ SolclawError::InvalidSubscription,
    )]
    pub subscription: Account<'info, Subscription>,

    #[account(
        mut,
        seeds = [b"agent", sender_registry.name.as_bytes()],
        bump = sender_registry.bump,
    )]
    pub sender_registry: Account<'info, AgentRegistry>,

    #[account(
        mut,
        seeds = [b"agent", receiver_registry.name.as_bytes()],
        bump = receiver_registry.bump,
    )]
    pub receiver_registry: Account<'info, AgentRegistry>,

    #[account(
        mut,
        seeds = [b"vault", sender_registry.name.as_bytes()],
        bump = sender_registry.vault_bump,
    )]
    pub sender_vault: Account<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [b"vault", receiver_registry.name.as_bytes()],
        bump = receiver_registry.vault_bump,
    )]
    pub receiver_vault: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,

    /// Anyone can crank — no authority constraint
    pub cranker: Signer<'info>,
}

#[derive(Accounts)]
pub struct CancelSubscription<'info> {
    #[account(mut)]
    pub subscription: Account<'info, Subscription>,

    #[account(
        constraint = subscription.authority == authority.key() @ SolclawError::Unauthorized
    )]
    pub authority: Signer<'info>,
}

// v3: Spending Cap Accounts
#[derive(Accounts)]
pub struct SetDailyLimit<'info> {
    #[account(
        mut,
        seeds = [b"agent", registry.name.as_bytes()],
        bump = registry.bump,
        constraint = registry.authority == authority.key() @ SolclawError::Unauthorized
    )]
    pub registry: Account<'info, AgentRegistry>,

    pub authority: Signer<'info>,
}

// v3: Allowance Accounts
#[derive(Accounts)]
#[instruction(spender_name: String)]
pub struct Approve<'info> {
    #[account(
        init_if_needed,
        payer = payer,
        space = 8 + Allowance::INIT_SPACE,
        seeds = [
            b"allowance",
            owner_registry.key().as_ref(),
            spender_registry.key().as_ref(),
        ],
        bump,
    )]
    pub allowance: Account<'info, Allowance>,

    #[account(
        seeds = [b"agent", owner_registry.name.as_bytes()],
        bump = owner_registry.bump,
    )]
    pub owner_registry: Account<'info, AgentRegistry>,

    #[account(
        seeds = [b"agent", spender_registry.name.as_bytes()],
        bump = spender_registry.bump,
    )]
    pub spender_registry: Account<'info, AgentRegistry>,

    pub authority: Signer<'info>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct TransferFrom<'info> {
    #[account(
        mut,
        constraint = allowance.owner == owner_registry.key() @ SolclawError::AllowanceMismatch,
        constraint = allowance.spender == spender_registry.key() @ SolclawError::AllowanceMismatch,
    )]
    pub allowance: Account<'info, Allowance>,

    #[account(
        mut,
        seeds = [b"agent", owner_registry.name.as_bytes()],
        bump = owner_registry.bump,
    )]
    pub owner_registry: Account<'info, AgentRegistry>,

    #[account(
        mut,
        seeds = [b"agent", spender_registry.name.as_bytes()],
        bump = spender_registry.bump,
    )]
    pub spender_registry: Account<'info, AgentRegistry>,

    #[account(
        mut,
        seeds = [b"vault", owner_registry.name.as_bytes()],
        bump = owner_registry.vault_bump,
    )]
    pub owner_vault: Account<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [b"vault", spender_registry.name.as_bytes()],
        bump = spender_registry.vault_bump,
    )]
    pub spender_vault: Account<'info, TokenAccount>,

    /// The spender's wallet — they initiate the pull
    pub spender_authority: Signer<'info>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct RevokeAllowance<'info> {
    #[account(
        mut,
        seeds = [
            b"allowance",
            allowance.owner.as_ref(),
            allowance.spender.as_ref(),
        ],
        bump = allowance.bump,
        constraint = allowance.authority == authority.key() @ SolclawError::Unauthorized
    )]
    pub allowance: Account<'info, Allowance>,

    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct ModifyAllowance<'info> {
    #[account(
        mut,
        seeds = [
            b"allowance",
            allowance.owner.as_ref(),
            allowance.spender.as_ref(),
        ],
        bump = allowance.bump,
        constraint = allowance.authority == authority.key() @ SolclawError::Unauthorized
    )]
    pub allowance: Account<'info, Allowance>,

    pub authority: Signer<'info>,
}

// v4: Invoice Accounts

#[derive(Accounts)]
pub struct InitInvoiceCounter<'info> {
    #[account(
        init,
        payer = payer,
        space = InvoiceCounter::SIZE,
        seeds = [b"invoice_counter"],
        bump,
    )]
    pub counter: Account<'info, InvoiceCounter>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(payer_name: String, amount: u64, memo: String, expires_in_seconds: i64)]
pub struct CreateInvoice<'info> {
    #[account(
        init,
        payer = fee_payer,
        space = Invoice::SIZE,
        seeds = [b"invoice", counter.count.to_le_bytes().as_ref()],
        bump,
    )]
    pub invoice: Account<'info, Invoice>,

    #[account(
        mut,
        seeds = [b"invoice_counter"],
        bump = counter.bump,
    )]
    pub counter: Account<'info, InvoiceCounter>,

    pub requester_registry: Account<'info, AgentRegistry>,
    pub payer_registry: Account<'info, AgentRegistry>,

    pub authority: Signer<'info>,

    #[account(mut)]
    pub fee_payer: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct PayInvoice<'info> {
    #[account(
        mut,
        constraint = invoice.payer == payer_registry.key() @ SolclawError::InvoiceMismatch,
        constraint = invoice.requester == requester_registry.key() @ SolclawError::InvoiceMismatch,
    )]
    pub invoice: Account<'info, Invoice>,

    #[account(mut)]
    pub payer_registry: Account<'info, AgentRegistry>,

    #[account(mut)]
    pub requester_registry: Account<'info, AgentRegistry>,

    #[account(
        mut,
        constraint = payer_vault.key() == payer_registry.vault @ SolclawError::VaultMismatch
    )]
    pub payer_vault: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = requester_vault.key() == requester_registry.vault @ SolclawError::VaultMismatch
    )]
    pub requester_vault: Account<'info, TokenAccount>,

    /// The payer's wallet
    pub authority: Signer<'info>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct RejectInvoice<'info> {
    #[account(
        mut,
        seeds = [b"invoice", invoice.id.to_le_bytes().as_ref()],
        bump = invoice.bump,
        constraint = invoice.payer == payer_registry.key() @ SolclawError::InvoiceMismatch
    )]
    pub invoice: Account<'info, Invoice>,

    #[account(
        seeds = [b"agent", payer_registry.name.as_bytes()],
        bump = payer_registry.bump,
        constraint = payer_registry.authority == authority.key() @ SolclawError::Unauthorized
    )]
    pub payer_registry: Account<'info, AgentRegistry>,

    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct CancelInvoice<'info> {
    #[account(
        mut,
        seeds = [b"invoice", invoice.id.to_le_bytes().as_ref()],
        bump = invoice.bump,
        constraint = invoice.authority == authority.key() @ SolclawError::Unauthorized
    )]
    pub invoice: Account<'info, Invoice>,

    pub authority: Signer<'info>,
}

// ============================================================
// DATA TYPES
// ============================================================

#[account]
#[derive(InitSpace)]
pub struct AgentRegistry {
    pub name_hash: [u8; 32],        // Hash of name for indexing
    #[max_len(32)]
    pub name: String,               // Human-readable name (max 32 chars)
    pub authority: Pubkey,          // Wallet that controls this vault
    pub vault: Pubkey,              // Token account for USDC
    pub created_at: i64,            // Unix timestamp
    pub total_sent: u64,            // Total USDC sent (for leaderboard)
    pub total_received: u64,        // Total USDC received (for leaderboard)
    pub bump: u8,                   // PDA bump for agent registry
    pub vault_bump: u8,             // PDA bump for vault
    // v3: Spending Cap fields
    pub daily_limit: u64,           // Daily spending limit in USDC units (0 = no limit)
    pub daily_spent: u64,           // Amount spent today
    pub last_spend_day: i64,        // Day number of last spend (unix_timestamp / 86400)
}

#[account]
#[derive(InitSpace)]
pub struct Subscription {
    pub sender: Pubkey,             // AgentRegistry PDA of sender
    pub receiver: Pubkey,           // AgentRegistry PDA of receiver
    #[max_len(32)]
    pub sender_name: String,        // Sender name (for display)
    #[max_len(32)]
    pub receiver_name: String,      // Receiver name (for display)
    pub amount: u64,                // Amount per payment in USDC units
    pub interval_seconds: i64,      // Interval between payments
    pub last_executed: i64,         // Timestamp of last execution
    pub next_due: i64,              // Timestamp of next due payment
    pub is_active: bool,            // Whether subscription is active
    pub authority: Pubkey,          // Who can cancel (sender's wallet)
    pub total_paid: u64,            // Total amount paid so far
    pub execution_count: u64,       // Number of payments executed
    pub bump: u8,                   // PDA bump
}

/// v3: Allowance account for approve/transferFrom pattern
#[account]
#[derive(InitSpace)]
pub struct Allowance {
    pub owner: Pubkey,              // AgentRegistry PDA of the owner
    pub spender: Pubkey,            // AgentRegistry PDA of the spender
    #[max_len(32)]
    pub owner_name: String,         // Owner's name (for display/events)
    #[max_len(32)]
    pub spender_name: String,       // Spender's name (for display/events)
    pub amount: u64,                // Remaining allowance in USDC units
    pub total_pulled: u64,          // Total amount ever pulled
    pub pull_count: u64,            // Number of times transferFrom was called
    pub is_active: bool,            // Whether this allowance is active
    pub authority: Pubkey,          // The authority who can modify/revoke (owner's wallet)
    pub bump: u8,                   // PDA bump
}

/// v4: Global counter for generating unique invoice IDs.
/// Single PDA for the entire program, seeded by ["invoice_counter"].
#[account]
pub struct InvoiceCounter {
    pub count: u64,
    pub bump: u8,
}

impl InvoiceCounter {
    pub const SIZE: usize = 8 + 8 + 1; // discriminator + count + bump
}

/// v4: On-chain payment request.
/// Created by the requester, paid by the payer.
#[account]
pub struct Invoice {
    /// Unique invoice ID (derived from global counter)
    pub id: u64,
    /// The agent requesting payment (AgentRegistry PDA)
    pub requester: Pubkey,
    /// The agent who should pay (AgentRegistry PDA)
    pub payer: Pubkey,
    /// Requester's readable name (max 32)
    pub requester_name: String,
    /// Payer's readable name (max 32)
    pub payer_name: String,
    /// Amount requested in USDC smallest units
    pub amount: u64,
    /// Description / reason for the invoice (max 128)
    pub memo: String,
    /// Current status: 0=Pending, 1=Paid, 2=Rejected, 3=Cancelled, 4=Expired
    pub status: u8,
    /// Creation timestamp
    pub created_at: i64,
    /// Expiry timestamp. 0 = never expires.
    pub expires_at: i64,
    /// Timestamp when paid (0 if not yet paid)
    pub paid_at: i64,
    /// The authority who created this (requester's wallet)
    pub authority: Pubkey,
    /// Bump seed
    pub bump: u8,
}

impl Invoice {
    // Space: 8 (disc) + 8 + 32 + 32 + (4+32) + (4+32) + 8 + (4+128) + 1 + 8 + 8 + 8 + 32 + 1 = 364
    pub const SIZE: usize = 8 + 8 + 32 + 32 + 36 + 36 + 8 + 132 + 1 + 8 + 8 + 8 + 32 + 1;

    pub const STATUS_PENDING: u8 = 0;
    pub const STATUS_PAID: u8 = 1;
    pub const STATUS_REJECTED: u8 = 2;
    pub const STATUS_CANCELLED: u8 = 3;
    pub const STATUS_EXPIRED: u8 = 4;
}

/// A single payment entry within a batch
/// v3: Added optional memo
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct BatchPaymentEntry {
    /// The name of the recipient agent
    pub recipient_name: String,
    /// Amount in USDC smallest units (6 decimals)
    pub amount: u64,
    /// Optional memo (max 128 bytes)
    pub memo: Option<String>,
}

/// A split recipient with their share in basis points
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct SplitRecipient {
    /// Agent name
    pub name: String,
    /// Share in basis points (5000 = 50%)
    pub share_bps: u16,
}

// ============================================================
// EVENTS
// ============================================================

/// v3: Transfer event with memo
#[event]
pub struct TransferEvent {
    pub sender: String,
    pub receiver: String,
    pub amount: u64,
    pub memo: String,
    pub timestamp: i64,
}

/// v3: Batch payment event with memos
#[event]
pub struct BatchPaymentEvent {
    pub sender: String,
    pub recipients: Vec<String>,
    pub amounts: Vec<u64>,
    pub memos: Vec<String>,
    pub total: u64,
    pub timestamp: i64,
}

/// v3: Split payment event with memo
#[event]
pub struct SplitPaymentEvent {
    pub sender: String,
    pub recipients: Vec<String>,
    pub amounts: Vec<u64>,
    pub total: u64,
    pub memo: String,
    pub timestamp: i64,
}

/// v3: Subscription executed event with auto-memo
#[event]
pub struct SubscriptionExecutedEvent {
    pub sender: String,
    pub receiver: String,
    pub amount: u64,
    pub memo: String,
    pub execution_count: u64,
    pub timestamp: i64,
}

/// v3: Daily limit set event
#[event]
pub struct DailyLimitSetEvent {
    pub agent: String,
    pub limit_usdc: u64,
    pub timestamp: i64,
}

/// v3: Allowance approved event
#[event]
pub struct AllowanceApprovedEvent {
    pub owner: String,
    pub spender: String,
    pub amount: u64,
    pub timestamp: i64,
}

/// v3: TransferFrom event
#[event]
pub struct TransferFromEvent {
    pub owner: String,
    pub spender: String,
    pub amount: u64,
    pub memo: String,
    pub remaining_allowance: u64,
    pub pull_number: u64,
    pub timestamp: i64,
}

/// v3: Allowance revoked event
#[event]
pub struct AllowanceRevokedEvent {
    pub owner: String,
    pub spender: String,
    pub total_pulled: u64,
    pub pull_count: u64,
    pub timestamp: i64,
}

/// v3: Allowance modified event
#[event]
pub struct AllowanceModifiedEvent {
    pub owner: String,
    pub spender: String,
    pub new_amount: u64,
    pub action: String,
    pub timestamp: i64,
}

/// v4: Invoice created event
#[event]
pub struct InvoiceCreatedEvent {
    pub invoice_id: u64,
    pub requester: String,
    pub payer: String,
    pub amount: u64,
    pub memo: String,
    pub expires_at: i64,
    pub timestamp: i64,
}

/// v4: Invoice paid event
#[event]
pub struct InvoicePaidEvent {
    pub invoice_id: u64,
    pub requester: String,
    pub payer: String,
    pub amount: u64,
    pub memo: String,
    pub timestamp: i64,
}

/// v4: Invoice rejected event
#[event]
pub struct InvoiceRejectedEvent {
    pub invoice_id: u64,
    pub requester: String,
    pub payer: String,
    pub amount: u64,
    pub timestamp: i64,
}

/// v4: Invoice cancelled event
#[event]
pub struct InvoiceCancelledEvent {
    pub invoice_id: u64,
    pub requester: String,
    pub payer: String,
    pub amount: u64,
    pub timestamp: i64,
}

// ============================================================
// ERRORS
// ============================================================

#[error_code]
pub enum SolclawError {
    #[msg("Name must be between 1 and 32 characters")]
    InvalidNameLength,
    #[msg("Amount must be greater than 0")]
    InvalidAmount,
    #[msg("Invalid USDC mint address")]
    InvalidMint,
    #[msg("Unauthorized: you don't control this vault")]
    Unauthorized,
    #[msg("Batch must contain 1-10 payments")]
    InvalidBatchSize,
    #[msg("Wrong number of remaining accounts for batch/split")]
    InvalidRemainingAccounts,
    #[msg("Recipient name does not match registry")]
    NameMismatch,
    #[msg("Vault does not match agent registry")]
    VaultMismatch,
    #[msg("Arithmetic overflow")]
    Overflow,
    #[msg("Split shares must add up to 10000 basis points")]
    InvalidSplitShares,
    #[msg("Maximum 10 split recipients allowed")]
    TooManySplitRecipients,
    #[msg("Subscription interval must be at least 60 seconds")]
    InvalidInterval,
    #[msg("Subscription is not yet due")]
    SubscriptionNotDue,
    #[msg("Subscription is not active")]
    SubscriptionNotActive,
    #[msg("Invalid subscription: sender/receiver mismatch")]
    InvalidSubscription,
    // v3: New errors
    #[msg("Memo exceeds 128 bytes")]
    MemoTooLong,
    #[msg("Transfer would exceed daily spending limit")]
    SpendingCapExceeded,
    #[msg("Cannot approve yourself")]
    CannotApproveSelf,
    #[msg("Allowance is not active")]
    AllowanceNotActive,
    #[msg("Allowance does not match owner/spender")]
    AllowanceMismatch,
    #[msg("Transfer amount exceeds remaining allowance")]
    AllowanceExceeded,
    // v4: Invoice errors
    #[msg("Cannot invoice yourself")]
    CannotInvoiceSelf,
    #[msg("Invoice is not in pending status")]
    InvoiceNotPending,
    #[msg("Invoice does not match payer/requester")]
    InvoiceMismatch,
    #[msg("Invoice has expired")]
    InvoiceExpired,
    #[msg("Invalid expiry value")]
    InvalidExpiry,
}
