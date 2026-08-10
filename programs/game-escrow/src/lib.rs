use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    self, CloseAccount, Mint, TokenAccount, TokenInterface, TransferChecked,
};
use solana_sha256_hasher::hash;

declare_id!("9KqSa63Un4ZSge7RquC76yNRVetu2gaWD7VLDwwczsTs");

const GAME_ID_MAX_LEN: usize = 32;
const CONTEST_ID_MAX_LEN: usize = 64;
const RULES_HASH_MAX_LEN: usize = 64;
const RESULT_HASH_MAX_LEN: usize = 64;
const SEASON_ID_MAX_LEN: usize = 32;
const PRIZE_RESULTS_HASH_MAX_LEN: usize = 64;

#[program]
pub mod game_escrow {
    use super::*;

    pub fn initialize_global_config(
        ctx: Context<InitializeGlobalConfig>,
        args: InitializeGlobalConfigArgs,
    ) -> Result<()> {
        validate_fee_bps(args.platform_fee_bps)?;

        let global_config = &mut ctx.accounts.global_config;
        global_config.admin = ctx.accounts.admin.key();
        global_config.fee_authority = args.fee_authority;
        global_config.platform_fee_bps = args.platform_fee_bps;
        global_config.paused = false;
        global_config.bump = ctx.bumps.global_config;

        Ok(())
    }

    pub fn register_game(ctx: Context<RegisterGame>, args: RegisterGameArgs) -> Result<()> {
        validate_game_id(&args.game_id)?;
        validate_fee_bps(args.platform_fee_bps)?;
        validate_stake(args.max_stake_amount, args.max_stake_amount)?;

        let game_config = &mut ctx.accounts.game_config;
        game_config.global_config = ctx.accounts.global_config.key();
        game_config.game_id = args.game_id;
        game_config.admin = ctx.accounts.admin.key();
        game_config.result_authority = args.result_authority;
        game_config.supported_mint = args.supported_mint;
        game_config.max_stake_amount = args.max_stake_amount;
        game_config.platform_fee_bps = args.platform_fee_bps;
        game_config.paused = false;
        game_config.mint_enabled = true;
        game_config.bump = ctx.bumps.game_config;

        Ok(())
    }

    pub fn update_game_config(
        ctx: Context<UpdateGameConfig>,
        args: UpdateGameConfigArgs,
    ) -> Result<()> {
        validate_fee_bps(args.platform_fee_bps)?;
        validate_stake(args.max_stake_amount, args.max_stake_amount)?;
        validate_game_config_binding(ctx.accounts.global_config.key(), &ctx.accounts.game_config)?;

        let game_config = &mut ctx.accounts.game_config;
        game_config.result_authority = args.result_authority;
        game_config.supported_mint = args.supported_mint;
        game_config.max_stake_amount = args.max_stake_amount;
        game_config.platform_fee_bps = args.platform_fee_bps;
        game_config.paused = args.paused;
        game_config.mint_enabled = args.mint_enabled;

        Ok(())
    }

    pub fn create_contest(ctx: Context<CreateContest>, args: CreateContestArgs) -> Result<()> {
        validate_contest_id(&args.contest_id)?;
        validate_rules_hash(&args.rules_hash)?;
        validate_game_config_binding(ctx.accounts.global_config.key(), &ctx.accounts.game_config)?;
        validate_game_accepts_new_contests(&ctx.accounts.global_config, &ctx.accounts.game_config)?;
        validate_mint(&ctx.accounts.game_config, args.mint)?;
        validate_stake(args.stake_amount, ctx.accounts.game_config.max_stake_amount)?;
        require!(
            ctx.accounts.mint.key() == args.mint,
            EscrowError::UnknownMint
        );

        let now = Clock::get()?.unix_timestamp;
        require!(args.expires_at > now, EscrowError::ContestAlreadyExpired);

        {
            let contest = &mut ctx.accounts.contest;
            contest.game_config = ctx.accounts.game_config.key();
            contest.contest_id = args.contest_id;
            contest.mint = args.mint;
            contest.vault = ctx.accounts.contest_vault.key();
            contest.stake_amount = args.stake_amount;
            contest.creator = ctx.accounts.creator.key();
            contest.joiner = Pubkey::default();
            contest.result_authority = ctx.accounts.game_config.result_authority;
            contest.winner = Pubkey::default();
            contest.rules_hash = args.rules_hash;
            contest.result_hash = String::new();
            contest.expires_at = args.expires_at;
            contest.created_at = now;
            contest.settled_at = 0;
            contest.state = ContestState::Created;
            contest.bump = ctx.bumps.contest;
            contest.vault_bump = ctx.bumps.contest_vault;
            contest.vault_authority_bump = ctx.bumps.vault_authority;
        }

        transfer_player_to_vault(
            &ctx.accounts.token_program,
            &ctx.accounts.creator_token_account,
            &ctx.accounts.mint,
            &ctx.accounts.contest_vault,
            &ctx.accounts.creator,
            args.stake_amount,
        )?;

        Ok(())
    }

    pub fn create_native_contest(
        ctx: Context<CreateNativeContest>,
        args: CreateNativeContestArgs,
    ) -> Result<()> {
        validate_contest_id(&args.contest_id)?;
        validate_rules_hash(&args.rules_hash)?;
        validate_game_config_binding(ctx.accounts.global_config.key(), &ctx.accounts.game_config)?;
        validate_game_accepts_new_contests(&ctx.accounts.global_config, &ctx.accounts.game_config)?;
        validate_stake(args.stake_amount, ctx.accounts.game_config.max_stake_amount)?;

        let now = Clock::get()?.unix_timestamp;
        require!(args.expires_at > now, EscrowError::ContestAlreadyExpired);

        {
            let contest = &mut ctx.accounts.native_contest;
            contest.asset_kind = AssetKind::NativeSol;
            contest.game_config = ctx.accounts.game_config.key();
            contest.contest_id = args.contest_id;
            contest.stake_amount = args.stake_amount;
            contest.creator = ctx.accounts.creator.key();
            contest.joiner = Pubkey::default();
            contest.rent_payer = ctx.accounts.rent_payer.key();
            contest.rent_recipient = ctx.accounts.rent_payer.key();
            contest.result_authority = ctx.accounts.game_config.result_authority;
            contest.winner = Pubkey::default();
            contest.rules_hash = args.rules_hash;
            contest.result_hash = String::new();
            contest.expires_at = args.expires_at;
            contest.created_at = now;
            contest.settled_at = 0;
            contest.platform_fee_bps = ctx.accounts.game_config.platform_fee_bps;
            contest.state = ContestState::Created;
            contest.bump = ctx.bumps.native_contest;
        }

        transfer_native_sol_from_signer(
            &ctx.accounts.creator.to_account_info(),
            &ctx.accounts.native_contest.to_account_info(),
            &ctx.accounts.system_program,
            args.stake_amount,
        )?;

        Ok(())
    }

    pub fn join_contest(ctx: Context<JoinContest>) -> Result<()> {
        validate_game_config_binding(ctx.accounts.global_config.key(), &ctx.accounts.game_config)?;
        validate_contest_game_binding(ctx.accounts.game_config.key(), &ctx.accounts.contest)?;
        validate_game_accepts_new_contests(&ctx.accounts.global_config, &ctx.accounts.game_config)?;
        validate_mint(&ctx.accounts.game_config, ctx.accounts.contest.mint)?;
        require!(
            ctx.accounts.contest.state == ContestState::Created,
            EscrowError::ContestNotJoinable
        );
        require!(
            ctx.accounts.contest.creator != ctx.accounts.joiner.key(),
            EscrowError::CreatorCannotJoinOwnContest
        );

        let now = Clock::get()?.unix_timestamp;
        require!(
            ctx.accounts.contest.expires_at > now,
            EscrowError::ContestAlreadyExpired
        );
        require!(
            ctx.accounts.mint.key() == ctx.accounts.contest.mint,
            EscrowError::UnknownMint
        );

        transfer_player_to_vault(
            &ctx.accounts.token_program,
            &ctx.accounts.joiner_token_account,
            &ctx.accounts.mint,
            &ctx.accounts.contest_vault,
            &ctx.accounts.joiner,
            ctx.accounts.contest.stake_amount,
        )?;

        let contest = &mut ctx.accounts.contest;
        contest.joiner = ctx.accounts.joiner.key();
        contest.state = ContestState::Active;

        Ok(())
    }

    pub fn join_native_contest(ctx: Context<JoinNativeContest>) -> Result<()> {
        validate_game_config_binding(ctx.accounts.global_config.key(), &ctx.accounts.game_config)?;
        validate_native_contest_game_binding(
            ctx.accounts.game_config.key(),
            &ctx.accounts.native_contest,
        )?;
        validate_game_accepts_new_contests(&ctx.accounts.global_config, &ctx.accounts.game_config)?;
        require!(
            ctx.accounts.native_contest.state == ContestState::Created,
            EscrowError::ContestNotJoinable
        );
        require!(
            ctx.accounts.native_contest.creator != ctx.accounts.joiner.key(),
            EscrowError::CreatorCannotJoinOwnContest
        );

        let now = Clock::get()?.unix_timestamp;
        require!(
            ctx.accounts.native_contest.expires_at > now,
            EscrowError::ContestAlreadyExpired
        );

        transfer_native_sol_from_signer(
            &ctx.accounts.joiner.to_account_info(),
            &ctx.accounts.native_contest.to_account_info(),
            &ctx.accounts.system_program,
            ctx.accounts.native_contest.stake_amount,
        )?;

        let contest = &mut ctx.accounts.native_contest;
        contest.joiner = ctx.accounts.joiner.key();
        contest.state = ContestState::Active;

        Ok(())
    }

    pub fn cancel_contest(ctx: Context<CancelContest>) -> Result<()> {
        let contest = &mut ctx.accounts.contest;
        require!(
            contest.creator == ctx.accounts.creator.key(),
            EscrowError::UnauthorizedContestSigner
        );
        require!(
            contest.state == ContestState::Created,
            EscrowError::ContestNotCancellable
        );

        transfer_vault_to_player(
            &ctx.accounts.token_program,
            &ctx.accounts.contest_vault,
            &ctx.accounts.mint,
            &ctx.accounts.creator_token_account,
            &ctx.accounts.vault_authority,
            contest.key(),
            contest,
            contest.stake_amount,
        )?;

        contest.state = ContestState::Cancelled;

        Ok(())
    }

    pub fn cancel_native_contest(ctx: Context<CancelNativeContest>) -> Result<()> {
        let contest = &mut ctx.accounts.native_contest;
        require!(
            contest.creator == ctx.accounts.creator.key(),
            EscrowError::UnauthorizedContestSigner
        );
        require!(
            contest.state == ContestState::Created,
            EscrowError::ContestNotCancellable
        );

        transfer_native_sol_from_program_account(
            &contest.to_account_info(),
            &ctx.accounts.creator.to_account_info(),
            contest.stake_amount,
        )?;

        contest.state = ContestState::Cancelled;

        Ok(())
    }

