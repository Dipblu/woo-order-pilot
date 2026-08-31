create table if not exists escalations (
  session_id text not null,
  reason text,
  question text,
  suppressed boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists escalations_session_created_idx
  on escalations (session_id, created_at desc);

alter table escalations enable row level security;
