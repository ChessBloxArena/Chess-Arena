-- Only the referee may read or record acceptance after authenticating the wallet.
create table public.pvp_play_consents (
  wallet_address text not null check (wallet_address ~ '^0x[0-9a-f]{40}$'),
  terms_version text not null,
  accepted_at timestamptz not null default now(),
  session_id uuid not null,
  stock_token_eligibility_attested boolean not null check (stock_token_eligibility_attested),
  primary key (wallet_address, terms_version)
);
alter table public.pvp_play_consents enable row level security;
-- Clear Supabase's default service-role grants before adding append-only access.
revoke all on table public.pvp_play_consents from public, anon, authenticated, service_role;
grant select, insert on table public.pvp_play_consents to service_role;
comment on table public.pvp_play_consents is 'Versioned, wallet-authenticated clickwrap acceptance. Eligibility attestation is not independent eligibility verification.';