    pub fn refund_expired_contest(ctx: Context<RefundExpiredContest>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let contest = &mut ctx.accounts.contest;

        require!(contest.expires_at <= now, EscrowError::ContestNotExpired);
        require!(
            contest.state == ContestState::Created || contest.state == ContestState::Active,
            EscrowError::ContestAlreadySettled
        );
        validate_token_owner(&ctx.accounts.creator_token_account, contest.creator)?;
        if contest.state == ContestState::Active {
            validate_token_owner(&ctx.accounts.joiner_token_account, contest.joiner)?;
        }

        transfer_vault_to_player(
            &ctx.accounts.token_program,
            &ctx.accounts.contest_vault,
            &ctx.accounts.mint,
            &ctx.accounts.creator_token_account,
            &ctx.accounts.vault_authority,
            contest.key(),
            contest,
            contest.stake_amount,
        )?;

        if contest.state == ContestState::Active {
            transfer_vault_to_player(
                &ctx.accounts.token_program,
                &ctx.accounts.contest_vault,
                &ctx.accounts.mint,
                &ctx.accounts.joiner_token_account,
                &ctx.accounts.vault_authority,
                contest.key(),
                contest,
                contest.stake_amount,
            )?;
        }

        contest.state = ContestState::Expired;

        Ok(())
    }

    pub fn refund_expired_native_contest(ctx: Context<RefundExpiredNativeContest>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let contest = &mut ctx.accounts.native_contest;

        require!(contest.expires_at <= now, EscrowError::ContestNotExpired);
        require!(
            contest.state == ContestState::Created || contest.state == ContestState::Active,
            EscrowError::ContestAlreadySettled
        );
        require!(
            ctx.accounts.creator.key() == contest.creator,
            EscrowError::UnauthorizedContestSigner
        );

        let active = contest.state == ContestState::Active;
        if active {
            require!(
                ctx.accounts.joiner.key() == contest.joiner,
                EscrowError::UnauthorizedContestSigner
            );
        }

        transfer_native_sol_from_program_account(
            &contest.to_account_info(),
            &ctx.accounts.creator.to_account_info(),
            contest.stake_amount,
        )?;

        if active {
            transfer_native_sol_from_program_account(
                &contest.to_account_info(),
                &ctx.accounts.joiner.to_account_info(),
                contest.stake_amount,
            )?;
        }

        contest.state = ContestState::Expired;

        Ok(())
    }

    pub fn settle_contest(ctx: Context<SettleContest>, args: SettleContestArgs) -> Result<()> {
        validate_result_hash(&args.result_hash)?;
        validate_game_config_binding(ctx.accounts.global_config.key(), &ctx.accounts.game_config)?;
        validate_contest_game_binding(ctx.accounts.game_config.key(), &ctx.accounts.contest)?;
        validate_result_authority(
            ctx.accounts.result_authority.key(),
            &ctx.accounts.contest,
            &ctx.accounts.game_config,
        )?;
        validate_settleable(ctx.accounts.contest.state)?;
        require!(
            ctx.accounts.mint.key() == ctx.accounts.contest.mint,
            EscrowError::UnknownMint
        );

        let plan = settlement_plan(
            ctx.accounts.contest.stake_amount,
            ctx.accounts.game_config.platform_fee_bps,
            args.winner,
            ctx.accounts.contest.creator,
            ctx.accounts.contest.joiner,
        )?;
        validate_token_owner(
            &ctx.accounts.fee_token_account,
            ctx.accounts.global_config.fee_authority,
        )?;

        if plan.fee_amount > 0 {
            transfer_vault_to_player(
                &ctx.accounts.token_program,
                &ctx.accounts.contest_vault,
                &ctx.accounts.mint,
                &ctx.accounts.fee_token_account,
                &ctx.accounts.vault_authority,
                ctx.accounts.contest.key(),
                &ctx.accounts.contest,
                plan.fee_amount,
            )?;
        }

        if let Some(winner_amount) = plan.winner_amount {
            validate_token_owner(
                &ctx.accounts.winner_token_account,
                args.winner.unwrap_or(Pubkey::default()),
            )?;
            transfer_vault_to_player(
                &ctx.accounts.token_program,
                &ctx.accounts.contest_vault,
                &ctx.accounts.mint,
                &ctx.accounts.winner_token_account,
                &ctx.accounts.vault_authority,
                ctx.accounts.contest.key(),
                &ctx.accounts.contest,
                winner_amount,
            )?;
        } else {
            validate_token_owner(
                &ctx.accounts.creator_refund_token_account,
                ctx.accounts.contest.creator,
            )?;
            validate_token_owner(
                &ctx.accounts.joiner_refund_token_account,
                ctx.accounts.contest.joiner,
            )?;
            transfer_vault_to_player(
                &ctx.accounts.token_program,
                &ctx.accounts.contest_vault,
                &ctx.accounts.mint,
                &ctx.accounts.creator_refund_token_account,
                &ctx.accounts.vault_authority,
                ctx.accounts.contest.key(),
                &ctx.accounts.contest,
                plan.creator_refund_amount,
            )?;
            transfer_vault_to_player(
                &ctx.accounts.token_program,
                &ctx.accounts.contest_vault,
                &ctx.accounts.mint,
                &ctx.accounts.joiner_refund_token_account,
                &ctx.accounts.vault_authority,
                ctx.accounts.contest.key(),
                &ctx.accounts.contest,
                plan.joiner_refund_amount,
            )?;
        }

        let contest = &mut ctx.accounts.contest;
        contest.winner = args.winner.unwrap_or(Pubkey::default());
        contest.result_hash = args.result_hash;
        contest.settled_at = Clock::get()?.unix_timestamp;
        contest.state = ContestState::Settled;

        Ok(())
    }

    pub fn reclaim_contest_rent(ctx: Context<ReclaimContestRent>) -> Result<()> {
        validate_rent_reclaimable(ctx.accounts.contest.state)?;
        require!(
            ctx.accounts.contest_vault.amount == 0,
            EscrowError::ContestVaultNotEmpty
        );

        close_vault_to_rent_recipient(
            &ctx.accounts.token_program,
            &ctx.accounts.contest_vault,
            &ctx.accounts.rent_recipient,
            &ctx.accounts.vault_authority,
            ctx.accounts.contest.key(),
            &ctx.accounts.contest,
        )?;

        Ok(())
    }

    pub fn settle_native_contest(
        ctx: Context<SettleNativeContest>,
        args: SettleContestArgs,
    ) -> Result<()> {
        validate_result_hash(&args.result_hash)?;
        validate_game_config_binding(ctx.accounts.global_config.key(), &ctx.accounts.game_config)?;
        validate_native_contest_game_binding(
            ctx.accounts.game_config.key(),
            &ctx.accounts.native_contest,
        )?;
        validate_native_result_authority(
            ctx.accounts.result_authority.key(),
            &ctx.accounts.native_contest,
            &ctx.accounts.game_config,
        )?;
        validate_settleable(ctx.accounts.native_contest.state)?;
        require!(
            ctx.accounts.creator.key() == ctx.accounts.native_contest.creator,
            EscrowError::UnauthorizedContestSigner
        );
        require!(
            ctx.accounts.joiner.key() == ctx.accounts.native_contest.joiner,
            EscrowError::UnauthorizedContestSigner
        );

        let plan = settlement_plan(
            ctx.accounts.native_contest.stake_amount,
            ctx.accounts.native_contest.platform_fee_bps,
            args.winner,
            ctx.accounts.native_contest.creator,
            ctx.accounts.native_contest.joiner,
        )?;

        if plan.fee_amount > 0 {
            transfer_native_sol_from_program_account(
                &ctx.accounts.native_contest.to_account_info(),
                &ctx.accounts.fee_authority.to_account_info(),
                plan.fee_amount,
            )?;
        }

        if let Some(winner_amount) = plan.winner_amount {
            let winner_account = if args.winner == Some(ctx.accounts.native_contest.creator) {
                ctx.accounts.creator.to_account_info()
            } else {
                ctx.accounts.joiner.to_account_info()
            };
            transfer_native_sol_from_program_account(
                &ctx.accounts.native_contest.to_account_info(),
                &winner_account,
                winner_amount,
            )?;
        } else {
            transfer_native_sol_from_program_account(
                &ctx.accounts.native_contest.to_account_info(),
                &ctx.accounts.creator.to_account_info(),
                plan.creator_refund_amount,
            )?;
            transfer_native_sol_from_program_account(
                &ctx.accounts.native_contest.to_account_info(),
                &ctx.accounts.joiner.to_account_info(),
                plan.joiner_refund_amount,
            )?;
        }

        let contest = &mut ctx.accounts.native_contest;
        contest.winner = args.winner.unwrap_or(Pubkey::default());
        contest.result_hash = args.result_hash;
        contest.settled_at = Clock::get()?.unix_timestamp;
        contest.state = ContestState::Settled;

        Ok(())
    }

    pub fn create_prize_pool(
        ctx: Context<CreatePrizePool>,
        args: CreatePrizePoolArgs,
    ) -> Result<()> {
        validate_season_id(&args.season_id)?;
        require!(args.total_amount > 0, EscrowError::InvalidPrizeAmount);

        let prize_pool = &mut ctx.accounts.prize_pool;
        prize_pool.prize_authority = ctx.accounts.prize_authority.key();
        prize_pool.season_id = args.season_id;
        prize_pool.total_amount = args.total_amount;
        prize_pool.funded_amount = 0;
        prize_pool.claimed_amount = 0;
        prize_pool.results_hash = String::new();
        prize_pool.published = false;
        prize_pool.bump = ctx.bumps.prize_pool;

        Ok(())
    }

    pub fn fund_prize_pool(ctx: Context<FundPrizePool>, args: FundPrizePoolArgs) -> Result<()> {
        require!(args.amount > 0, EscrowError::InvalidPrizeAmount);
        let prize_pool = &mut ctx.accounts.prize_pool;
        validate_prize_authority(ctx.accounts.prize_authority.key(), prize_pool)?;
        prize_pool.funded_amount = prize_pool
            .funded_amount
            .checked_add(args.amount)
            .ok_or(EscrowError::MathOverflow)?;
        require!(
            prize_pool.funded_amount <= prize_pool.total_amount,
            EscrowError::PrizePoolOverfunded
        );

        Ok(())
    }

