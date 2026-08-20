create table if not exists public.pvp_wallet_proof_nonces (
  nonce_hash text primary key,
  wallet_address text not null,
  action text not null,
  session_id text not null,
  game_id uuid,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.pvp_wallet_proof_nonces enable row level security;

revoke all on table public.pvp_wallet_proof_nonces from public, anon, authenticated;
grant all on table public.pvp_wallet_proof_nonces to service_role;

create index if not exists pvp_wallet_proof_nonces_lookup_idx
  on public.pvp_wallet_proof_nonces (wallet_address, action, session_id, game_id, expires_at)
  where used_at is null;
