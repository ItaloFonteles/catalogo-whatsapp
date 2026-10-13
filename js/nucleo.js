// Regras do catálogo, sem nada de tela: leitura da planilha, preços, carrinho,
// horário de funcionamento e a mensagem do pedido. Testado em tests/nucleo.test.mjs.

const semAcento = (t) => String(t ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "");

export function slug(texto) {
  return semAcento(texto).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/** CSV da planilha (vírgula ou ponto e vírgula, com aspas) → lista de objetos. */
export function lerCSV(texto) {
  texto = String(texto).replace(/^﻿/, "");
  const primeira = texto.split(/\r?\n/, 1)[0];
  const sep = (primeira.match(/;/g) || []).length > (primeira.match(/,/g) || []).length ? ";" : ",";
  const linhas = [];
  let linha = [], campo = "", aspas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (aspas) {
      if (c === '"' && texto[i + 1] === '"') { campo += '"'; i++; }
      else if (c === '"') aspas = false;
      else campo += c;
    } else if (c === '"') aspas = true;
    else if (c === sep) { linha.push(campo); campo = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && texto[i + 1] === "\n") i++;
      linha.push(campo); linhas.push(linha); linha = []; campo = "";
    } else campo += c;
  }
  if (campo !== "" || linha.length) { linha.push(campo); linhas.push(linha); }
  const [cabecalho, ...resto] = linhas.filter((l) => l.some((c) => c.trim() !== ""));
  if (!cabecalho) return [];
  const chaves = cabecalho.map((c) => slug(c).replace(/-/g, "_"));
  return resto.map((l) => Object.fromEntries(chaves.map((k, i) => [k, (l[i] ?? "").trim()])));
}

/** "R$ 1.234,56", "12,5", "12.50" → número. Vazio ou inválido → null. */
export function numero(valor) {
  let t = String(valor ?? "").replace(/[R$\s]/g, "");
  if (!t) return null;
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  const n = Number(t);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

export function brl(n) {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }).replace(/ /g, " ");
}

/** "300 ml=12,00 | 500 ml=16,00" → [{nome, preco}]. Sem "=", preço null (usa o do produto). */
export function lerOpcoes(texto) {
  return String(texto ?? "").split("|").map((p) => p.trim()).filter(Boolean).map((p) => {
    const [nome, preco] = p.split("=");
    return { nome: nome.trim(), preco: numero(preco) };
  });
}

const SIM = new Set(["", "sim", "s", "x", "1", "true", "verdadeiro"]);

/** Linhas da planilha → produtos. Uma linha sem nome é ignorada. */
export function lerProdutos(linhas) {
  const usados = new Set();
  const produtos = [];
  for (const l of linhas) {
    const nome = l.nome || l.produto;
    if (!nome) continue;
    const variacoes = lerOpcoes(l.variacoes || l.tamanhos || l.opcoes);
    const precoBase = numero(l.preco);
    const comPreco = variacoes.map((v) => v.preco).filter((p) => p != null);
    let id = slug(nome);
    for (let n = 2; usados.has(id); n++) id = `${slug(nome)}-${n}`;
    usados.add(id);
    produtos.push({
      id,
      categoria: l.categoria || "Outros",
      nome,
      descricao: l.descricao || "",
      preco: precoBase ?? (comPreco.length ? Math.min(...comPreco) : 0),
      apartir: precoBase == null && new Set(comPreco).size > 1,
      imagem: l.imagem || l.foto || "",
      disponivel: SIM.has(slug(l.disponivel)),
      destaque: slug(l.destaque) === "sim",
      variacoes,
      adicionais: lerOpcoes(l.adicionais),
    });
  }
  return produtos;
}

/** Preço de uma unidade com a variação e os adicionais escolhidos. */
export function precoUnidade(produto, variacao, adicionais = []) {
  const v = produto.variacoes.find((x) => x.nome === variacao);
  const base = v?.preco ?? produto.preco;
  const extra = adicionais.reduce((s, nome) => s + (produto.adicionais.find((a) => a.nome === nome)?.preco ?? 0), 0);
  return Math.round((base + extra) * 100) / 100;
}

/** Junta itens iguais (mesmo produto, variação e adicionais) somando a quantidade. */
export function adicionar(carrinho, produto, { variacao = "", adicionais = [], qtd = 1, obs = "" } = {}) {
  const chave = [produto.id, variacao, [...adicionais].sort().join("+"), obs].join("|");
  const existente = carrinho.find((i) => i.chave === chave);
  if (existente) return carrinho.map((i) => (i === existente ? { ...i, qtd: i.qtd + qtd } : i));
  return [...carrinho, {
    chave, produtoId: produto.id, nome: produto.nome, variacao, adicionais: [...adicionais], obs,
    preco: precoUnidade(produto, variacao, adicionais), qtd,
  }];
}