    pub fn publish_prize_results(
        ctx: Context<PublishPrizeResults>,
        args: PublishPrizeResultsArgs,
    ) -> Result<()> {
        validate_prize_results_hash(&args.results_hash)?;
        let prize_pool = &mut ctx.accounts.prize_pool;
        validate_prize_authority(ctx.accounts.prize_authority.key(), prize_pool)?;
        require!(prize_pool.funded_amount > 0, EscrowError::PrizePoolUnfunded);
        prize_pool.results_hash = args.results_hash;
        prize_pool.published = true;

        Ok(())
    }

    pub fn claim_prize(ctx: Context<ClaimPrize>, args: ClaimPrizeArgs) -> Result<()> {
        require!(args.amount > 0, EscrowError::InvalidPrizeAmount);
        validate_prize_claimable(&ctx.accounts.prize_pool, &ctx.accounts.prize_claim)?;
        validate_prize_authority(ctx.accounts.prize_authority.key(), &ctx.accounts.prize_pool)?;

        let prize_pool = &mut ctx.accounts.prize_pool;
        prize_pool.claimed_amount = prize_pool
            .claimed_amount
            .checked_add(args.amount)
            .ok_or(EscrowError::MathOverflow)?;
        require!(
            prize_pool.claimed_amount <= prize_pool.funded_amount,
            EscrowError::PrizePoolOverclaimed
        );

        let prize_claim = &mut ctx.accounts.prize_claim;
        prize_claim.prize_pool = prize_pool.key();
        prize_claim.claimant = ctx.accounts.claimant.key();
        prize_claim.amount = args.amount;
        prize_claim.claimed = true;
        prize_claim.bump = ctx.bumps.prize_claim;

        Ok(())
    }
}

#[derive(Accounts)]
pub struct InitializeGlobalConfig<'info> {
    #[account(
        init,
        payer = admin,
        space = 8 + GlobalConfig::SPACE,
        seeds = [b"global_config"],
        bump
    )]
    pub global_config: Account<'info, GlobalConfig>,
    #[account(mut)]
    pub admin: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(args: RegisterGameArgs)]
pub struct RegisterGame<'info> {
    #[account(
        seeds = [b"global_config"],
        bump = global_config.bump,
        has_one = admin @ EscrowError::UnauthorizedAdmin
    )]
    pub global_config: Account<'info, GlobalConfig>,
    #[account(
        init,
        payer = admin,
        space = 8 + GameConfig::SPACE,
        seeds = [b"game", seed_hash(&args.game_id).as_ref()],
        bump
    )]
    pub game_config: Account<'info, GameConfig>,
    #[account(mut)]
    pub admin: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateGameConfig<'info> {
    #[account(
        seeds = [b"global_config"],
        bump = global_config.bump,
        has_one = admin @ EscrowError::UnauthorizedAdmin
    )]
    pub global_config: Account<'info, GlobalConfig>,
    #[account(
        mut,
        seeds = [b"game", seed_hash(&game_config.game_id).as_ref()],
        bump = game_config.bump,
        has_one = global_config @ EscrowError::WrongGameConfig,
        has_one = admin @ EscrowError::UnauthorizedAdmin
    )]
    pub game_config: Account<'info, GameConfig>,
    pub admin: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(args: CreateContestArgs)]
pub struct CreateContest<'info> {
    #[account(seeds = [b"global_config"], bump = global_config.bump)]
    pub global_config: Box<Account<'info, GlobalConfig>>,
    #[account(
        seeds = [b"game", seed_hash(&game_config.game_id).as_ref()],
        bump = game_config.bump,
        has_one = global_config @ EscrowError::WrongGameConfig
    )]
    pub game_config: Box<Account<'info, GameConfig>>,
    #[account(address = game_config.supported_mint @ EscrowError::UnknownMint)]
    pub mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        init,
        payer = creator,
        space = 8 + Contest::SPACE,
        seeds = [
            b"contest",
            game_config.key().as_ref(),
            seed_hash(&args.contest_id).as_ref()
        ],
        bump
    )]
    pub contest: Box<Account<'info, Contest>>,
    #[account(
        init,
        payer = creator,
        token::mint = mint,
        token::authority = vault_authority,
        token::token_program = token_program,
        seeds = [b"contest_vault", contest.key().as_ref(), mint.key().as_ref()],
        bump
    )]
    pub contest_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    /// CHECK: PDA authority for the contest vault; never stores data.
    #[account(seeds = [b"vault_authority", contest.key().as_ref()], bump)]
    pub vault_authority: UncheckedAccount<'info>,
    #[account(
        mut,
        token::mint = mint,
        token::authority = creator,
        token::token_program = token_program
    )]
    pub creator_token_account: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut)]
    pub creator: Signer<'info>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(args: CreateNativeContestArgs)]
pub struct CreateNativeContest<'info> {
    #[account(seeds = [b"global_config"], bump = global_config.bump)]
    pub global_config: Box<Account<'info, GlobalConfig>>,
    #[account(
        seeds = [b"game", seed_hash(&game_config.game_id).as_ref()],
        bump = game_config.bump,
        has_one = global_config @ EscrowError::WrongGameConfig
    )]
    pub game_config: Box<Account<'info, GameConfig>>,
    #[account(
        init,
        payer = rent_payer,
        space = 8 + NativeContest::SPACE,
        seeds = [
            b"native_contest",
            game_config.key().as_ref(),
            seed_hash(&args.contest_id).as_ref()
        ],
        bump
    )]
    pub native_contest: Box<Account<'info, NativeContest>>,
    #[account(mut)]
    pub creator: Signer<'info>,
    #[account(mut)]
    pub rent_payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct JoinContest<'info> {
    #[account(seeds = [b"global_config"], bump = global_config.bump)]
    pub global_config: Box<Account<'info, GlobalConfig>>,
    #[account(
        seeds = [b"game", seed_hash(&game_config.game_id).as_ref()],
        bump = game_config.bump,
        has_one = global_config @ EscrowError::WrongGameConfig
    )]
    pub game_config: Box<Account<'info, GameConfig>>,
    #[account(address = contest.mint @ EscrowError::UnknownMint)]
    pub mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        mut,
        seeds = [
            b"contest",
            game_config.key().as_ref(),
            seed_hash(&contest.contest_id).as_ref()
        ],
        bump = contest.bump,
        has_one = game_config @ EscrowError::WrongGameConfig
    )]
    pub contest: Box<Account<'info, Contest>>,
    #[account(
        mut,
        address = contest.vault @ EscrowError::WrongVault,
        token::mint = mint,
        token::authority = vault_authority,
        token::token_program = token_program
    )]
    pub contest_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    /// CHECK: PDA authority for the contest vault; never stores data.
    #[account(seeds = [b"vault_authority", contest.key().as_ref()], bump = contest.vault_authority_bump)]
    pub vault_authority: UncheckedAccount<'info>,
    #[account(
        mut,
        token::mint = mint,
        token::authority = joiner,
        token::token_program = token_program
    )]
    pub joiner_token_account: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut)]
    pub joiner: Signer<'info>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct JoinNativeContest<'info> {
    #[account(seeds = [b"global_config"], bump = global_config.bump)]
    pub global_config: Box<Account<'info, GlobalConfig>>,
    #[account(
        seeds = [b"game", seed_hash(&game_config.game_id).as_ref()],
        bump = game_config.bump,
        has_one = global_config @ EscrowError::WrongGameConfig
    )]
    pub game_config: Box<Account<'info, GameConfig>>,
    #[account(
        mut,
        seeds = [
            b"native_contest",
            game_config.key().as_ref(),
            seed_hash(&native_contest.contest_id).as_ref()
        ],
        bump = native_contest.bump,
        has_one = game_config @ EscrowError::WrongGameConfig
    )]
    pub native_contest: Box<Account<'info, NativeContest>>,
    #[account(mut)]
    pub joiner: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CancelContest<'info> {
    #[account(
        mut,
        seeds = [
            b"contest",
            contest.game_config.as_ref(),
            seed_hash(&contest.contest_id).as_ref()
        ],
        bump = contest.bump
    )]
    pub contest: Box<Account<'info, Contest>>,
    #[account(address = contest.mint @ EscrowError::UnknownMint)]
    pub mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        mut,
        address = contest.vault @ EscrowError::WrongVault,
        token::mint = mint,
        token::authority = vault_authority,
        token::token_program = token_program
    )]
    pub contest_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    /// CHECK: PDA authority for the contest vault; never stores data.
    #[account(seeds = [b"vault_authority", contest.key().as_ref()], bump = contest.vault_authority_bump)]
    pub vault_authority: UncheckedAccount<'info>,
    #[account(
        mut,
        token::mint = mint,
        token::authority = creator,
        token::token_program = token_program
    )]
    pub creator_token_account: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut)]
    pub creator: Signer<'info>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct CancelNativeContest<'info> {
    #[account(
        mut,
        close = rent_recipient,
        seeds = [
            b"native_contest",
            native_contest.game_config.as_ref(),
            seed_hash(&native_contest.contest_id).as_ref()
        ],
        bump = native_contest.bump
    )]
    pub native_contest: Box<Account<'info, NativeContest>>,
    #[account(mut)]
    pub creator: Signer<'info>,
    #[account(
        mut,
        address = native_contest.rent_recipient @ EscrowError::WrongRentRecipient
    )]
    /// CHECK: Rent recipient is fixed in native contest state and receives close lamports only.
    pub rent_recipient: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct RefundExpiredContest<'info> {
    #[account(
        mut,
        seeds = [
            b"contest",
            contest.game_config.as_ref(),
            seed_hash(&contest.contest_id).as_ref()
        ],
        bump = contest.bump
    )]
    pub contest: Box<Account<'info, Contest>>,
    #[account(address = contest.mint @ EscrowError::UnknownMint)]
    pub mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        mut,
        address = contest.vault @ EscrowError::WrongVault,
        token::mint = mint,
        token::authority = vault_authority,
        token::token_program = token_program
    )]
    pub contest_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    /// CHECK: PDA authority for the contest vault; never stores data.
    #[account(seeds = [b"vault_authority", contest.key().as_ref()], bump = contest.vault_authority_bump)]
    pub vault_authority: UncheckedAccount<'info>,
    #[account(token::mint = mint, token::token_program = token_program)]
    pub creator_token_account: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(token::mint = mint, token::token_program = token_program)]
    pub joiner_token_account: Box<InterfaceAccount<'info, TokenAccount>>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct RefundExpiredNativeContest<'info> {
    #[account(
        mut,
        close = rent_recipient,
        seeds = [
            b"native_contest",
            native_contest.game_config.as_ref(),
            seed_hash(&native_contest.contest_id).as_ref()
        ],
        bump = native_contest.bump
    )]
    pub native_contest: Box<Account<'info, NativeContest>>,
    #[account(mut)]
    /// CHECK: Creator address is validated against native contest state in the handler.
    pub creator: UncheckedAccount<'info>,
    #[account(mut)]
    /// CHECK: Joiner address is validated when the native contest had become active.
    pub joiner: UncheckedAccount<'info>,
    #[account(
        mut,
        address = native_contest.rent_recipient @ EscrowError::WrongRentRecipient
    )]
    /// CHECK: Rent recipient is fixed in native contest state and receives close lamports only.
    pub rent_recipient: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct SettleContest<'info> {
    #[account(
        seeds = [b"global_config"],
        bump = global_config.bump,
        has_one = fee_authority @ EscrowError::WrongFeeAuthority
    )]
    pub global_config: Box<Account<'info, GlobalConfig>>,
    #[account(
        seeds = [b"game", seed_hash(&game_config.game_id).as_ref()],
        bump = game_config.bump,
        has_one = global_config @ EscrowError::WrongGameConfig
    )]
    pub game_config: Box<Account<'info, GameConfig>>,
    /// CHECK: Fee recipient owner recorded on global_config.
    pub fee_authority: UncheckedAccount<'info>,
    #[account(address = contest.mint @ EscrowError::UnknownMint)]
    pub mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        mut,
        seeds = [
            b"contest",
            game_config.key().as_ref(),
            seed_hash(&contest.contest_id).as_ref()
        ],
        bump = contest.bump,
        has_one = game_config @ EscrowError::WrongGameConfig
    )]
    pub contest: Box<Account<'info, Contest>>,
    #[account(
        mut,
        address = contest.vault @ EscrowError::WrongVault,
        token::mint = mint,
        token::authority = vault_authority,
        token::token_program = token_program
    )]
    pub contest_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    /// CHECK: PDA authority for the contest vault; never stores data.
    #[account(seeds = [b"vault_authority", contest.key().as_ref()], bump = contest.vault_authority_bump)]
    pub vault_authority: UncheckedAccount<'info>,
    pub result_authority: Signer<'info>,
    #[account(token::mint = mint, token::token_program = token_program)]
    pub winner_token_account: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(token::mint = mint, token::token_program = token_program)]
    pub creator_refund_token_account: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(token::mint = mint, token::token_program = token_program)]
    pub joiner_refund_token_account: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(token::mint = mint, token::token_program = token_program)]
    pub fee_token_account: Box<InterfaceAccount<'info, TokenAccount>>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct ReclaimContestRent<'info> {
    #[account(
        mut,
        close = rent_recipient,
        seeds = [
            b"contest",
            contest.game_config.as_ref(),
            seed_hash(&contest.contest_id).as_ref()
        ],
        bump = contest.bump
    )]
    pub contest: Box<Account<'info, Contest>>,
    #[account(address = contest.mint @ EscrowError::UnknownMint)]
    pub mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        mut,
        address = contest.vault @ EscrowError::WrongVault,
        token::mint = mint,
        token::authority = vault_authority,
        token::token_program = token_program
    )]
    pub contest_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    /// CHECK: PDA authority for the contest vault; never stores data.
    #[account(seeds = [b"vault_authority", contest.key().as_ref()], bump = contest.vault_authority_bump)]
    pub vault_authority: UncheckedAccount<'info>,
    #[account(
        mut,
        address = contest.creator @ EscrowError::WrongRentRecipient
    )]
    /// CHECK: The creator paid SPL contest/vault rent and receives close lamports only.
    pub rent_recipient: UncheckedAccount<'info>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct SettleNativeContest<'info> {
    #[account(
        seeds = [b"global_config"],
        bump = global_config.bump,
        has_one = fee_authority @ EscrowError::WrongFeeAuthority
    )]
    pub global_config: Box<Account<'info, GlobalConfig>>,
    #[account(
        seeds = [b"game", seed_hash(&game_config.game_id).as_ref()],
        bump = game_config.bump,
        has_one = global_config @ EscrowError::WrongGameConfig
    )]
    pub game_config: Box<Account<'info, GameConfig>>,
    #[account(mut)]
    /// CHECK: Fee recipient is fixed by global_config.
    pub fee_authority: UncheckedAccount<'info>,
    #[account(
        mut,
        close = rent_recipient,
        seeds = [
            b"native_contest",
            game_config.key().as_ref(),
            seed_hash(&native_contest.contest_id).as_ref()
        ],
        bump = native_contest.bump,
        has_one = game_config @ EscrowError::WrongGameConfig
    )]
    pub native_contest: Box<Account<'info, NativeContest>>,
    pub result_authority: Signer<'info>,
    #[account(mut)]
    /// CHECK: Creator address is validated against native contest state in the handler.
    pub creator: UncheckedAccount<'info>,
    #[account(mut)]
    /// CHECK: Joiner address is validated against native contest state in the handler.
    pub joiner: UncheckedAccount<'info>,
    #[account(
        mut,
        address = native_contest.rent_recipient @ EscrowError::WrongRentRecipient
    )]
    /// CHECK: Rent recipient is fixed in native contest state and receives close lamports only.
    pub rent_recipient: UncheckedAccount<'info>,
}

