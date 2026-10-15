# Acompanhamento Fertilizer AVC — painel dos consultores (LT Fácil)

Página web, na identidade visual da LT, em que os consultores atualizam o andamento do projeto
(Template, Portal, Customizações, roteiro de testes, pontos de atenção) e o gerente emite o boletim ao cliente.
Os dados ficam no Supabase (plano gratuito); a página é publicada no GitHub Pages.

Não contém e não deve receber condições comerciais (horas, valores, propostas).

## Como funciona a integração com as planilhas

```
Excel "Acompanhamento Consultores" ──(scripts/gerar_seed.py)──► supabase/seed.sql ──► banco
banco ──(botão "Exportar Excel" no painel)──► Excel com as mesmas abas ──► Carlos atualiza a
                                                                            "Gestao de Projeto - Fertilizer AVC"
```

- **Carga inicial / recarga**: `python3 scripts/gerar_seed.py "Acompanhamento Consultores - Fertilizer AVC - LT Facil.xlsx" > supabase/seed.sql`
  e rode o `seed.sql` no SQL Editor do Supabase. Ele substitui os dados pelos da planilha.
- **Volta para a gestão**: no painel, "Exportar Excel" gera `Acompanhamento Consultores - Fertilizer AVC - export DDMMAAAA.xlsx`
  com as abas Parâmetros, Equipe, Cronograma Template, Cronograma Portal, Customizações, Roteiro de Testes,
  Pontos de Atenção e Boletim Texto, mais as colunas "Atualizado por / em". A aba Ajuda mostra o log das últimas alterações.

## Publicar em 6 passos (cerca de 20 minutos)

### 1. Criar o projeto no Supabase
1. Entre em https://supabase.com e crie uma conta (pode ser com o GitHub).
2. **New project** → nome `lt-fertilizer-avc`, região *South America (São Paulo)*, defina uma senha do banco e guarde.
3. Espere o projeto ficar "Active" (1 a 2 minutos).

### 2. Criar as tabelas e as regras de acesso
1. Menu lateral **SQL Editor** → **New query**.
2. Cole o conteúdo de `supabase/schema.sql` inteiro → **Run**. Deve terminar sem erro.
3. Nova query: cole `supabase/seed.sql` → **Run**. Isso carrega as atividades, o roteiro e os pontos de atenção.

### 3. Criar o seu usuário administrador
1. Menu **Authentication → Users → Add user → Create new user**.
2. E-mail `carlos@oraadvisory.com.br`, uma senha sua, marque **Auto Confirm User** → Create.
3. Volte ao **SQL Editor** e rode:
   ```sql
   update public.perfis set papel = 'admin', nome = 'Carlos Oliveira' where email = 'carlos@oraadvisory.com.br';
   ```
4. Em **Authentication → Providers → Email**, desmarque **Confirm email** (assim os usuários criados pelo painel entram na hora) e salve.

### 4. Pegar a URL e a chave
1. Menu **Project Settings → API**.
2. Copie **Project URL** e a chave **anon public**.
3. Abra `config.js` e cole nos dois campos. (A chave anon pode ficar pública: quem manda nos dados são as regras do banco.)

### 5. Publicar no GitHub Pages
1. Crie um repositório no GitHub (ex.: `lt-fertilizer-avc`), **privado ou público** — o GitHub Pages de repositório privado exige plano pago; no gratuito use público (o conteúdo da página não expõe dados: eles só aparecem após login).
2. Envie todos os arquivos desta pasta (index.html, app.js, styles.css, config.js, README.md, pastas `supabase` e `scripts`).
   Pelo site do GitHub: **Add file → Upload files** → arraste a pasta → Commit.
3. **Settings → Pages → Build and deployment**: Source *Deploy from a branch*, Branch `main`, pasta `/ (root)` → Save.
4. Em 1 a 2 minutos a página fica em `https://SEU-USUARIO.github.io/lt-fertilizer-avc/`.

### 6. Criar os acessos dos consultores
1. Entre na página com o seu usuário.
2. Menu **Usuários** → nome, e-mail, papel (Consultor / Gerente / Somente leitura) → **Gerar senha e criar**.
3. Copie e-mail e senha e envie ao consultor por um canal seguro. Ele troca a senha em **Ajuda**.

Papéis: **admin** cria usuários e edita tudo; **gerente** e **consultor** editam; **leitura** só consulta.
Para bloquear alguém: Usuários → Desativar. Para redefinir senha: Supabase → Authentication → Users → *Reset password*.

## Rotina sugerida
- Consultores atualizam até quinta 12h (status, %, datas, pontos de atenção).
- Gerente ajusta a data de referência, escreve "Realizado" e "Próximos passos" e gera o PDF (Imprimir / PDF) para o cliente.
- Diretor exporta o Excel e atualiza a ferramenta de gestão da LT.

## Estrutura
```
index.html            página
app.js                lógica (telas, edição, boletim, usuários, exportação)
styles.css            identidade visual LT (azul-marinho, verde-menta, Arial)
config.js             URL e chave do Supabase (preencher)
supabase/schema.sql   tabelas, gatilhos e regras de segurança (RLS)
supabase/seed.sql     dados iniciais gerados da planilha dos consultores
scripts/gerar_seed.py gera o seed.sql a partir da planilha
```

## Testar sem publicar
Abra `index.html` direto no navegador depois de preencher `config.js`: a página funciona local (os dados vêm do Supabase).