export function taxaEntrega(loja, entrega) {
  if (!entrega || entrega.tipo !== "entrega") return 0;
  const bairro = (loja.entrega?.bairros || []).find((b) => b.nome === entrega.bairro);
  return bairro ? bairro.taxa : null; // null = bairro fora da lista: taxa a combinar
}

export function totais(loja, carrinho, entrega) {
  const subtotal = Math.round(carrinho.reduce((s, i) => s + i.preco * i.qtd, 0) * 100) / 100;
  const taxa = taxaEntrega(loja, entrega);
  return { subtotal, taxa, total: Math.round((subtotal + (taxa ?? 0)) * 100) / 100,
           falta_minimo: Math.max(0, (loja.pedido_minimo ?? 0) - subtotal) };
}

/** Texto do pedido para o WhatsApp (o *asterisco* vira negrito lá). */
export function mensagem(loja, carrinho, cliente) {
  const t = totais(loja, carrinho, cliente);
  const linhas = [`*Pedido · ${loja.nome}*`, ""];
  for (const i of carrinho) {
    linhas.push(`${i.qtd}x ${i.nome}${i.variacao ? ` (${i.variacao})` : ""} — ${brl(i.preco * i.qtd)}`);
    if (i.adicionais.length) linhas.push(`   + ${i.adicionais.join(", ")}`);
    if (i.obs) linhas.push(`   obs.: ${i.obs}`);
  }
  linhas.push("", `Subtotal: ${brl(t.subtotal)}`);
  if (cliente.tipo === "entrega") {
    linhas.push(t.taxa == null ? `Entrega (${cliente.bairro || "bairro não informado"}): a combinar`
                               : `Entrega (${cliente.bairro}): ${t.taxa ? brl(t.taxa) : "grátis"}`);
  }
  linhas.push(`*Total: ${brl(t.total)}*${t.taxa == null && cliente.tipo === "entrega" ? " + entrega" : ""}`, "");
  linhas.push(`Nome: ${cliente.nome}`);
  if (cliente.tipo === "entrega") {
    linhas.push(`Entregar em: ${cliente.endereco}${cliente.bairro ? ` - ${cliente.bairro}` : ""}`);
    if (cliente.referencia) linhas.push(`Referência: ${cliente.referencia}`);
  } else {
    linhas.push("Vou retirar na loja");
  }
  const troco = numero(cliente.troco);
  linhas.push(`Pagamento: ${cliente.pagamento}${cliente.pagamento === "Dinheiro" && troco ? ` (troco para ${brl(troco)})` : ""}`);
  if (cliente.observacao) linhas.push(`Observação: ${cliente.observacao}`);
  return linhas.join("\n");
}

export function linkWhatsApp(numeroLoja, texto) {
  let d = String(numeroLoja).replace(/\D/g, "");
  if (d.length === 10 || d.length === 11) d = "55" + d;
  return `https://wa.me/${d}?text=${encodeURIComponent(texto)}`;
}

// ---------- horário de funcionamento ----------
const DIAS = ["dom", "seg", "ter", "qua", "qui", "sex", "sab"];
const NOMES = { dom: "domingo", seg: "segunda", ter: "terça", qua: "quarta", qui: "quinta", sex: "sexta", sab: "sábado" };
const minutos = (hhmm) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };

/** "08:00-12:00, 14:00-18:00" → [[480, 720], [840, 1080]]; "fechado" ou vazio → []. */
export function lerFaixas(texto) {
  return String(texto ?? "").split(",").map((f) => f.trim()).filter((f) => /^\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}$/.test(f))
    .map((f) => f.split("-").map((x) => minutos(x.trim())));
}

/** Situação agora, considerando faixas que passam da meia-noite (ex.: 18:00-02:00). */
export function situacaoHorario(horarios, data = new Date()) {
  if (!horarios) return { aberto: true, texto: "" };
  const hoje = data.getDay();
  const agora = data.getHours() * 60 + data.getMinutes();
  const faixa = (d) => lerFaixas(horarios[DIAS[(d + 7) % 7]]);
  const hm = (m) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  for (const [ini, fim] of faixa(hoje)) {
    const fimReal = fim <= ini ? fim + 1440 : fim;
    if (agora >= ini && agora < fimReal) return { aberto: true, texto: `Aberto agora · até ${hm(fim)}` };
  }
  for (const [ini, fim] of faixa(hoje - 1)) {           // faixa de ontem que passou da meia-noite
    if (fim <= ini && agora < fim) return { aberto: true, texto: `Aberto agora · até ${hm(fim)}` };
  }
  for (let d = 0; d < 7; d++) {
    const proxima = faixa(hoje + d).map(([ini]) => ini).filter((ini) => d > 0 || ini > agora).sort((a, b) => a - b)[0];
    if (proxima !== undefined) {
      const quando = d === 0 ? "hoje" : d === 1 ? "amanhã" : NOMES[DIAS[(hoje + d) % 7]];
      return { aberto: false, texto: `Fechado agora · abre ${quando} às ${hm(proxima)}` };
    }
  }
  return { aberto: false, texto: "Fechado" };
}