#[derive(Accounts)]
#[instruction(args: CreatePrizePoolArgs)]
pub struct CreatePrizePool<'info> {
    #[account(
        init,
        payer = prize_authority,
        space = 8 + PrizePool::SPACE,
        seeds = [b"prize_pool", seed_hash(&args.season_id).as_ref()],
        bump
    )]
    pub prize_pool: Account<'info, PrizePool>,
    #[account(mut)]
    pub prize_authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct FundPrizePool<'info> {
    #[account(
        mut,
        seeds = [b"prize_pool", seed_hash(&prize_pool.season_id).as_ref()],
        bump = prize_pool.bump
    )]
    pub prize_pool: Account<'info, PrizePool>,
    pub prize_authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct PublishPrizeResults<'info> {
    #[account(
        mut,
        seeds = [b"prize_pool", seed_hash(&prize_pool.season_id).as_ref()],
        bump = prize_pool.bump
    )]
    pub prize_pool: Account<'info, PrizePool>,
    pub prize_authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct ClaimPrize<'info> {
    #[account(
        mut,
        seeds = [b"prize_pool", seed_hash(&prize_pool.season_id).as_ref()],
        bump = prize_pool.bump
    )]
    pub prize_pool: Account<'info, PrizePool>,
    pub prize_authority: Signer<'info>,
    #[account(
        init,
        payer = claimant,
        space = 8 + PrizeClaim::SPACE,
        seeds = [b"prize_claim", prize_pool.key().as_ref(), claimant.key().as_ref()],
        bump
    )]
    pub prize_claim: Account<'info, PrizeClaim>,
    #[account(mut)]
    pub claimant: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[account]
pub struct GlobalConfig {
    pub admin: Pubkey,
    pub fee_authority: Pubkey,
    pub platform_fee_bps: u16,
    pub paused: bool,
    pub bump: u8,
}

impl GlobalConfig {
    pub const SPACE: usize = 32 + 32 + 2 + 1 + 1;
}

#[account]
pub struct GameConfig {
    pub global_config: Pubkey,
    pub game_id: String,
    pub admin: Pubkey,
    pub result_authority: Pubkey,
    pub supported_mint: Pubkey,
    pub max_stake_amount: u64,
    pub platform_fee_bps: u16,
    pub paused: bool,
    pub mint_enabled: bool,
    pub bump: u8,
}

impl GameConfig {
    pub const SPACE: usize = 32 + (4 + GAME_ID_MAX_LEN) + 32 + 32 + 32 + 8 + 2 + 1 + 1 + 1;
}

#[account]
pub struct Contest {
    pub game_config: Pubkey,
    pub contest_id: String,
    pub mint: Pubkey,
    pub vault: Pubkey,
    pub stake_amount: u64,
    pub creator: Pubkey,
    pub joiner: Pubkey,
    pub result_authority: Pubkey,
    pub winner: Pubkey,
    pub rules_hash: String,
    pub result_hash: String,
    pub expires_at: i64,
    pub created_at: i64,
    pub settled_at: i64,
    pub state: ContestState,
    pub bump: u8,
    pub vault_bump: u8,
    pub vault_authority_bump: u8,
}

#[account]
pub struct NativeContest {
    pub asset_kind: AssetKind,
    pub game_config: Pubkey,
    pub contest_id: String,
    pub stake_amount: u64,
    pub creator: Pubkey,
    pub joiner: Pubkey,
    pub rent_payer: Pubkey,
    pub rent_recipient: Pubkey,
    pub result_authority: Pubkey,
    pub winner: Pubkey,
    pub rules_hash: String,
    pub result_hash: String,
    pub expires_at: i64,
    pub created_at: i64,
    pub settled_at: i64,
    pub platform_fee_bps: u16,
    pub state: ContestState,
    pub bump: u8,
}

#[account]
pub struct PrizePool {
    pub prize_authority: Pubkey,
    pub season_id: String,
    pub total_amount: u64,
    pub funded_amount: u64,
    pub claimed_amount: u64,
    pub results_hash: String,
    pub published: bool,
    pub bump: u8,
}

impl PrizePool {
    pub const SPACE: usize =
        32 + (4 + SEASON_ID_MAX_LEN) + 8 + 8 + 8 + (4 + PRIZE_RESULTS_HASH_MAX_LEN) + 1 + 1;
}

#[account]
pub struct PrizeClaim {
    pub prize_pool: Pubkey,
    pub claimant: Pubkey,
    pub amount: u64,
    pub claimed: bool,
    pub bump: u8,
}

impl PrizeClaim {
    pub const SPACE: usize = 32 + 32 + 8 + 1 + 1;
}

impl Contest {
    pub const SPACE: usize = 32
        + (4 + CONTEST_ID_MAX_LEN)
        + 32
        + 32
        + 8
        + 32
        + 32
        + 32
        + 32
        + (4 + RULES_HASH_MAX_LEN)
        + (4 + RESULT_HASH_MAX_LEN)
        + 8
        + 8
        + 8
        + 1
        + 1
        + 1
        + 1;
}

