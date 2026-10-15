-- =====================================================================
-- Painel de Acompanhamento dos Consultores - Fertilizer AVC - LT Fácil
-- Rode este script inteiro no SQL Editor do Supabase (uma vez).
-- =====================================================================

-- ---------- Perfis de usuário (1 linha por usuário do Auth) ----------
create table if not exists public.perfis (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  nome text not null,
  papel text not null default 'consultor' check (papel in ('admin','gerente','consultor','leitura')),
  frente text,
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);

-- Cria o perfil automaticamente quando um usuário é criado no Auth.
-- O nome, papel e frente vêm do "user metadata" informado no cadastro.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.perfis (id, email, nome, papel, frente)
  values (new.id, new.email,
          coalesce(new.raw_user_meta_data->>'nome', split_part(new.email,'@',1)),
          coalesce(new.raw_user_meta_data->>'papel', 'consultor'),
          new.raw_user_meta_data->>'frente')
  on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute procedure public.handle_new_user();

create or replace function public.meu_papel() returns text language sql stable security definer set search_path = public as $$
  select papel from public.perfis where id = auth.uid() and ativo
$$;

-- ---------- Parâmetros ----------
create table if not exists public.parametros (
  chave text primary key,
  valor text
);

-- ---------- Equipe por frente ----------
create table if not exists public.equipe (
  id serial primary key,
  ordem int not null default 0,
  frente text not null,
  key_user text,
  area_key_user text,
  consultor text,
  apoio text,
  contato text,
  obs text
);

-- ---------- Papéis do projeto ----------
create table if not exists public.papeis (
  id serial primary key,
  ordem int not null default 0,
  papel text not null,
  nome text,
  responsabilidade text
);

-- ---------- Atividades (Template, Portal, Customizações) ----------
create table if not exists public.atividades (
  id serial primary key,
  origem text not null check (origem in ('template','portal','custom')),
  ordem int not null default 0,
  bloco text not null,
  codigo text not null,
  atividade text not null,
  lado text,                       -- LT Fácil | TOTVS | AVC
  consultor text,
  key_user text,
  status text not null default 'Não iniciado' check (status in ('Não iniciado','Em andamento','Concluído','Bloqueado')),
  pct numeric(5,2) not null default 0 check (pct between 0 and 100),
  inicio date,
  previsao date,
  conclusao date,
  precedentes text,                -- códigos separados por ';'
  ponto_atencao text,
  obs text,
  atualizado_em timestamptz not null default now(),
  atualizado_por text,
  unique (origem, codigo)
);

-- ---------- Roteiro de testes ----------
create table if not exists public.roteiro (
  id serial primary key,
  ordem int not null default 0,
  codigo text not null unique,
  fluxo text not null,
  cenario text,
  passo text not null,
  sistema text,
  pre_condicao text,
  dados_teste text,
  resultado_esperado text,
  executor text,
  consultor text,
  data_execucao date,
  resultado text not null default 'Não executado' check (resultado in ('Não executado','Aprovado','Aprovado com ressalva','Reprovado','Bloqueado')),
  evidencia text,
  obs text,
  atualizado_em timestamptz not null default now(),
  atualizado_por text
);

-- ---------- Pontos de atenção ----------
create table if not exists public.pontos (
  id serial primary key,
  codigo text not null unique,
  data date not null default current_date,
  frente text,
  tipo text not null check (tipo in ('Risco','Pendência','Decisão','Impedimento')),
  descricao text not null,
  impacto text,
  responsavel text,
  prazo date,
  status text not null default 'Aberto' check (status in ('Aberto','Em tratamento','Resolvido')),
  precedente text,
  dependentes text,
  no_boletim boolean not null default false,
  resolucao text,
  atualizado_em timestamptz not null default now(),
  atualizado_por text
);

-- ---------- Texto do boletim (realizado / próximos passos) ----------
create table if not exists public.boletim_texto (
  id serial primary key,
  data_referencia date not null unique,
  realizado text,
  proximos_passos text,
  atualizado_em timestamptz not null default now(),
  atualizado_por text
);

-- ---------- Log de alterações (trilha para atualizar a ferramenta de gestão) ----------
create table if not exists public.log_alteracoes (
  id bigserial primary key,
  quando timestamptz not null default now(),
  usuario text,
  tabela text not null,
  registro text not null,
  campo text,
  de text,
  para text
);

-- ---------- Carimbo automático ----------
create or replace function public.carimbo() returns trigger language plpgsql as $$
begin
  new.atualizado_em := now();
  new.atualizado_por := coalesce((select nome from public.perfis where id = auth.uid()), new.atualizado_por);
  return new;
end $$;
do $$ declare t text; begin
  foreach t in array array['atividades','roteiro','pontos','boletim_texto'] loop
    execute format('drop trigger if exists carimbo_%s on public.%s', t, t);
    execute format('create trigger carimbo_%s before update on public.%s for each row execute procedure public.carimbo()', t, t);
  end loop;
end $$;

-- ---------- Segurança (RLS) ----------
-- Regra: qualquer usuário autenticado e ativo lê tudo; consultor, gerente e admin editam;
-- 'leitura' só consulta. Perfis só são alterados por admin.
alter table public.perfis          enable row level security;
alter table public.parametros      enable row level security;
alter table public.equipe          enable row level security;
alter table public.papeis          enable row level security;
alter table public.atividades      enable row level security;
alter table public.roteiro         enable row level security;
alter table public.pontos          enable row level security;
alter table public.boletim_texto   enable row level security;
alter table public.log_alteracoes  enable row level security;

do $$ declare t text; begin
  foreach t in array array['parametros','equipe','papeis','atividades','roteiro','pontos','boletim_texto','log_alteracoes'] loop
    execute format('drop policy if exists ler_%s on public.%s', t, t);
    execute format('create policy ler_%s on public.%s for select to authenticated using (public.meu_papel() is not null)', t, t);
    execute format('drop policy if exists editar_%s on public.%s', t, t);
    execute format('create policy editar_%s on public.%s for all to authenticated using (public.meu_papel() in (''admin'',''gerente'',''consultor'')) with check (public.meu_papel() in (''admin'',''gerente'',''consultor''))', t, t);
  end loop;
end $$;

drop policy if exists perfis_ler on public.perfis;
create policy perfis_ler on public.perfis for select to authenticated using (true);
drop policy if exists perfis_admin on public.perfis;
create policy perfis_admin on public.perfis for all to authenticated
  using (public.meu_papel() = 'admin') with check (public.meu_papel() = 'admin');
drop policy if exists perfis_proprio on public.perfis;
create policy perfis_proprio on public.perfis for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid() and papel = (select papel from public.perfis p where p.id = auth.uid()));

-- ---------- Primeiro administrador ----------
-- 1) Crie o seu usuário em Authentication > Users > Add user (e-mail + senha, "Auto confirm" marcado).
-- 2) Depois rode:  update public.perfis set papel='admin', nome='Carlos Oliveira' where email='carlos@oraadvisory.com.br';
