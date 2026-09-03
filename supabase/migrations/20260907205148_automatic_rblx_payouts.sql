-- Existing rows remain ETH claims on the original contract. New rows explicitly
-- bind escrow, recipient consent, and payout recovery independently of UI flags.
alter table public.pvp_games
  add column if not exists robinhood_escrow_address text,
  add column if not exists payout_mode text not null default 'eth_claim',
  add column if not exists white_minimum_rblx text,
  add column if not exists black_minimum_rblx text,
  add column if not exists auto_payout_status text not null default 'none',
  add column if not exists auto_payout_signature text,
  add column if not exists auto_payout_amount text,
  add column if not exists auto_payout_submitted_signature text,
  add column if not exists auto_payout_error text,
  add column if not exists auto_payout_retry_at timestamptz,
  add column if not exists auto_payout_lease_until timestamptz;

alter table public.pvp_games
  add constraint pvp_payout_mode_valid check (payout_mode in ('eth_claim', 'automatic_rblx')),
  add constraint pvp_auto_payout_status_valid check (auto_payout_status in ('none', 'pending', 'retrying', 'paid_rblx', 'paid_eth')),
  add constraint pvp_auto_payout_terms_valid check (payout_mode <> 'automatic_rblx' or (
    payment_mode = 'robinhood_eth_escrow' and wager_asset_kind = 'native_eth'
    and robinhood_escrow_address is not null and robinhood_escrow_address ~ '^0x[0-9a-fA-F]{40}$'
    and white_minimum_rblx is not null and white_minimum_rblx ~ '^[1-9][0-9]*$'
    and (black_wallet_address is null or (black_minimum_rblx is not null and black_minimum_rblx ~ '^[1-9][0-9]*$'))
  ));

create index if not exists pvp_auto_payout_queue_idx on public.pvp_games (auto_payout_retry_at, finished_at)
  where payout_mode = 'automatic_rblx' and auto_payout_status in ('pending', 'retrying');

-- RLS stays enabled. Only service_role may claim work; browser roles cannot
-- acquire a lease or mutate payout records. SECURITY INVOKER retains RLS.
create or replace function public.claim_automatic_rblx_payouts(batch_size integer default 10)
returns setof public.pvp_games
language sql security invoker set search_path = ''
as $$
  update public.pvp_games as game
  set auto_payout_lease_until = now() + interval '5 minutes'
  where game.id in (
    select candidate.id from public.pvp_games as candidate
    where candidate.payout_mode = 'automatic_rblx'
      and candidate.status = 'finished' and candidate.settlement_status = 'settled'
      and candidate.winner in ('w', 'b')
      and candidate.auto_payout_status in ('pending', 'retrying')
      and (candidate.auto_payout_retry_at is null or candidate.auto_payout_retry_at <= now())
      and (candidate.auto_payout_lease_until is null or candidate.auto_payout_lease_until < now())
    order by candidate.finished_at asc
    limit greatest(1, least(batch_size, 10)) for update skip locked
  ) returning game.*;
$$;
revoke all on function public.claim_automatic_rblx_payouts(integer) from public, anon, authenticated;
grant execute on function public.claim_automatic_rblx_payouts(integer) to service_role;