impl NativeContest {
    pub const SPACE: usize = 1
        + 32
        + (4 + CONTEST_ID_MAX_LEN)
        + 8
        + 32
        + 32
        + 32
        + 32
        + 32
        + 32
        + (4 + RULES_HASH_MAX_LEN)
        + (4 + RESULT_HASH_MAX_LEN)
        + 8
        + 8
        + 8
        + 2
        + 1
        + 1;
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct InitializeGlobalConfigArgs {
    pub fee_authority: Pubkey,
    pub platform_fee_bps: u16,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct RegisterGameArgs {
    pub game_id: String,
    pub result_authority: Pubkey,
    pub supported_mint: Pubkey,
    pub max_stake_amount: u64,
    pub platform_fee_bps: u16,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct UpdateGameConfigArgs {
    pub result_authority: Pubkey,
    pub supported_mint: Pubkey,
    pub max_stake_amount: u64,
    pub platform_fee_bps: u16,
    pub paused: bool,
    pub mint_enabled: bool,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct CreateContestArgs {
    pub contest_id: String,
    pub mint: Pubkey,
    pub stake_amount: u64,
    pub rules_hash: String,
    pub expires_at: i64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct CreateNativeContestArgs {
    pub contest_id: String,
    pub stake_amount: u64,
    pub rules_hash: String,
    pub expires_at: i64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct SettleContestArgs {
    pub winner: Option<Pubkey>,
    pub result_hash: String,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct CreatePrizePoolArgs {
    pub season_id: String,
    pub total_amount: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct FundPrizePoolArgs {
    pub amount: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct PublishPrizeResultsArgs {
    pub results_hash: String,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct ClaimPrizeArgs {
    pub amount: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub enum ContestState {
    Created,
    Active,
    Cancelled,
    Expired,
    Settled,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub enum AssetKind {
    NativeSol,
    SplToken,
}

#[error_code]
pub enum EscrowError {
    #[msg("Only the configured admin can perform this action.")]
    UnauthorizedAdmin,
    #[msg("The configured result authority must settle contests.")]
    UnauthorizedResultAuthority,
    #[msg("The contest signer is not authorized.")]
    UnauthorizedContestSigner,
    #[msg("The global or game config is paused.")]
    GamePaused,
    #[msg("The provided mint is not supported by this game.")]
    UnknownMint,
    #[msg("The supported mint is currently disabled.")]
    MintDisabled,
    #[msg("Stake amount must be positive.")]
    InvalidStake,
    #[msg("Stake amount exceeds the configured max stake.")]
    StakeAboveMax,
    #[msg("Platform fee basis points must be between 0 and 10000.")]
    InvalidFeeBps,
    #[msg("Game id is empty or too long.")]
    InvalidGameId,
    #[msg("Contest id is empty or too long.")]
    InvalidContestId,
    #[msg("Rules hash is empty or too long.")]
    InvalidRulesHash,
    #[msg("Result hash is empty or too long.")]
    InvalidResultHash,
    #[msg("Contest expiry is already in the past.")]
    ContestAlreadyExpired,
    #[msg("Contest is not joinable.")]
    ContestNotJoinable,
    #[msg("Creator cannot join their own contest.")]
    CreatorCannotJoinOwnContest,
    #[msg("Contest is not cancellable.")]
    ContestNotCancellable,
    #[msg("Contest has not expired.")]
    ContestNotExpired,
    #[msg("Contest has already been settled or closed.")]
    ContestAlreadySettled,
    #[msg("Contest is not settleable.")]
    ContestNotSettleable,
    #[msg("Contest belongs to a different game config.")]
    WrongGameConfig,
    #[msg("Contest vault does not match the stored contest vault.")]
    WrongVault,
    #[msg("Rent recipient does not match the stored native contest recipient.")]
    WrongRentRecipient,
    #[msg("Contest asset kind does not match this instruction path.")]
    WrongAssetKind,
    #[msg("Fee authority does not match global config.")]
    WrongFeeAuthority,
    #[msg("Token account owner does not match the expected recipient.")]
    WrongTokenOwner,
    #[msg("Winner must be one of the contest players or omitted for a draw.")]
    InvalidWinner,
    #[msg("Escrow arithmetic overflowed.")]
    MathOverflow,
    #[msg("Season id is empty or too long.")]
    InvalidSeasonId,
    #[msg("Prize amount must be positive.")]
    InvalidPrizeAmount,
    #[msg("Prize pool cannot be funded above its configured total.")]
    PrizePoolOverfunded,
    #[msg("Prize pool must be funded before publishing results.")]
    PrizePoolUnfunded,
    #[msg("Prize results hash is empty or too long.")]
    InvalidPrizeResultsHash,
    #[msg("Only the configured prize authority can perform this action.")]
    UnauthorizedPrizeAuthority,
    #[msg("Prize results must be published before claims.")]
    PrizeResultsUnpublished,
    #[msg("Prize has already been claimed.")]
    PrizeAlreadyClaimed,
    #[msg("Prize claims cannot exceed the funded prize amount.")]
    PrizePoolOverclaimed,
    #[msg("Native SOL escrow balance is insufficient for this payout.")]
    InsufficientNativeEscrowBalance,
    #[msg("Contest rent can only be reclaimed after a terminal contest state.")]
    ContestRentNotReclaimable,
    #[msg("Contest vault must be empty before rent can be reclaimed.")]
    ContestVaultNotEmpty,
}

fn validate_game_id(game_id: &str) -> Result<()> {
    require!(
        !game_id.is_empty() && game_id.len() <= GAME_ID_MAX_LEN,
        EscrowError::InvalidGameId
    );
    Ok(())
}

fn validate_contest_id(contest_id: &str) -> Result<()> {
    require!(
        !contest_id.is_empty() && contest_id.len() <= CONTEST_ID_MAX_LEN,
        EscrowError::InvalidContestId
    );
    Ok(())
}

fn validate_rules_hash(rules_hash: &str) -> Result<()> {
    require!(
        !rules_hash.is_empty() && rules_hash.len() <= RULES_HASH_MAX_LEN,
        EscrowError::InvalidRulesHash
    );
    Ok(())
}

fn validate_result_hash(result_hash: &str) -> Result<()> {
    require!(
        !result_hash.is_empty() && result_hash.len() <= RESULT_HASH_MAX_LEN,
        EscrowError::InvalidResultHash
    );
    Ok(())
}

fn validate_season_id(season_id: &str) -> Result<()> {
    require!(
        !season_id.is_empty() && season_id.len() <= SEASON_ID_MAX_LEN,
        EscrowError::InvalidSeasonId
    );
    Ok(())
}

fn validate_prize_results_hash(results_hash: &str) -> Result<()> {
    require!(
        !results_hash.is_empty() && results_hash.len() <= PRIZE_RESULTS_HASH_MAX_LEN,
        EscrowError::InvalidPrizeResultsHash
    );
    Ok(())
}

fn validate_fee_bps(platform_fee_bps: u16) -> Result<()> {
    require!(platform_fee_bps <= 10_000, EscrowError::InvalidFeeBps);
    Ok(())
}

fn validate_stake(stake_amount: u64, max_stake_amount: u64) -> Result<()> {
    require!(stake_amount > 0, EscrowError::InvalidStake);
    require!(stake_amount <= max_stake_amount, EscrowError::StakeAboveMax);
    Ok(())
}

fn validate_game_accepts_new_contests(
    global_config: &GlobalConfig,
    game_config: &GameConfig,
) -> Result<()> {
    require!(
        !global_config.paused && !game_config.paused,
        EscrowError::GamePaused
    );
    Ok(())
}

fn validate_mint(game_config: &GameConfig, mint: Pubkey) -> Result<()> {
    require!(game_config.supported_mint == mint, EscrowError::UnknownMint);
    require!(game_config.mint_enabled, EscrowError::MintDisabled);
    Ok(())
}

fn validate_game_config_binding(global_config_key: Pubkey, game_config: &GameConfig) -> Result<()> {
    require!(
        game_config.global_config == global_config_key,
        EscrowError::WrongGameConfig
    );
    Ok(())
}

fn validate_contest_game_binding(game_config_key: Pubkey, contest: &Contest) -> Result<()> {
    require!(
        contest.game_config == game_config_key,
        EscrowError::WrongGameConfig
    );
    Ok(())
}

fn validate_native_contest_game_binding(
    game_config_key: Pubkey,
    contest: &NativeContest,
) -> Result<()> {
    require!(
        contest.asset_kind == AssetKind::NativeSol,
        EscrowError::WrongAssetKind
    );
    require!(
        contest.game_config == game_config_key,
        EscrowError::WrongGameConfig
    );
    Ok(())
}

fn validate_result_authority(
    signer: Pubkey,
    contest: &Contest,
    game_config: &GameConfig,
) -> Result<()> {
    require!(
        signer == contest.result_authority && signer == game_config.result_authority,
        EscrowError::UnauthorizedResultAuthority
    );
    Ok(())
}

fn validate_native_result_authority(
    signer: Pubkey,
    contest: &NativeContest,
    game_config: &GameConfig,
) -> Result<()> {
    require!(
        signer == contest.result_authority && signer == game_config.result_authority,
        EscrowError::UnauthorizedResultAuthority
    );
    Ok(())
}

fn validate_prize_authority(signer: Pubkey, prize_pool: &PrizePool) -> Result<()> {
    require!(
        signer == prize_pool.prize_authority,
        EscrowError::UnauthorizedPrizeAuthority
    );
    Ok(())
}

fn validate_prize_claimable(prize_pool: &PrizePool, prize_claim: &PrizeClaim) -> Result<()> {
    require!(prize_pool.published, EscrowError::PrizeResultsUnpublished);
    require!(!prize_claim.claimed, EscrowError::PrizeAlreadyClaimed);
    Ok(())
}

fn seed_hash(value: &str) -> [u8; 32] {
    hash(value.as_bytes()).to_bytes()
}

fn validate_settleable(state: ContestState) -> Result<()> {
    require!(
        state != ContestState::Settled,
        EscrowError::ContestAlreadySettled
    );
    require!(
        state == ContestState::Active,
        EscrowError::ContestNotSettleable
    );
    Ok(())
}

fn validate_rent_reclaimable(state: ContestState) -> Result<()> {
    require!(
        matches!(
            state,
            ContestState::Settled | ContestState::Cancelled | ContestState::Expired
        ),
        EscrowError::ContestRentNotReclaimable
    );
    Ok(())
}

fn validate_token_owner(token_account: &TokenAccount, expected_owner: Pubkey) -> Result<()> {
    require!(
        token_account.owner == expected_owner,
        EscrowError::WrongTokenOwner
    );
    Ok(())
}

fn close_vault_to_rent_recipient<'info>(
    token_program: &Interface<'info, TokenInterface>,
    token_account: &InterfaceAccount<'info, TokenAccount>,
    destination: &UncheckedAccount<'info>,
    authority: &UncheckedAccount<'info>,
    contest_key: Pubkey,
    contest: &Contest,
) -> Result<()> {
    let bump = [contest.vault_authority_bump];
    let authority_seeds: &[&[u8]] = &[b"vault_authority", contest_key.as_ref(), &bump];
    let signer_seeds = &[authority_seeds];
    let accounts = CloseAccount {
        account: token_account.to_account_info(),
        destination: destination.to_account_info(),
        authority: authority.to_account_info(),
    };

    token_interface::close_account(CpiContext::new_with_signer(
        token_program.key(),
        accounts,
        signer_seeds,
    ))
}

fn transfer_player_to_vault<'info>(
    token_program: &Interface<'info, TokenInterface>,
    from: &InterfaceAccount<'info, TokenAccount>,
    mint: &InterfaceAccount<'info, Mint>,
    to: &InterfaceAccount<'info, TokenAccount>,
    authority: &Signer<'info>,
    amount: u64,
) -> Result<()> {
    let accounts = TransferChecked {
        from: from.to_account_info(),
        mint: mint.to_account_info(),
        to: to.to_account_info(),
        authority: authority.to_account_info(),
    };

    token_interface::transfer_checked(
        CpiContext::new(token_program.key(), accounts),
        amount,
        mint.decimals,
    )
}

fn transfer_vault_to_player<'info>(
    token_program: &Interface<'info, TokenInterface>,
    from: &InterfaceAccount<'info, TokenAccount>,
    mint: &InterfaceAccount<'info, Mint>,
    to: &InterfaceAccount<'info, TokenAccount>,
    authority: &UncheckedAccount<'info>,
    contest_key: Pubkey,
    contest: &Contest,
    amount: u64,
) -> Result<()> {
    let bump = [contest.vault_authority_bump];
    let authority_seeds: &[&[u8]] = &[b"vault_authority", contest_key.as_ref(), &bump];
    let signer_seeds = &[authority_seeds];
    let accounts = TransferChecked {
        from: from.to_account_info(),
        mint: mint.to_account_info(),
        to: to.to_account_info(),
        authority: authority.to_account_info(),
    };

    token_interface::transfer_checked(
        CpiContext::new_with_signer(token_program.key(), accounts, signer_seeds),
        amount,
        mint.decimals,
    )
}

fn transfer_native_sol_from_signer<'info>(
    from: &AccountInfo<'info>,
    to: &AccountInfo<'info>,
    system_program: &Program<'info, System>,
    amount: u64,
) -> Result<()> {
    if amount == 0 {
        return Ok(());
    }

    let accounts = anchor_lang::system_program::Transfer {
        from: from.clone(),
        to: to.clone(),
    };

    anchor_lang::system_program::transfer(CpiContext::new(system_program.key(), accounts), amount)
}

fn transfer_native_sol_from_program_account<'info>(
    from: &AccountInfo<'info>,
    to: &AccountInfo<'info>,
    amount: u64,
) -> Result<()> {
    if amount == 0 {
        return Ok(());
    }

    let from_start = from.lamports();
    require!(
        from_start >= amount,
        EscrowError::InsufficientNativeEscrowBalance
    );
    let to_start = to.lamports();

    **from.try_borrow_mut_lamports()? = from_start
        .checked_sub(amount)
        .ok_or(EscrowError::MathOverflow)?;
    **to.try_borrow_mut_lamports()? = to_start
        .checked_add(amount)
        .ok_or(EscrowError::MathOverflow)?;

    Ok(())
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct SettlementPlan {
    winner_amount: Option<u64>,
    fee_amount: u64,
    creator_refund_amount: u64,
    joiner_refund_amount: u64,
}

fn settlement_plan(
    stake_amount: u64,
    platform_fee_bps: u16,
    winner: Option<Pubkey>,
    creator: Pubkey,
    joiner: Pubkey,
) -> Result<SettlementPlan> {
    let total = stake_amount
        .checked_mul(2)
        .ok_or(EscrowError::MathOverflow)?;

    match winner {
        Some(winner) if winner != Pubkey::default() => {
            require!(
                winner == creator || winner == joiner,
                EscrowError::InvalidWinner
            );
            let fee_amount = ((total as u128) * (platform_fee_bps as u128) / 10_000)
                .try_into()
                .map_err(|_| EscrowError::MathOverflow)?;
            let winner_amount = total
                .checked_sub(fee_amount)
                .ok_or(EscrowError::MathOverflow)?;

            Ok(SettlementPlan {
                winner_amount: Some(winner_amount),
                fee_amount,
                creator_refund_amount: 0,
                joiner_refund_amount: 0,
            })
        }
        _ => Ok(SettlementPlan {
            winner_amount: None,
            fee_amount: 0,
            creator_refund_amount: stake_amount,
            joiner_refund_amount: stake_amount,
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validation_rejects_paused_games() {
        let global = GlobalConfig {
            admin: Pubkey::default(),
            fee_authority: Pubkey::default(),
            platform_fee_bps: 0,
            paused: true,
            bump: 0,
        };
        let game = game_config(false, true, Pubkey::new_unique());

        assert!(validate_game_accepts_new_contests(&global, &game).is_err());
    }

    #[test]
    fn validation_rejects_disabled_and_unknown_mints() {
        let mint = Pubkey::new_unique();
        let disabled = game_config(false, false, mint);
        let enabled = game_config(false, true, mint);

        assert!(validate_mint(&disabled, mint).is_err());
        assert!(validate_mint(&enabled, Pubkey::new_unique()).is_err());
        assert!(validate_mint(&enabled, mint).is_ok());
    }

    #[test]
    fn validation_rejects_stakes_above_max() {
        assert!(validate_stake(0, 10).is_err());
        assert!(validate_stake(11, 10).is_err());
        assert!(validate_stake(10, 10).is_ok());
    }

    #[test]
    fn settlement_plan_pays_winner_and_routes_fee() {
        let creator = Pubkey::new_unique();
        let joiner = Pubkey::new_unique();
        let plan = settlement_plan(1_000, 250, Some(creator), creator, joiner).unwrap();

        assert_eq!(
            plan,
            SettlementPlan {
                winner_amount: Some(1_950),
                fee_amount: 50,
                creator_refund_amount: 0,
                joiner_refund_amount: 0,
            }
        );
    }

    #[test]
    fn settlement_plan_draw_refunds_both_players() {
        let creator = Pubkey::new_unique();
        let joiner = Pubkey::new_unique();
        let plan = settlement_plan(1_000, 250, None, creator, joiner).unwrap();

        assert_eq!(
            plan,
            SettlementPlan {
                winner_amount: None,
                fee_amount: 0,
                creator_refund_amount: 1_000,
                joiner_refund_amount: 1_000,
            }
        );
    }

    #[test]
    fn settlement_plan_rejects_non_player_winner() {
        let creator = Pubkey::new_unique();
        let joiner = Pubkey::new_unique();

        assert!(settlement_plan(1_000, 0, Some(Pubkey::new_unique()), creator, joiner).is_err());
    }

    #[test]
    fn validation_rejects_double_settlement() {
        assert!(validate_settleable(ContestState::Active).is_ok());
        assert!(validate_settleable(ContestState::Settled).is_err());
    }

    #[test]
    fn validation_allows_rent_reclaim_only_after_terminal_states() {
        assert!(validate_rent_reclaimable(ContestState::Settled).is_ok());
        assert!(validate_rent_reclaimable(ContestState::Cancelled).is_ok());
        assert!(validate_rent_reclaimable(ContestState::Expired).is_ok());
        assert!(validate_rent_reclaimable(ContestState::Created).is_err());
        assert!(validate_rent_reclaimable(ContestState::Active).is_err());
    }

    #[test]
    fn simulated_create_contest_funds_vault() {
        let mut ledger = TestLedger::new(1_000, 1_000, 100, 0);

        ledger.create_contest().unwrap();

        assert_eq!(ledger.creator_balance, 900);
        assert_eq!(ledger.vault_balance, 100);
        assert_eq!(ledger.state, ContestState::Created);
    }

    #[test]
    fn simulated_join_contest_funds_vault() {
        let mut ledger = TestLedger::new(1_000, 1_000, 100, 0);

        ledger.create_contest().unwrap();
        ledger.join_contest().unwrap();

        assert_eq!(ledger.joiner_balance, 900);
        assert_eq!(ledger.vault_balance, 200);
        assert_eq!(ledger.state, ContestState::Active);
    }

    #[test]
    fn simulated_cancel_refunds_creator() {
        let mut ledger = TestLedger::new(1_000, 1_000, 100, 0);

        ledger.create_contest().unwrap();
        ledger.cancel_contest().unwrap();

        assert_eq!(ledger.creator_balance, 1_000);
        assert_eq!(ledger.vault_balance, 0);
        assert_eq!(ledger.state, ContestState::Cancelled);
    }

    #[test]
    fn simulated_expired_contest_refunds_players() {
        let mut ledger = TestLedger::new(1_000, 1_000, 100, 0);

        ledger.create_contest().unwrap();
        ledger.join_contest().unwrap();
        ledger.refund_expired_contest().unwrap();

        assert_eq!(ledger.creator_balance, 1_000);
        assert_eq!(ledger.joiner_balance, 1_000);
        assert_eq!(ledger.vault_balance, 0);
        assert_eq!(ledger.state, ContestState::Expired);
    }

    #[test]
    fn simulated_settlement_pays_winner_and_fee() {
        let mut ledger = TestLedger::new(1_000, 1_000, 100, 250);

        ledger.create_contest().unwrap();
        ledger.join_contest().unwrap();
        ledger.settle_contest(Some(ledger.creator)).unwrap();

        assert_eq!(ledger.creator_balance, 1_095);
        assert_eq!(ledger.joiner_balance, 900);
        assert_eq!(ledger.fee_balance, 5);
        assert_eq!(ledger.vault_balance, 0);
        assert_eq!(ledger.state, ContestState::Settled);
    }

    #[test]
    fn simulated_settled_contest_reclaims_spl_rent_to_creator() {
        let mut ledger = TestLedger::new(1_000, 1_000, 100, 250);

        ledger.create_contest().unwrap();
        ledger.join_contest().unwrap();
        ledger.settle_contest(Some(ledger.creator)).unwrap();
        ledger.reclaim_contest_rent().unwrap();

        assert_eq!(ledger.rent_recipient_balance, 18);
        assert_eq!(ledger.vault_rent_balance, 0);
        assert_eq!(ledger.contest_rent_balance, 0);
        assert!(ledger.closed);
    }

    #[test]
    fn simulated_spl_rent_reclaim_rejects_nonterminal_or_nonempty_vault() {
        let mut active = TestLedger::new(1_000, 1_000, 100, 250);
        active.create_contest().unwrap();
        active.join_contest().unwrap();
        assert!(active.reclaim_contest_rent().is_err());

        let mut nonempty = TestLedger::new(1_000, 1_000, 100, 250);
        nonempty.create_contest().unwrap();
        nonempty.state = ContestState::Cancelled;
        assert!(nonempty.reclaim_contest_rent().is_err());
    }

    #[test]
    fn simulated_draw_refunds_split() {
        let mut ledger = TestLedger::new(1_000, 1_000, 100, 250);

        ledger.create_contest().unwrap();
        ledger.join_contest().unwrap();
        ledger.settle_contest(None).unwrap();

        assert_eq!(ledger.creator_balance, 1_000);
        assert_eq!(ledger.joiner_balance, 1_000);
        assert_eq!(ledger.fee_balance, 0);
        assert_eq!(ledger.vault_balance, 0);
    }

    #[test]
    fn simulated_native_create_uses_exact_stake_and_sponsored_rent() {
        let mut ledger = NativeTestLedger::new(1_000, 1_000, 500, 100, 42, 0);

        ledger.create_native_contest(100).unwrap();

        assert_eq!(ledger.creator_balance, 900);
        assert_eq!(ledger.joiner_balance, 1_000);
        assert_eq!(ledger.rent_payer_balance, 458);
        assert_eq!(ledger.rent_recipient_balance, 0);
        assert_eq!(ledger.contest_lamports, 142);
        assert_eq!(ledger.state, ContestState::Created);
    }

    #[test]
    fn simulated_native_winner_settlement_pays_winner_fee_and_reclaims_rent() {
        let mut ledger = NativeTestLedger::new(1_000, 1_000, 500, 100, 42, 250);

        ledger.create_native_contest(100).unwrap();
        ledger.join_native_contest(ledger.joiner, 100).unwrap();
        ledger.settle_native_contest(Some(ledger.creator)).unwrap();

        assert_eq!(ledger.creator_balance, 1_095);
        assert_eq!(ledger.joiner_balance, 900);
        assert_eq!(ledger.fee_balance, 5);
        assert_eq!(ledger.rent_payer_balance, 458);
        assert_eq!(ledger.rent_recipient_balance, 42);
        assert_eq!(ledger.contest_lamports, 0);
        assert!(ledger.closed);
        assert_eq!(ledger.state, ContestState::Settled);
    }

    #[test]
    fn simulated_native_draw_refunds_players_and_reclaims_rent() {
        let mut ledger = NativeTestLedger::new(1_000, 1_000, 500, 100, 42, 250);

        ledger.create_native_contest(100).unwrap();
        ledger.join_native_contest(ledger.joiner, 100).unwrap();
        ledger.settle_native_contest(None).unwrap();

        assert_eq!(ledger.creator_balance, 1_000);
        assert_eq!(ledger.joiner_balance, 1_000);
        assert_eq!(ledger.fee_balance, 0);
        assert_eq!(ledger.rent_recipient_balance, 42);
        assert_eq!(ledger.contest_lamports, 0);
        assert!(ledger.closed);
    }

    #[test]
    fn simulated_native_cancel_refunds_creator_and_reclaims_rent() {
        let mut ledger = NativeTestLedger::new(1_000, 1_000, 500, 100, 42, 0);

        ledger.create_native_contest(100).unwrap();
        ledger.cancel_native_contest(ledger.creator).unwrap();

        assert_eq!(ledger.creator_balance, 1_000);
        assert_eq!(ledger.joiner_balance, 1_000);
        assert_eq!(ledger.rent_recipient_balance, 42);
        assert_eq!(ledger.contest_lamports, 0);
        assert!(ledger.closed);
        assert_eq!(ledger.state, ContestState::Cancelled);
    }

    #[test]
    fn simulated_native_expired_refund_returns_active_stakes_and_reclaims_rent() {
        let mut ledger = NativeTestLedger::new(1_000, 1_000, 500, 100, 42, 0);

        ledger.create_native_contest(100).unwrap();
        ledger.join_native_contest(ledger.joiner, 100).unwrap();
        ledger.refund_expired_native_contest().unwrap();

        assert_eq!(ledger.creator_balance, 1_000);
        assert_eq!(ledger.joiner_balance, 1_000);
        assert_eq!(ledger.rent_recipient_balance, 42);
        assert_eq!(ledger.contest_lamports, 0);
        assert!(ledger.closed);
        assert_eq!(ledger.state, ContestState::Expired);
    }

    #[test]
    fn simulated_native_terminal_paths_fail_safely_on_duplicate_attempts() {
        let mut ledger = NativeTestLedger::new(1_000, 1_000, 500, 100, 42, 0);

        ledger.create_native_contest(100).unwrap();
        ledger.cancel_native_contest(ledger.creator).unwrap();

        assert!(ledger.cancel_native_contest(ledger.creator).is_err());
        assert!(ledger.refund_expired_native_contest().is_err());
        assert!(ledger.settle_native_contest(Some(ledger.creator)).is_err());
        assert_eq!(ledger.creator_balance, 1_000);
        assert_eq!(ledger.rent_recipient_balance, 42);
        assert_eq!(ledger.contest_lamports, 0);
    }

    #[test]
    fn simulated_native_rejects_wrong_signer_and_wrong_stake() {
        let mut ledger = NativeTestLedger::new(1_000, 1_000, 500, 100, 42, 0);

        assert!(ledger.create_native_contest(101).is_err());
        ledger.create_native_contest(100).unwrap();
        assert!(ledger.join_native_contest(ledger.creator, 100).is_err());
        assert!(ledger.join_native_contest(ledger.joiner, 99).is_err());
        assert!(ledger.cancel_native_contest(ledger.joiner).is_err());
    }

    #[test]
    fn validation_rejects_result_signer_mismatch() {
        let mint = Pubkey::new_unique();
        let game = game_config(false, true, mint);
        let contest = contest_for_game(Pubkey::new_unique(), &game, mint);

        assert!(validate_result_authority(Pubkey::new_unique(), &contest, &game).is_err());
        assert!(validate_result_authority(game.result_authority, &contest, &game).is_ok());
    }

    #[test]
    fn validation_rejects_wrong_account_bindings() {
        let mint = Pubkey::new_unique();
        let global_config_key = Pubkey::new_unique();
        let game_config_key = Pubkey::new_unique();
        let wrong_key = Pubkey::new_unique();
        let mut game = game_config(false, true, mint);
        game.global_config = global_config_key;
        let contest = contest_for_game(game_config_key, &game, mint);

        assert!(validate_game_config_binding(global_config_key, &game).is_ok());
        assert!(validate_game_config_binding(wrong_key, &game).is_err());
        assert!(validate_contest_game_binding(game_config_key, &contest).is_ok());
        assert!(validate_contest_game_binding(wrong_key, &contest).is_err());
    }

    #[test]
    fn validation_rejects_wrong_prize_authority_and_double_claims() {
        let authority = Pubkey::new_unique();
        let pool = PrizePool {
            bump: 0,
            claimed_amount: 0,
            funded_amount: 1_000,
            prize_authority: authority,
            published: true,
            results_hash: "prize-results-v1".to_string(),
            season_id: "season-1".to_string(),
            total_amount: 1_000,
        };
        let unclaimed = PrizeClaim {
            amount: 300,
            bump: 0,
            claimant: Pubkey::new_unique(),
            claimed: false,
            prize_pool: Pubkey::new_unique(),
        };
        let claimed = PrizeClaim {
            claimed: true,
            ..unclaimed
        };

        assert!(validate_season_id("season-1").is_ok());
        assert!(validate_prize_results_hash("prize-results-v1").is_ok());
        assert!(validate_prize_authority(Pubkey::new_unique(), &pool).is_err());
        assert!(validate_prize_authority(authority, &pool).is_ok());
        assert!(validate_prize_claimable(&pool, &unclaimed).is_ok());
        assert!(validate_prize_claimable(&pool, &claimed).is_err());
    }

    #[test]
    fn validation_is_generic_and_not_gameplay_specific() {
        assert!(validate_game_id("word_duel").is_ok());
        assert!(validate_contest_id("daily-final-42").is_ok());
        assert!(validate_rules_hash("dictionary-v3").is_ok());
    }

    #[derive(Debug)]
    struct TestLedger {
        creator: Pubkey,
        joiner: Pubkey,
        creator_balance: u64,
        joiner_balance: u64,
        fee_balance: u64,
        vault_balance: u64,
        rent_recipient_balance: u64,
        vault_rent_balance: u64,
        contest_rent_balance: u64,
        stake_amount: u64,
        platform_fee_bps: u16,
        state: ContestState,
        closed: bool,
    }

    #[derive(Debug)]
    struct NativeTestLedger {
        creator: Pubkey,
        joiner: Pubkey,
        creator_balance: u64,
        joiner_balance: u64,
        rent_payer_balance: u64,
        rent_recipient_balance: u64,
        fee_balance: u64,
        contest_lamports: u64,
        stake_amount: u64,
        rent_exempt_reserve: u64,
        platform_fee_bps: u16,
        state: ContestState,
        closed: bool,
    }

    impl NativeTestLedger {
        fn new(
            creator_balance: u64,
            joiner_balance: u64,
            rent_payer_balance: u64,
            stake_amount: u64,
            rent_exempt_reserve: u64,
            platform_fee_bps: u16,
        ) -> Self {
            Self {
                creator: Pubkey::new_unique(),
                joiner: Pubkey::new_unique(),
                creator_balance,
                joiner_balance,
                rent_payer_balance,
                rent_recipient_balance: 0,
                fee_balance: 0,
                contest_lamports: 0,
                stake_amount,
                rent_exempt_reserve,
                platform_fee_bps,
                state: ContestState::Created,
                closed: false,
            }
        }

        fn create_native_contest(&mut self, deposit_amount: u64) -> Result<()> {
            self.ensure_open()?;
            validate_stake(self.stake_amount, self.stake_amount)?;
            self.validate_exact_native_deposit(deposit_amount)?;
            self.rent_payer_balance = self
                .rent_payer_balance
                .checked_sub(self.rent_exempt_reserve)
                .ok_or(EscrowError::MathOverflow)?;
            self.creator_balance = self
                .creator_balance
                .checked_sub(self.stake_amount)
                .ok_or(EscrowError::MathOverflow)?;
            self.contest_lamports = self
                .rent_exempt_reserve
                .checked_add(self.stake_amount)
                .ok_or(EscrowError::MathOverflow)?;
            self.state = ContestState::Created;
            Ok(())
        }

        fn join_native_contest(&mut self, joiner: Pubkey, deposit_amount: u64) -> Result<()> {
            self.ensure_open()?;
            require!(
                self.state == ContestState::Created,
                EscrowError::ContestNotJoinable
            );
            require!(
                joiner != self.creator,
                EscrowError::CreatorCannotJoinOwnContest
            );
            require!(
                joiner == self.joiner,
                EscrowError::UnauthorizedContestSigner
            );
            self.validate_exact_native_deposit(deposit_amount)?;
            self.joiner_balance = self
                .joiner_balance
                .checked_sub(self.stake_amount)
                .ok_or(EscrowError::MathOverflow)?;
            self.contest_lamports = self
                .contest_lamports
                .checked_add(self.stake_amount)
                .ok_or(EscrowError::MathOverflow)?;
            self.state = ContestState::Active;
            Ok(())
        }

        fn cancel_native_contest(&mut self, signer: Pubkey) -> Result<()> {
            self.ensure_open()?;
            require!(
                signer == self.creator,
                EscrowError::UnauthorizedContestSigner
            );
            require!(
                self.state == ContestState::Created,
                EscrowError::ContestNotCancellable
            );
            self.creator_balance = self
                .creator_balance
                .checked_add(self.stake_amount)
                .ok_or(EscrowError::MathOverflow)?;
            self.contest_lamports = self
                .contest_lamports
                .checked_sub(self.stake_amount)
                .ok_or(EscrowError::MathOverflow)?;
            self.state = ContestState::Cancelled;
            self.close_to_rent_recipient()
        }

        fn refund_expired_native_contest(&mut self) -> Result<()> {
            self.ensure_open()?;
            require!(
                self.state == ContestState::Created || self.state == ContestState::Active,
                EscrowError::ContestAlreadySettled
            );
            let active = self.state == ContestState::Active;
            self.creator_balance = self
                .creator_balance
                .checked_add(self.stake_amount)
                .ok_or(EscrowError::MathOverflow)?;
            self.contest_lamports = self
                .contest_lamports
                .checked_sub(self.stake_amount)
                .ok_or(EscrowError::MathOverflow)?;
            if active {
                self.joiner_balance = self
                    .joiner_balance
                    .checked_add(self.stake_amount)
                    .ok_or(EscrowError::MathOverflow)?;
                self.contest_lamports = self
                    .contest_lamports
                    .checked_sub(self.stake_amount)
                    .ok_or(EscrowError::MathOverflow)?;
            }
            self.state = ContestState::Expired;
            self.close_to_rent_recipient()
        }

        fn settle_native_contest(&mut self, winner: Option<Pubkey>) -> Result<()> {
            self.ensure_open()?;
            validate_settleable(self.state)?;
            let plan = settlement_plan(
                self.stake_amount,
                self.platform_fee_bps,
                winner,
                self.creator,
                self.joiner,
            )?;

            self.fee_balance = self
                .fee_balance
                .checked_add(plan.fee_amount)
                .ok_or(EscrowError::MathOverflow)?;
            self.contest_lamports = self
                .contest_lamports
                .checked_sub(plan.fee_amount)
                .ok_or(EscrowError::MathOverflow)?;

            if let Some(winner_amount) = plan.winner_amount {
                if winner == Some(self.creator) {
                    self.creator_balance = self
                        .creator_balance
                        .checked_add(winner_amount)
                        .ok_or(EscrowError::MathOverflow)?;
                } else {
                    self.joiner_balance = self
                        .joiner_balance
                        .checked_add(winner_amount)
                        .ok_or(EscrowError::MathOverflow)?;
                }
                self.contest_lamports = self
                    .contest_lamports
                    .checked_sub(winner_amount)
                    .ok_or(EscrowError::MathOverflow)?;
            } else {
                self.creator_balance = self
                    .creator_balance
                    .checked_add(plan.creator_refund_amount)
                    .ok_or(EscrowError::MathOverflow)?;
                self.joiner_balance = self
                    .joiner_balance
                    .checked_add(plan.joiner_refund_amount)
                    .ok_or(EscrowError::MathOverflow)?;
                self.contest_lamports = self
                    .contest_lamports
                    .checked_sub(plan.creator_refund_amount)
                    .ok_or(EscrowError::MathOverflow)?;
                self.contest_lamports = self
                    .contest_lamports
                    .checked_sub(plan.joiner_refund_amount)
                    .ok_or(EscrowError::MathOverflow)?;
            }

            self.state = ContestState::Settled;
            self.close_to_rent_recipient()
        }

        fn validate_exact_native_deposit(&self, deposit_amount: u64) -> Result<()> {
            require!(
                deposit_amount == self.stake_amount,
                EscrowError::InvalidStake
            );
            Ok(())
        }

        fn ensure_open(&self) -> Result<()> {
            require!(!self.closed, EscrowError::ContestAlreadySettled);
            Ok(())
        }

        fn close_to_rent_recipient(&mut self) -> Result<()> {
            self.rent_recipient_balance = self
                .rent_recipient_balance
                .checked_add(self.contest_lamports)
                .ok_or(EscrowError::MathOverflow)?;
            self.contest_lamports = 0;
            self.closed = true;
            Ok(())
        }
    }

    impl TestLedger {
        fn new(
            creator_balance: u64,
            joiner_balance: u64,
            stake_amount: u64,
            platform_fee_bps: u16,
        ) -> Self {
            Self {
                creator: Pubkey::new_unique(),
                joiner: Pubkey::new_unique(),
                creator_balance,
                joiner_balance,
                fee_balance: 0,
                vault_balance: 0,
                rent_recipient_balance: 0,
                vault_rent_balance: 7,
                contest_rent_balance: 11,
                stake_amount,
                platform_fee_bps,
                state: ContestState::Created,
                closed: false,
            }
        }

        fn create_contest(&mut self) -> Result<()> {
            validate_stake(self.stake_amount, self.stake_amount)?;
            self.creator_balance = self
                .creator_balance
                .checked_sub(self.stake_amount)
                .ok_or(EscrowError::MathOverflow)?;
            self.vault_balance = self
                .vault_balance
                .checked_add(self.stake_amount)
                .ok_or(EscrowError::MathOverflow)?;
            self.state = ContestState::Created;
            Ok(())
        }

        fn join_contest(&mut self) -> Result<()> {
            require!(
                self.state == ContestState::Created,
                EscrowError::ContestNotJoinable
            );
            self.joiner_balance = self
                .joiner_balance
                .checked_sub(self.stake_amount)
                .ok_or(EscrowError::MathOverflow)?;
            self.vault_balance = self
                .vault_balance
                .checked_add(self.stake_amount)
                .ok_or(EscrowError::MathOverflow)?;
            self.state = ContestState::Active;
            Ok(())
        }

        fn cancel_contest(&mut self) -> Result<()> {
            require!(
                self.state == ContestState::Created,
                EscrowError::ContestNotCancellable
            );
            self.creator_balance = self
                .creator_balance
                .checked_add(self.stake_amount)
                .ok_or(EscrowError::MathOverflow)?;
            self.vault_balance = self
                .vault_balance
                .checked_sub(self.stake_amount)
                .ok_or(EscrowError::MathOverflow)?;
            self.state = ContestState::Cancelled;
            Ok(())
        }

        fn refund_expired_contest(&mut self) -> Result<()> {
            require!(
                self.state == ContestState::Created || self.state == ContestState::Active,
                EscrowError::ContestAlreadySettled
            );
            let joined = self.state == ContestState::Active;
            self.creator_balance = self
                .creator_balance
                .checked_add(self.stake_amount)
                .ok_or(EscrowError::MathOverflow)?;
            self.vault_balance = self
                .vault_balance
                .checked_sub(self.stake_amount)
                .ok_or(EscrowError::MathOverflow)?;

            if joined {
                self.joiner_balance = self
                    .joiner_balance
                    .checked_add(self.stake_amount)
                    .ok_or(EscrowError::MathOverflow)?;
                self.vault_balance = self
                    .vault_balance
                    .checked_sub(self.stake_amount)
                    .ok_or(EscrowError::MathOverflow)?;
            }

            self.state = ContestState::Expired;
            Ok(())
        }

        fn settle_contest(&mut self, winner: Option<Pubkey>) -> Result<()> {
            validate_settleable(self.state)?;
            let plan = settlement_plan(
                self.stake_amount,
                self.platform_fee_bps,
                winner,
                self.creator,
                self.joiner,
            )?;

            if plan.fee_amount > 0 {
                self.fee_balance = self
                    .fee_balance
                    .checked_add(plan.fee_amount)
                    .ok_or(EscrowError::MathOverflow)?;
                self.vault_balance = self
                    .vault_balance
                    .checked_sub(plan.fee_amount)
                    .ok_or(EscrowError::MathOverflow)?;
            }

            if let Some(winner_amount) = plan.winner_amount {
                if winner == Some(self.creator) {
                    self.creator_balance = self
                        .creator_balance
                        .checked_add(winner_amount)
                        .ok_or(EscrowError::MathOverflow)?;
                } else {
                    self.joiner_balance = self
                        .joiner_balance
                        .checked_add(winner_amount)
                        .ok_or(EscrowError::MathOverflow)?;
                }
                self.vault_balance = self
                    .vault_balance
                    .checked_sub(winner_amount)
                    .ok_or(EscrowError::MathOverflow)?;
            } else {
                self.creator_balance = self
                    .creator_balance
                    .checked_add(plan.creator_refund_amount)
                    .ok_or(EscrowError::MathOverflow)?;
                self.joiner_balance = self
                    .joiner_balance
                    .checked_add(plan.joiner_refund_amount)
                    .ok_or(EscrowError::MathOverflow)?;
                self.vault_balance = self
                    .vault_balance
                    .checked_sub(plan.creator_refund_amount)
                    .ok_or(EscrowError::MathOverflow)?;
                self.vault_balance = self
                    .vault_balance
                    .checked_sub(plan.joiner_refund_amount)
                    .ok_or(EscrowError::MathOverflow)?;
            }

            self.state = ContestState::Settled;
            Ok(())
        }

        fn reclaim_contest_rent(&mut self) -> Result<()> {
            validate_rent_reclaimable(self.state)?;
            require!(self.vault_balance == 0, EscrowError::ContestVaultNotEmpty);
            self.rent_recipient_balance = self
                .rent_recipient_balance
                .checked_add(self.vault_rent_balance)
                .ok_or(EscrowError::MathOverflow)?;
            self.rent_recipient_balance = self
                .rent_recipient_balance
                .checked_add(self.contest_rent_balance)
                .ok_or(EscrowError::MathOverflow)?;
            self.vault_rent_balance = 0;
            self.contest_rent_balance = 0;
            self.closed = true;
            Ok(())
        }
    }

    fn contest_for_game(
        game_config_key: Pubkey,
        game_config: &GameConfig,
        mint: Pubkey,
    ) -> Contest {
        Contest {
            game_config: game_config_key,
            contest_id: "daily-final-42".to_string(),
            mint,
            vault: Pubkey::new_unique(),
            stake_amount: 10,
            creator: Pubkey::new_unique(),
            joiner: Pubkey::new_unique(),
            result_authority: game_config.result_authority,
            winner: Pubkey::default(),
            rules_hash: "rules-v1".to_string(),
            result_hash: String::new(),
            expires_at: 1_800_000_000,
            created_at: 1_700_000_000,
            settled_at: 0,
            state: ContestState::Active,
            bump: 0,
            vault_bump: 0,
            vault_authority_bump: 0,
        }
    }

    fn game_config(paused: bool, mint_enabled: bool, supported_mint: Pubkey) -> GameConfig {
        GameConfig {
            global_config: Pubkey::default(),
            game_id: "word_duel".to_string(),
            admin: Pubkey::default(),
            result_authority: Pubkey::new_unique(),
            supported_mint,
            max_stake_amount: 10,
            platform_fee_bps: 0,
            paused,
            mint_enabled,
            bump: 0,
        }
    }
}
