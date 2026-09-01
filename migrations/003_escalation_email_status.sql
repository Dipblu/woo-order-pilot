alter table escalations
  add column if not exists email_status text not null default 'sent';
