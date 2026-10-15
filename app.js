/* Acompanhamento Fertilizer AVC — LT Fácil
   Página única: Supabase (auth + dados) e SheetJS (exportação para Excel). */
(function () {
  const CFG = window.LT_CONFIG || {};
  const configured = CFG.SUPABASE_URL && !CFG.SUPABASE_URL.includes("SEU-PROJETO") && CFG.SUPABASE_ANON_KEY && !CFG.SUPABASE_ANON_KEY.startsWith("COLE");
  const sb = configured ? supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY) : null;

  const STATUS = ["Não iniciado", "Em andamento", "Concluído", "Bloqueado"];
  const RESULT = ["Não executado", "Aprovado", "Aprovado com ressalva", "Reprovado", "Bloqueado"];
  const TIPOS = ["Risco", "Pendência", "Decisão", "Impedimento"];
  const PSTATUS = ["Aberto", "Em tratamento", "Resolvido"];
  const LADOS = ["LT Fácil", "TOTVS", "AVC"];
  const VIEWS = [
    ["boletim", "Boletim"], ["template", "Template"], ["portal", "Portal"], ["custom", "Customizações"],
    ["roteiro", "Roteiro de testes"], ["pontos", "Pontos de atenção"], ["equipe", "Equipe"], ["usuarios", "Usuários"], ["ajuda", "Ajuda"]
  ];

  const S = { user: null, perfil: null, view: "boletim", data: {}, dirty: {}, filtro: "" };
  const $ = (id) => document.getElementById(id);
  const esc = (v) => (v == null ? "" : String(v)).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmtD = (d) => { if (!d) return ""; const [y, m, dd] = String(d).slice(0, 10).split("-"); return `${dd}/${m}/${y}`; };
  const today = () => new Date().toISOString().slice(0, 10);
  const canEdit = () => ["admin", "gerente", "consultor"].includes(S.perfil?.papel);
  const isAdmin = () => S.perfil?.papel === "admin";

  // ---------- dias úteis ----------
  function feriados() { return (param("feriados") || "").split(";").filter(Boolean); }
  function diasUteis(a, b) { // inclusive, como NETWORKDAYS; negativo se b < a
    if (!a || !b) return null;
    let d1 = new Date(a + "T00:00:00"), d2 = new Date(b + "T00:00:00"), sign = 1;
    if (d2 < d1) { [d1, d2] = [d2, d1]; sign = -1; }
    const fer = new Set(feriados()); let n = 0;
    for (let d = new Date(d1); d <= d2; d.setDate(d.getDate() + 1)) {
      const wd = d.getDay(); if (wd === 0 || wd === 6) continue;
      if (fer.has(d.toISOString().slice(0, 10))) continue; n++;
    }
    return sign * n;
  }
  function param(k) { const p = (S.data.parametros || []).find((x) => x.chave === k); return p ? p.valor : null; }
  function ref() { return param("data_referencia") || today(); }

  function situacao(a) {
    if (a.status === "Concluído") return ["Concluída", "ok"];
    if (a.status === "Bloqueado") return ["Bloqueada", "bad"];
    if (!a.previsao) return ["Sem data", "warn"];
    if (a.previsao < ref()) return ["Atrasada", "bad"];
    const du = diasUteis(ref(), a.previsao);
    if (du <= 2) return ["Vence em até 2 dias", "warn"];
    return ["No prazo", "info"];
  }
  function dependentes(list, codigo) {
    return list.filter((x) => (x.precedentes || "").split(";").map((s) => s.trim()).includes(codigo)).map((x) => x.codigo).join("; ");
  }

  // ---------- carga ----------
  async function loadAll() {
    const tabs = ["parametros", "equipe", "papeis", "atividades", "roteiro", "pontos", "boletim_texto", "perfis"];
    const res = await Promise.all(tabs.map((t) => sb.from(t).select("*").order(t === "parametros" ? "chave" : t === "perfis" ? "nome" : t === "pontos" ? "codigo" : "ordem")));
    res.forEach((r, i) => { if (r.error) toast("Erro ao ler " + tabs[i] + ": " + r.error.message, true); S.data[tabs[i]] = r.data || []; });
    S.data.atividades.sort((a, b) => a.origem.localeCompare(b.origem) || a.ordem - b.ordem);
  }

  // ---------- auth ----------
  async function login(ev) {
    ev.preventDefault();
    if (!configured) { $("l-setup").classList.remove("hidden"); return false; }
    $("l-err").textContent = "";
    const { error } = await sb.auth.signInWithPassword({ email: $("l-email").value.trim(), password: $("l-pass").value });
    if (error) { $("l-err").textContent = "Não foi possível entrar: " + (error.message === "Invalid login credentials" ? "e-mail ou senha incorretos." : error.message); return false; }
    await boot(); return false;
  }
  async function logout() { await sb.auth.signOut(); location.reload(); }
  async function boot() {
    if (!configured) { $("l-setup").classList.remove("hidden"); return; }
    const { data: { session } } = await sb.auth.getSession();
    if (!session) return;
    S.user = session.user;
    const { data: perfil } = await sb.from("perfis").select("*").eq("id", S.user.id).single();
    S.perfil = perfil || { nome: S.user.email, papel: "leitura" };
    if (perfil && perfil.ativo === false) { toast("Usuário desativado. Fale com o gerente do projeto.", true); await sb.auth.signOut(); return; }
    $("login").classList.add("hidden"); $("app").classList.remove("hidden");
    $("u-nome").textContent = S.perfil.nome; $("u-papel").textContent = ({ admin: "Administrador", gerente: "Gerente de projeto", consultor: "Consultor", leitura: "Somente leitura" })[S.perfil.papel] || S.perfil.papel;
    await loadAll();
    renderNav(); show(location.hash.replace("#", "") || "boletim");
  }

  // ---------- navegação ----------
  const ICONS = {
    boletim: '<path d="M4 4h16v16H4z"/><path d="M8 9h8M8 13h8M8 17h5"/>', template: '<path d="M3 5h18M3 12h18M3 19h18"/><path d="M7 5v14"/>',
    portal: '<path d="M3 7h13v10H3z"/><path d="M16 10h3l2 3v4h-5"/><circle cx="7" cy="18" r="1.5"/><circle cx="18" cy="18" r="1.5"/>',
    custom: '<path d="M12 3l2.5 5 5.5.8-4 3.9.9 5.5L12 15.6 7.1 18.2l.9-5.5-4-3.9 5.5-.8z"/>', roteiro: '<path d="M5 4h14v16H5z"/><path d="M9 9l2 2 4-4M9 15l2 2 4-4"/>',
    pontos: '<path d="M12 3l10 18H2z"/><path d="M12 10v4M12 17h.01"/>', equipe: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0113 0"/><circle cx="17" cy="9" r="2.5"/><path d="M15 20h6.5a5 5 0 00-5-5"/>',
    usuarios: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0116 0"/><path d="M19 3l2 2-2 2"/>', ajuda: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 015 0c0 1.5-2.5 2-2.5 3.5M12 17h.01"/>'
  };
  function renderNav() {
    $("nav").innerHTML = VIEWS.filter(([k]) => k !== "usuarios" || isAdmin()).map(([k, l]) => `<button data-v="${k}" onclick="app.show('${k}')"><svg viewBox="0 0 24 24">${ICONS[k] || ""}</svg><span>${l}</span></button>`).join("");
    try { if (localStorage.getItem("lt-menu") === "collapsed") document.body.classList.add("collapsed"); } catch (e) {}
  }
  function menu(open) { document.body.classList.toggle("menu-open", open === undefined ? !document.body.classList.contains("menu-open") : open); }
  function collapse() { document.body.classList.toggle("collapsed"); try { localStorage.setItem("lt-menu", document.body.classList.contains("collapsed") ? "collapsed" : "open"); } catch (e) {} }
  function show(v) {
    if (Object.keys(S.dirty).length && !confirm("Há alterações não salvas. Descartar?")) return;
    S.dirty = {}; updateSavebar();
    S.view = v; location.hash = v;
    document.querySelectorAll("#nav button").forEach((b) => b.classList.toggle("active", b.dataset.v === v));
    const vt = $("view-title"); if (vt) vt.textContent = (VIEWS.find(([k]) => k === v) || [])[1] || "";
    menu(false);
    const r = { boletim: vBoletim, template: () => vAtividades("template"), portal: () => vAtividades("portal"), custom: () => vAtividades("custom"), roteiro: vRoteiro, pontos: vPontos, equipe: vEquipe, usuarios: vUsuarios, ajuda: vAjuda }[v] || vBoletim;
    $("main").innerHTML = r();
    labelCells();
    window.scrollTo(0, 0);
  }

  // ---------- edição genérica ----------
  // data-t = tabela, data-id = id, data-f = campo
  function inp(t, row, f, type, opts) {
    if (!canEdit()) {
      const v = row[f];
      if (type === "date") return fmtD(v);
      if (type === "pct") return (v ?? 0) + "%";
      if (type === "bool") return v ? "Sim" : "Não";
      return esc(v);
    }
    const key = `${t}:${row.id}:${f}`; const v = row[f] ?? "";
    const common = `data-k="${key}" oninput="app.mark(this)" onchange="app.mark(this)"`;
    if (type === "select") return `<select ${common}>${opts.map((o) => `<option ${o === v ? "selected" : ""}>${esc(o)}</option>`).join("")}</select>`;
    if (type === "date") return `<input type="date" value="${esc(v)}" ${common}>`;
    if (type === "pct") return `<input type="number" min="0" max="100" step="5" value="${esc(v)}" ${common}>`;
    if (type === "bool") return `<select ${common}><option value="false" ${!v ? "selected" : ""}>Não</option><option value="true" ${v ? "selected" : ""}>Sim</option></select>`;
    if (type === "area") return `<textarea ${common}>${esc(v)}</textarea>`;
    return `<input type="text" value="${esc(v)}" ${common}>`;
  }
  function mark(el) {
    const [t, id, f] = el.dataset.k.split(":");
    let v = el.value; if (el.type === "number") v = v === "" ? 0 : Number(v); if (el.tagName === "SELECT" && (v === "true" || v === "false")) v = v === "true";
    if (el.type === "date" && v === "") v = null;
    S.dirty[el.dataset.k] = { t, id: Number(id), f, v };
    el.closest("td")?.classList.add("dirty"); updateSavebar();
  }
  function updateSavebar() {
    const n = Object.keys(S.dirty).length;
    $("savebar").classList.toggle("hidden", n === 0);
    $("dirty-count").textContent = n === 1 ? "1 alteração pendente" : `${n} alterações pendentes`;
  }
  async function saveAll() {
    const byRow = {};
    for (const d of Object.values(S.dirty)) { const k = d.t + ":" + d.id; (byRow[k] ||= { t: d.t, id: d.id, patch: {} }).patch[d.f] = d.v; }
    const logs = [];
    for (const r of Object.values(byRow)) {
      const row = (S.data[r.t] || []).find((x) => x.id === r.id);
      for (const [f, v] of Object.entries(r.patch)) {
        if (row && String(row[f] ?? "") !== String(v ?? "")) logs.push({ usuario: S.perfil.nome, tabela: r.t, registro: row.codigo || row.frente || String(r.id), campo: f, de: String(row[f] ?? ""), para: String(v ?? "") });
      }
      const { error } = await sb.from(r.t).update(r.patch).eq("id", r.id);
      if (error) { toast("Erro ao salvar: " + error.message, true); return; }
      if (row) Object.assign(row, r.patch);
    }
    if (logs.length) await sb.from("log_alteracoes").insert(logs);
    S.dirty = {}; updateSavebar(); toast(`${logs.length} campo(s) salvos.`); show(S.view);
  }
  function discard() { S.dirty = {}; updateSavebar(); show(S.view); }

  // ---------- Boletim ----------
  function resumoFrente(list) {
    const n = list.length, c = list.filter((a) => a.status === "Concluído").length, e = list.filter((a) => a.status === "Em andamento").length;
    const atr = list.filter((a) => situacao(a)[0] === "Atrasada").length, sd = list.filter((a) => situacao(a)[0] === "Sem data").length;
    const pct = n ? list.reduce((s, a) => s + Number(a.pct || 0), 0) / n : 0;
    return { n, c, e, atr, sd, pct };
  }
  function vBoletim() {
    const at = S.data.atividades, tpl = at.filter((a) => a.origem === "template");
    const blocos = [...new Set(tpl.map((a) => a.bloco))];
    const frentes = [...blocos.map((b) => ["Template — " + b, tpl.filter((a) => a.bloco === b)]), ["Portal de Cargas", at.filter((a) => a.origem === "portal")], ["Customizações", at.filter((a) => a.origem === "custom")]];
    const tot = resumoFrente(at);
    const du = Math.max(0, (diasUteis(ref(), param("inicio_testes")) || 1) - 1);
    const rot = S.data.roteiro, exec = rot.filter((r) => r.resultado !== "Não executado").length, apr = rot.filter((r) => r.resultado.startsWith("Aprovado")).length, rep = rot.filter((r) => ["Reprovado", "Bloqueado"].includes(r.resultado)).length;
    const pontos = S.data.pontos.filter((p) => p.no_boletim && p.status !== "Resolvido");
    const bt = S.data.boletim_texto.find((b) => b.data_referencia === ref()) || { id: null, realizado: "", proximos_passos: "" };
    const maxPrev = (f) => { const v = at.filter(f).map((a) => a.previsao).filter(Boolean).sort().pop(); return v || null; };
    const marcos = [
      ["Entrega do pacote Entradas (bloco 2, lado LT)", maxPrev((a) => a.origem === "template" && a.bloco.startsWith("2") && a.lado === "LT Fácil")],
      ["Entrega do pacote Saídas (bloco 3, lado LT)", maxPrev((a) => a.origem === "template" && a.bloco.startsWith("3") && a.lado === "LT Fácil")],
      ["Treinamentos concluídos", maxPrev((a) => a.origem === "template" && a.bloco.startsWith("4"))],
      ["Portal configurado (fases 0 a 5)", maxPrev((a) => a.origem === "portal" && /^[0-5]/.test(a.bloco))],
      ["Portal homologado (fase 6)", maxPrev((a) => a.origem === "portal" && a.bloco.startsWith("6"))],
      ["Início dos testes integrados", param("inicio_testes")],
    ];
    const sitM = (d) => { if (!d) return ["Sem data", "warn"]; if (d < ref()) return ["Vencido", "bad"]; const n = diasUteis(ref(), d); return n <= 3 ? ["Esta semana", "warn"] : ["Previsto", "info"]; };
    return `
      <div class="boletim-head">
        <div><h2>Boletim de acompanhamento</h2>
          <div class="meta">${esc(CFG.CLIENTE || param("cliente"))} · ${esc(CFG.PROJETO || param("projeto"))}<br>
          Data de referência <b>${fmtD(ref())}</b> · início dos testes integrados <b>${fmtD(param("inicio_testes"))}</b> · <b>${du}</b> dias úteis até os testes<br>
          Emitido por ${esc(param("gerente"))} (gerente de projeto) · aprovação ${esc(param("diretor"))} (diretor de projetos)</div></div>
        <div class="no-print" style="display:flex;gap:8px;align-items:center">
          ${canEdit() ? `<label class="help">Data de referência <input type="date" value="${esc(ref())}" onchange="app.setRef(this.value)" style="padding:6px;border:1px solid var(--line);border-radius:6px"></label>` : ""}
          <button class="btn ghost dark small" onclick="window.print()">Imprimir / PDF</button>
          <button class="btn small" onclick="app.exportar()">Exportar Excel</button>
        </div>
      </div>
      <div class="cards">
        <div class="card"><div class="lbl">Avanço geral</div><div class="val">${tot.pct.toFixed(0)}%</div><div class="note">média das ${tot.n} atividades</div></div>
        <div class="card"><div class="lbl">Concluídas</div><div class="val green">${tot.c}</div><div class="note">${tot.e} em andamento</div></div>
        <div class="card"><div class="lbl">Atrasadas</div><div class="val ${tot.atr ? "red" : ""}">${tot.atr}</div><div class="note">${tot.sd} sem data</div></div>
        <div class="card"><div class="lbl">Testes executados</div><div class="val">${rot.length ? Math.round((exec / rot.length) * 100) : 0}%</div><div class="note">${apr} aprovados · <span style="color:${rep ? "var(--red)" : "inherit"}">${rep} reprovados/bloqueados</span></div></div>
        <div class="card"><div class="lbl">Pontos de atenção</div><div class="val ${pontos.length ? "red" : ""}">${pontos.length}</div><div class="note">publicados para o cliente</div></div>
      </div>
      <div class="section"><h3>1. Avanço por frente</h3><div class="tbl-wrap"><table>
        <tr><th>Frente</th><th>Atividades</th><th>Concluídas</th><th>Em andamento</th><th>Atrasadas</th><th>Sem data</th><th>% concluído</th><th>Consultor / key user</th></tr>
        ${frentes.map(([n, l]) => { const r = resumoFrente(l); const eq = equipeDe(n); return `<tr><td>${esc(n)}</td><td class="c">${r.n}</td><td class="c">${r.c}</td><td class="c">${r.e}</td><td class="c">${r.atr ? `<span class="pill bad">${r.atr}</span>` : "-"}</td><td class="c">${r.sd || "-"}</td><td><div style="display:flex;gap:8px;align-items:center"><div class="bar"><i style="width:${r.pct}%"></i></div><b>${r.pct.toFixed(0)}%</b></div></td><td class="muted">${esc(eq)}</td></tr>`; }).join("")}
        <tr class="group"><td>Total</td><td class="c">${tot.n}</td><td class="c">${tot.c}</td><td class="c">${tot.e}</td><td class="c">${tot.atr || "-"}</td><td class="c">${tot.sd || "-"}</td><td>${tot.pct.toFixed(0)}%</td><td></td></tr>
      </table></div></div>
      <div class="grid2">
        <div class="section"><h3>2. Marcos</h3><div class="tbl-wrap"><table><tr><th>Marco</th><th>Previsão</th><th>Dias úteis</th><th>Situação</th></tr>
          ${marcos.map(([n, d]) => { const [s, c] = sitM(d); return `<tr><td>${esc(n)}</td><td class="c">${fmtD(d) || "—"}</td><td class="c">${d ? diasUteis(ref(), d) : ""}</td><td class="c"><span class="pill ${c}">${s}</span></td></tr>`; }).join("")}
        </table></div></div>
        <div class="section"><h3>3. Testes integrados <span class="tag">roteiro preliminar</span></h3><div class="tbl-wrap"><table>
          <tr><td>Passos do roteiro</td><td class="c"><b>${rot.length}</b></td></tr><tr><td>Executados</td><td class="c"><b>${exec}</b></td></tr>
          <tr><td>Aprovados (inclui ressalva)</td><td class="c"><b>${apr}</b></td></tr><tr><td>Reprovados ou bloqueados</td><td class="c"><b style="color:${rep ? "var(--red)" : "inherit"}">${rep}</b></td></tr></table></div></div>
      </div>
      <div class="section"><h3>4. Pontos de atenção para o cliente <span class="tag">${pontos.length} itens</span></h3>
        ${pontos.length ? pontos.map((p) => `<div class="ponto-item"><span class="pill ${p.tipo === "Impedimento" ? "bad" : p.tipo === "Risco" ? "warn" : "info"}">${esc(p.tipo)}</span> <b>${esc(p.descricao)}</b><div class="meta">${esc(p.frente)} · responsável ${esc(p.responsavel)} · prazo ${fmtD(p.prazo) || "a definir"} ${p.prazo && p.prazo < ref() ? '<span class="pill bad">vencido</span>' : ""} · ${esc(p.status)}${p.impacto ? " · <i>" + esc(p.impacto) + "</i>" : ""}</div></div>`).join("") : '<div class="help">Nenhum ponto marcado para o boletim.</div>'}
      </div>
      <div class="grid2">
        <div class="section"><h3>5. Realizado no período</h3>${canEdit() ? `<textarea class="texto" id="bt-realizado">${esc(bt.realizado)}</textarea>` : `<div class="texto ro">${esc(bt.realizado) || "—"}</div>`}</div>
        <div class="section"><h3>6. Próximos passos</h3>${canEdit() ? `<textarea class="texto" id="bt-proximos">${esc(bt.proximos_passos)}</textarea>` : `<div class="texto ro">${esc(bt.proximos_passos) || "—"}</div>`}</div>
      </div>
      ${canEdit() ? `<div class="no-print" style="text-align:right"><button class="btn" onclick="app.salvarTexto()">Salvar textos do boletim</button></div>` : ""}`;
  }
  function equipeDe(frente) {
    const map = { "1": "Template — Entradas", "2": "Template — Entradas", "3": "Template — Saídas", "4": "Testes integrados" };
    let key = frente.startsWith("Template") ? map[frente.replace("Template — ", "")[0]] : frente;
    const e = S.data.equipe.find((x) => x.frente === key); return e ? `${e.consultor || "—"} / ${e.key_user || "—"}` : "";
  }
  async function setRef(v) {
    const { error } = await sb.from("parametros").upsert({ chave: "data_referencia", valor: v });
    if (error) return toast(error.message, true);
    (S.data.parametros.find((p) => p.chave === "data_referencia") || S.data.parametros.push({ chave: "data_referencia" }) && S.data.parametros.at(-1)).valor = v; show("boletim");
  }
  async function salvarTexto() {
    const rec = { data_referencia: ref(), realizado: $("bt-realizado").value, proximos_passos: $("bt-proximos").value, atualizado_por: S.perfil.nome };
    const { error } = await sb.from("boletim_texto").upsert(rec, { onConflict: "data_referencia" });
    if (error) return toast(error.message, true);
    const i = S.data.boletim_texto.findIndex((b) => b.data_referencia === ref()); i >= 0 ? Object.assign(S.data.boletim_texto[i], rec) : S.data.boletim_texto.push(rec);
    toast("Textos do boletim salvos.");
  }

  // ---------- Atividades ----------
  function vAtividades(origem) {
    const titulo = { template: ["Cronograma do Template Fertilizantes", "Atividades por bloco. Precedentes = o que precisa estar concluído antes; Dependentes = o que espera esta atividade."], portal: ["Cronograma do Portal de Cargas", "Fases do portal. Fases 8 e 9 ainda sem data."], custom: ["Customizações", "Etapas de entrega das três customizações. Preencha quando o escopo for definido com a AVC."] }[origem];
    const list = S.data.atividades.filter((a) => a.origem === origem);
    const f = S.filtro.toLowerCase();
    const vis = list.filter((a) => !f || [a.bloco, a.codigo, a.atividade, a.consultor, a.key_user, a.status, a.ponto_atencao, a.obs].join(" ").toLowerCase().includes(f));
    const r = resumoFrente(list);
    let html = `<h2>${titulo[0]}</h2><p class="sub">${titulo[1]}</p>
      <div class="cards"><div class="card"><div class="lbl">Atividades</div><div class="val">${r.n}</div></div><div class="card"><div class="lbl">% concluído</div><div class="val">${r.pct.toFixed(0)}%</div></div><div class="card"><div class="lbl">Concluídas</div><div class="val green">${r.c}</div></div><div class="card"><div class="lbl">Atrasadas</div><div class="val ${r.atr ? "red" : ""}">${r.atr}</div></div><div class="card"><div class="lbl">Sem data</div><div class="val">${r.sd}</div></div></div>
      <div class="toolbar"><input type="search" placeholder="Filtrar…" value="${esc(S.filtro)}" oninput="app.filtro(this.value)"><div class="right"><button class="btn ghost dark small" onclick="app.exportar()">Exportar Excel</button></div></div>
      <div class="tbl-wrap"><table><tr><th>Cód.</th><th style="min-width:240px">Atividade</th><th>Lado</th><th>Consultor</th><th>Key user</th><th>Status</th><th>%</th><th>Início</th><th>Previsão</th><th>Conclusão</th><th>Dias úteis</th><th>Situação</th><th>Precedentes</th><th>Dependentes</th><th style="min-width:200px">Ponto de atenção</th><th style="min-width:200px">Observação</th></tr>`;
    let bloco = null;
    for (const a of vis) {
      if (a.bloco !== bloco) { bloco = a.bloco; const rb = resumoFrente(list.filter((x) => x.bloco === bloco)); html += `<tr class="group"><td colspan="16">${esc(bloco)} <span class="tag" style="font-weight:normal;color:var(--muted)">· ${rb.n} atividades · ${rb.pct.toFixed(0)}% · ${rb.atr} atrasadas</span></td></tr>`; }
      const [s, c] = situacao(a); const du = a.previsao && a.status !== "Concluído" ? diasUteis(ref(), a.previsao) : "";
      html += `<tr class="edit"><td class="c codes">${esc(a.codigo)}</td><td>${esc(a.atividade)}</td><td class="c">${inp("atividades", a, "lado", "select", LADOS)}</td><td>${inp("atividades", a, "consultor", "text")}</td><td>${inp("atividades", a, "key_user", "text")}</td><td>${inp("atividades", a, "status", "select", STATUS)}</td><td class="num">${inp("atividades", a, "pct", "pct")}</td><td class="c">${inp("atividades", a, "inicio", "date")}</td><td class="c">${inp("atividades", a, "previsao", "date")}</td><td class="c">${inp("atividades", a, "conclusao", "date")}</td><td class="c" style="color:${du < 0 ? "var(--red)" : "inherit"}">${du}</td><td class="c"><span class="pill ${c}">${s}</span></td><td class="codes">${esc(a.precedentes)}</td><td class="codes">${esc(dependentes(list, a.codigo))}</td><td>${inp("atividades", a, "ponto_atencao", "area")}</td><td>${inp("atividades", a, "obs", "area")}</td></tr>`;
    }
    return html + "</table></div>";
  }
  function labelCells() {
    document.querySelectorAll("#main table").forEach((t) => {
      const ths = [...t.querySelectorAll("tr:first-child th")].map((th) => th.textContent.trim());
      if (!ths.length) return;
      if (t.querySelector("tr.edit") || t.closest(".section")?.querySelector("h3")?.textContent.includes("Avanço")) t.classList.add("cardify");
      t.querySelectorAll("tr:not(.group)").forEach((tr) => [...tr.children].forEach((td, i) => { if (td.tagName === "TD" && ths[i]) td.setAttribute("data-l", ths[i]); }));
    });
  }
  function filtro(v) { S.filtro = v; const el = $("main"); const y = window.scrollY; el.innerHTML = ({ template: () => vAtividades("template"), portal: () => vAtividades("portal"), custom: () => vAtividades("custom"), roteiro: vRoteiro, pontos: vPontos })[S.view](); labelCells(); window.scrollTo(0, y); const i = el.querySelector("input[type=search]"); i.focus(); i.setSelectionRange(v.length, v.length); }

  // ---------- Roteiro ----------
  function vRoteiro() {
    const list = S.data.roteiro, f = S.filtro.toLowerCase();
    const vis = list.filter((r) => !f || [r.codigo, r.fluxo, r.cenario, r.passo, r.executor, r.consultor, r.resultado].join(" ").toLowerCase().includes(f));
    const exec = list.filter((r) => r.resultado !== "Não executado").length;
    let html = `<h2>Roteiro de testes integrados <span class="tag" style="font-size:12px;color:var(--muted);font-weight:normal">versão preliminar</span></h2><p class="sub">O key user executa, o consultor registra resultado e evidência (link, nome do print ou número do chamado).</p>
      <div class="cards"><div class="card"><div class="lbl">Passos</div><div class="val">${list.length}</div></div><div class="card"><div class="lbl">Executados</div><div class="val">${exec}</div></div><div class="card"><div class="lbl">Aprovados</div><div class="val green">${list.filter((r) => r.resultado.startsWith("Aprovado")).length}</div></div><div class="card"><div class="lbl">Reprovados / bloqueados</div><div class="val red">${list.filter((r) => ["Reprovado", "Bloqueado"].includes(r.resultado)).length}</div></div></div>
      <div class="toolbar"><input type="search" placeholder="Filtrar…" value="${esc(S.filtro)}" oninput="app.filtro(this.value)"><div class="right"><button class="btn ghost dark small" onclick="app.exportar()">Exportar Excel</button></div></div>
      <div class="tbl-wrap"><table><tr><th>ID</th><th>Fluxo</th><th>Cenário</th><th style="min-width:260px">Passo</th><th>Sistema</th><th>Pré-condição</th><th>Dados</th><th style="min-width:200px">Resultado esperado</th><th>Executor</th><th>Consultor</th><th>Data</th><th>Resultado</th><th>Evidência</th><th>Observação</th></tr>`;
    let fl = null;
    for (const r of vis) {
      if (r.fluxo !== fl) { fl = r.fluxo; html += `<tr class="group"><td colspan="14">${esc(fl)}</td></tr>`; }
      const c = r.resultado === "Aprovado" ? "ok" : r.resultado === "Aprovado com ressalva" ? "warn" : r.resultado === "Não executado" ? "off" : "bad";
      html += `<tr class="edit"><td class="c codes">${esc(r.codigo)}</td><td>${esc(r.fluxo)}</td><td>${esc(r.cenario)}</td><td>${esc(r.passo)}</td><td class="c">${esc(r.sistema)}</td><td class="muted">${esc(r.pre_condicao)}</td><td class="muted">${esc(r.dados_teste)}</td><td>${esc(r.resultado_esperado)}</td><td>${inp("roteiro", r, "executor", "text")}</td><td>${inp("roteiro", r, "consultor", "text")}</td><td class="c">${inp("roteiro", r, "data_execucao", "date")}</td><td>${canEdit() ? inp("roteiro", r, "resultado", "select", RESULT) : `<span class="pill ${c}">${esc(r.resultado)}</span>`}</td><td>${inp("roteiro", r, "evidencia", "text")}</td><td>${inp("roteiro", r, "obs", "area")}</td></tr>`;
    }
    return html + "</table></div>";
  }

  // ---------- Pontos ----------
  function vPontos() {
    const list = S.data.pontos, f = S.filtro.toLowerCase();
    const vis = list.filter((p) => !f || [p.codigo, p.frente, p.tipo, p.descricao, p.responsavel, p.status].join(" ").toLowerCase().includes(f));
    const abertos = list.filter((p) => p.status !== "Resolvido"), venc = abertos.filter((p) => p.prazo && p.prazo < ref());
    let html = `<h2>Pontos de atenção</h2><p class="sub">Risco, pendência, decisão ou impedimento. "No boletim = Sim" publica o item para o cliente. Precedente = atividade que depende desta resolução; Dependentes = o que fica travado.</p>
      <div class="cards"><div class="card"><div class="lbl">Em aberto</div><div class="val">${abertos.length}</div></div><div class="card"><div class="lbl">Vencidos</div><div class="val ${venc.length ? "red" : ""}">${venc.length}</div></div><div class="card"><div class="lbl">No boletim</div><div class="val">${abertos.filter((p) => p.no_boletim).length}</div></div><div class="card"><div class="lbl">Impedimentos</div><div class="val red">${abertos.filter((p) => p.tipo === "Impedimento").length}</div></div></div>
      <div class="toolbar"><input type="search" placeholder="Filtrar…" value="${esc(S.filtro)}" oninput="app.filtro(this.value)"><div class="right">${canEdit() ? `<button class="btn small" onclick="app.novoPonto()">+ Novo ponto</button>` : ""}<button class="btn ghost dark small" onclick="app.exportar()">Exportar Excel</button></div></div>
      <div class="tbl-wrap"><table><tr><th>ID</th><th>Data</th><th>Frente</th><th>Tipo</th><th style="min-width:260px">Descrição</th><th style="min-width:200px">Impacto</th><th>Responsável</th><th>Prazo</th><th>Status</th><th>Precedente</th><th>Dependentes</th><th>Boletim?</th><th style="min-width:200px">Resolução</th></tr>`;
    const frentes = [...new Set(S.data.equipe.map((e) => e.frente))];
    for (const p of vis) {
      html += `<tr class="edit"><td class="c codes">${esc(p.codigo)}</td><td class="c">${fmtD(p.data)}</td><td>${inp("pontos", p, "frente", "select", frentes)}</td><td>${inp("pontos", p, "tipo", "select", TIPOS)}</td><td>${inp("pontos", p, "descricao", "area")}</td><td>${inp("pontos", p, "impacto", "area")}</td><td>${inp("pontos", p, "responsavel", "text")}</td><td class="c" style="${p.prazo && p.prazo < ref() && p.status !== "Resolvido" ? "color:var(--red);font-weight:bold" : ""}">${inp("pontos", p, "prazo", "date")}</td><td>${inp("pontos", p, "status", "select", PSTATUS)}</td><td>${inp("pontos", p, "precedente", "text")}</td><td>${inp("pontos", p, "dependentes", "text")}</td><td class="c">${inp("pontos", p, "no_boletim", "bool")}</td><td>${inp("pontos", p, "resolucao", "area")}</td></tr>`;
    }
    return html + "</table></div>";
  }
  async function novoPonto() {
    const n = S.data.pontos.length + 1; const codigo = "A" + String(n).padStart(2, "0");
    const descricao = prompt("Descrição do ponto de atenção:"); if (!descricao) return;
    const rec = { codigo, data: today(), tipo: "Pendência", descricao, status: "Aberto", responsavel: S.perfil.nome, atualizado_por: S.perfil.nome };
    const { data, error } = await sb.from("pontos").insert(rec).select().single();
    if (error) return toast(error.message, true);
    S.data.pontos.push(data); await sb.from("log_alteracoes").insert({ usuario: S.perfil.nome, tabela: "pontos", registro: codigo, campo: "novo", de: "", para: descricao }); show("pontos");
  }

  // ---------- Equipe ----------
  function vEquipe() {
    return `<h2>Equipe por frente</h2><p class="sub">Key user é quem valida pelo lado da AVC; consultor é quem conduz pela LT.</p>
      <div class="tbl-wrap"><table><tr><th>Frente</th><th>Key user (AVC)</th><th>Área</th><th>Consultor LT</th><th>Apoio LT</th><th>Contato</th><th>Observação</th></tr>
      ${S.data.equipe.map((e) => `<tr class="edit"><td><b>${esc(e.frente)}</b></td><td>${inp("equipe", e, "key_user", "text")}</td><td>${inp("equipe", e, "area_key_user", "text")}</td><td>${inp("equipe", e, "consultor", "text")}</td><td>${inp("equipe", e, "apoio", "text")}</td><td>${inp("equipe", e, "contato", "text")}</td><td>${inp("equipe", e, "obs", "area")}</td></tr>`).join("")}</table></div>
      <div class="section" style="margin-top:16px"><h3>Papéis no projeto (LT)</h3><div class="tbl-wrap"><table><tr><th>Papel</th><th>Nome</th><th>Responsabilidade</th></tr>
      ${S.data.papeis.map((p) => `<tr class="edit"><td><b>${esc(p.papel)}</b></td><td>${inp("papeis", p, "nome", "text")}</td><td>${esc(p.responsabilidade)}</td></tr>`).join("")}</table></div></div>`;
  }

  // ---------- Usuários (admin) ----------
  function vUsuarios() {
    if (!isAdmin()) return "<p>Acesso restrito ao administrador.</p>";
    return `<h2>Usuários</h2><p class="sub">Crie o acesso de cada consultor: a senha é gerada aqui e deve ser enviada a ele por um canal seguro. Ele pode trocá-la depois em "Ajuda".</p>
      <div class="section"><h3>Novo usuário</h3>
        <div class="users-form">
          <div><label>Nome</label><input id="nu-nome" placeholder="Nome completo"></div>
          <div><label>E-mail</label><input id="nu-email" type="email" placeholder="nome@empresa.com.br"></div>
          <div><label>Papel</label><select id="nu-papel"><option value="consultor">Consultor</option><option value="gerente">Gerente de projeto</option><option value="leitura">Somente leitura</option><option value="admin">Administrador</option></select></div>
          <div><label>Frente</label><select id="nu-frente"><option value="">—</option>${S.data.equipe.map((e) => `<option>${esc(e.frente)}</option>`).join("")}</select></div>
          <div><button class="btn" onclick="app.criarUsuario()">Gerar senha e criar</button></div>
        </div>
        ${S.lastPw ? `<div class="pw-box">Usuário criado. Envie ao consultor por canal seguro:<br>E-mail: <b>${esc(S.lastPw.email)}</b> · Senha: <code>${esc(S.lastPw.senha)}</code> <button class="btn ghost dark small" onclick="navigator.clipboard.writeText('${esc(S.lastPw.email)} / ${esc(S.lastPw.senha)}');app.toast('Copiado.')">Copiar</button><br><span class="help">A senha não fica guardada: se perder, redefina no Supabase (Authentication &gt; Users).</span></div>` : ""}
      </div>
      <div class="section"><h3>Usuários cadastrados</h3><div class="tbl-wrap"><table><tr><th>Nome</th><th>E-mail</th><th>Papel</th><th>Frente</th><th>Ativo</th><th>Desde</th><th></th></tr>
      ${S.data.perfis.map((p) => `<tr><td>${esc(p.nome)}</td><td>${esc(p.email)}</td><td><select onchange="app.setPerfil('${p.id}','papel',this.value)" ${p.id === S.user.id ? "disabled" : ""}>${["admin", "gerente", "consultor", "leitura"].map((x) => `<option ${x === p.papel ? "selected" : ""}>${x}</option>`).join("")}</select></td><td>${esc(p.frente)}</td><td class="c">${p.ativo ? '<span class="pill ok">ativo</span>' : '<span class="pill off">inativo</span>'}</td><td class="c">${fmtD(p.criado_em)}</td><td class="c">${p.id === S.user.id ? "" : `<button class="btn ghost dark small" onclick="app.setPerfil('${p.id}','ativo',${!p.ativo})">${p.ativo ? "Desativar" : "Reativar"}</button>`}</td></tr>`).join("")}</table></div>
      <p class="help" style="margin-top:8px">Para redefinir a senha de alguém: no Supabase, Authentication &gt; Users &gt; usuário &gt; "Send password recovery" (ou "Reset password"). Desativar aqui bloqueia o acesso aos dados imediatamente.</p></div>`;
  }
  function gerarSenha() {
    const a = "ABCDEFGHJKLMNPQRSTUVWXYZ", b = "abcdefghijkmnpqrstuvwxyz", n = "23456789", s = "!@#$%";
    const all = a + b + n + s; const pick = (set) => set[Math.floor(Math.random() * set.length)];
    let p = pick(a) + pick(b) + pick(n) + pick(s); while (p.length < 12) p += pick(all);
    return p.split("").sort(() => Math.random() - 0.5).join("");
  }
  async function criarUsuario() {
    const nome = $("nu-nome").value.trim(), email = $("nu-email").value.trim().toLowerCase(), papel = $("nu-papel").value, frente = $("nu-frente").value;
    if (!nome || !email) return toast("Informe nome e e-mail.", true);
    const senha = gerarSenha();
    // cliente separado para não derrubar a sessão do administrador
    const tmp = supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await tmp.auth.signUp({ email, password: senha, options: { data: { nome, papel, frente } } });
    if (error) return toast("Erro ao criar: " + error.message, true);
    if (data.user && data.user.identities && data.user.identities.length === 0) return toast("Este e-mail já tem usuário.", true);
    // garante papel/frente mesmo se o gatilho não rodar
    await sb.from("perfis").upsert({ id: data.user.id, email, nome, papel, frente });
    S.lastPw = { email, senha };
    const { data: perfis } = await sb.from("perfis").select("*").order("nome"); S.data.perfis = perfis || S.data.perfis;
    show("usuarios");
  }
  async function setPerfil(id, campo, valor) {
    const { error } = await sb.from("perfis").update({ [campo]: valor }).eq("id", id);
    if (error) return toast(error.message, true);
    const p = S.data.perfis.find((x) => x.id === id); if (p) p[campo] = valor; toast("Perfil atualizado."); show("usuarios");
  }

  // ---------- Ajuda ----------
  function vAjuda() {
    return `<h2>Ajuda</h2>
      <div class="grid2"><div class="section"><h3>Como usar</h3><ul class="help">
        <li><b>Quem atualiza:</b> cada consultor atualiza as linhas da sua frente (status, %, datas, observação) e registra pontos de atenção. O gerente consolida o boletim; o diretor aprova.</li>
        <li><b>Quando:</b> até quinta-feira às 12h, antes do status report; e sempre que uma atividade mudar de status ou surgir um impedimento.</li>
        <li><b>Regra de ouro:</b> o que não está aqui não existe para o boletim. Impedimento sem registro em Pontos de Atenção não entra no status report.</li>
        <li><b>Salvar:</b> as células amarelas são editáveis; a barra inferior mostra as alterações pendentes. Nada é gravado até clicar em "Salvar alterações".</li>
        <li><b>Boletim:</b> ajuste a data de referência, escreva "Realizado" e "Próximos passos" e use "Imprimir / PDF" para gerar o arquivo ao cliente.</li>
        <li><b>Exportar Excel:</b> gera a planilha "Acompanhamento Consultores" com as mesmas abas, usada para atualizar a ferramenta de gestão da LT.</li>
        <li><b>Não incluir:</b> horas, valores, propostas ou qualquer condição comercial.</li></ul></div>
      <div class="section"><h3>Trocar minha senha</h3>
        <div class="users-form" style="grid-template-columns:1fr auto"><div><label>Nova senha (mínimo 8 caracteres)</label><input id="np" type="password"></div><div><button class="btn" onclick="app.trocarSenha()">Alterar</button></div></div>
        <h3 style="margin-top:18px">Últimas alterações</h3><div id="log-box" class="help">Carregando…</div></div></div>`;
  }
  async function trocarSenha() {
    const p = $("np").value; if (p.length < 8) return toast("Senha muito curta.", true);
    const { error } = await sb.auth.updateUser({ password: p }); if (error) return toast(error.message, true); $("np").value = ""; toast("Senha alterada.");
  }
  async function carregarLog() {
    const box = $("log-box"); if (!box) return;
    const { data } = await sb.from("log_alteracoes").select("*").order("quando", { ascending: false }).limit(40);
    box.innerHTML = (data || []).length ? `<div class="tbl-wrap"><table><tr><th>Quando</th><th>Quem</th><th>Onde</th><th>Campo</th><th>De</th><th>Para</th></tr>${data.map((l) => `<tr><td class="c">${new Date(l.quando).toLocaleString("pt-BR")}</td><td>${esc(l.usuario)}</td><td class="codes">${esc(l.tabela)} ${esc(l.registro)}</td><td>${esc(l.campo)}</td><td class="muted">${esc(l.de).slice(0, 60)}</td><td>${esc(l.para).slice(0, 60)}</td></tr>`).join("")}</table></div>` : "Nenhuma alteração registrada ainda.";
  }

  // ---------- Exportar Excel (mesmo layout da planilha Acompanhamento Consultores) ----------
  function exportar() {
    const wb = XLSX.utils.book_new();
    const D = (d) => (d ? new Date(d + "T00:00:00") : null);
    const sheet = (name, header, rows) => { const ws = XLSX.utils.aoa_to_sheet([header, ...rows]); ws["!cols"] = header.map((h) => ({ wch: Math.min(50, Math.max(10, h.length + 4)) })); XLSX.utils.book_append_sheet(wb, ws, name); };
    const at = S.data.atividades;
    const atRows = (o) => at.filter((a) => a.origem === o).map((a) => [a.bloco, a.codigo, a.atividade, a.lado, a.consultor, a.key_user, a.status, Number(a.pct || 0) / 100, D(a.inicio), D(a.previsao), D(a.conclusao), a.previsao && a.status !== "Concluído" ? diasUteis(ref(), a.previsao) : "", situacao(a)[0], a.precedentes, dependentes(at.filter((x) => x.origem === o), a.codigo), a.ponto_atencao, a.obs, a.atualizado_por, a.atualizado_em ? new Date(a.atualizado_em) : null]);
    const H = ["Bloco", "ID", "Atividade", "Lado", "Consultor", "Key user", "Status", "% concluído", "Início", "Previsão", "Conclusão", "Dias úteis até a previsão", "Situação", "Precedentes", "Dependentes", "Ponto de atenção", "Observação do consultor", "Atualizado por", "Atualizado em"];
    sheet("Parâmetros", ["Chave", "Valor"], S.data.parametros.map((p) => [p.chave, p.valor]));
    sheet("Equipe", ["Frente", "Key user (AVC)", "Área do key user", "Consultor LT", "Apoio LT", "Contato", "Observação"], S.data.equipe.map((e) => [e.frente, e.key_user, e.area_key_user, e.consultor, e.apoio, e.contato, e.obs]));
    sheet("Cronograma Template", H, atRows("template")); sheet("Cronograma Portal", H, atRows("portal")); sheet("Customizações", H, atRows("custom"));
    sheet("Roteiro de Testes", ["ID", "Fluxo", "Cenário", "Passo", "Sistema", "Pré-condição", "Dados de teste", "Resultado esperado", "Executor (key user)", "Consultor", "Data", "Resultado", "Evidência", "Observação"], S.data.roteiro.map((r) => [r.codigo, r.fluxo, r.cenario, r.passo, r.sistema, r.pre_condicao, r.dados_teste, r.resultado_esperado, r.executor, r.consultor, D(r.data_execucao), r.resultado, r.evidencia, r.obs]));
    sheet("Pontos de Atenção", ["ID", "Data", "Frente", "Tipo", "Descrição", "Impacto se não resolvido", "Responsável", "Prazo", "Status", "Atividade precedente", "Atividades dependentes", "No boletim?", "Resolução / observação"], S.data.pontos.map((p) => [p.codigo, D(p.data), p.frente, p.tipo, p.descricao, p.impacto, p.responsavel, D(p.prazo), p.status, p.precedente, p.dependentes, p.no_boletim ? "Sim" : "Não", p.resolucao]));
    sheet("Boletim Texto", ["Data de referência", "Realizado", "Próximos passos"], S.data.boletim_texto.map((b) => [D(b.data_referencia), b.realizado, b.proximos_passos]));
    const d = new Date(), tag = `${String(d.getDate()).padStart(2, "0")}${String(d.getMonth() + 1).padStart(2, "0")}${d.getFullYear()}`;
    XLSX.writeFile(wb, `Acompanhamento Consultores - Fertilizer AVC - export ${tag}.xlsx`, { cellDates: true });
  }

  // ---------- util ----------
  function toast(msg, err) { const t = document.createElement("div"); t.className = "toast" + (err ? " err" : ""); t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), err ? 6000 : 2500); }

  window.app = { login, logout, show, mark, saveAll, discard, setRef, salvarTexto, filtro, novoPonto, criarUsuario, setPerfil, trocarSenha, exportar, toast, menu, collapse };
  window.addEventListener("hashchange", () => { if (S.user && location.hash.replace("#", "") !== S.view) show(location.hash.replace("#", "") || "boletim"); });
  const _show = show; window.app.show = (v) => { _show(v); if (v === "ajuda") carregarLog(); };
  boot();
})();
