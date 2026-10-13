// Tela do catálogo: carrega a loja e a planilha, desenha os produtos, cuida do carrinho
// e monta o pedido para o WhatsApp. As regras (preços, totais, mensagem) estão em nucleo.js.
import * as N from "./nucleo.js";

const $ = (s) => document.querySelector(s);
const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const ler = (chave, padrao) => { try { return JSON.parse(localStorage.getItem(chave)) ?? padrao; } catch { return padrao; } };
const guardar = (chave, valor) => { try { localStorage.setItem(chave, JSON.stringify(valor)); } catch { /* modo privado */ } };

let loja, produtos = [], carrinho = [], chaveCarrinho = "carrinho";
let categoriaAtiva = "", produtoAberto = null, quantidade = 1;

// ---------- início ----------
async function iniciar() {
  try {
    loja = await (await fetch("data/loja.json", { cache: "no-cache" })).json();
    aplicarLoja();
    const resposta = await fetch(loja.produtos, { cache: "no-cache" });
    if (!resposta.ok) throw new Error(`planilha respondeu ${resposta.status}`);
    produtos = N.lerProdutos(N.lerCSV(await resposta.text()));
  } catch (erro) {
    console.error(erro);
    $("#catalogo").innerHTML = '<p class="vazio">Não consegui carregar o cardápio agora. Tente de novo em instantes.</p>';
    return;
  }
  chaveCarrinho = `carrinho:${N.slug(loja.nome)}`;
  // Carrinho salvo: some o que saiu do cardápio e o preço é refeito pela planilha atual.
  carrinho = ler(chaveCarrinho, []).flatMap((i) => {
    const p = produtos.find((x) => x.id === i.produtoId && x.disponivel);
    return p ? [{ ...i, preco: N.precoUnidade(p, i.variacao, i.adicionais) }] : [];
  });
  desenharCategorias();
  desenhar();
  atualizarBarra();
  prepararPedido();
  const deLink = location.hash.match(/^#p=(.+)$/);
  if (deLink) abrirProduto(decodeURIComponent(deLink[1]));
}

function corDoTexto(hex) {
  const n = parseInt(String(hex).replace("#", ""), 16);
  if (Number.isNaN(n)) return "#fff";
  const [r, g, b] = [n >> 16, (n >> 8) & 255, n & 255];
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6 ? "#1d1b18" : "#fff";
}

function aplicarLoja() {
  document.title = `${loja.nome} · Cardápio e pedidos pelo WhatsApp`;
  document.querySelector('meta[name="description"]').content = loja.descricao || document.title;
  if (loja.cor) {
    document.documentElement.style.setProperty("--cor", loja.cor);
    document.documentElement.style.setProperty("--cor-texto", corDoTexto(loja.cor));
    document.querySelector('meta[name="theme-color"]').content = loja.cor;
  }
  $("#nome-loja").textContent = loja.nome;
  $("#descricao-loja").textContent = loja.descricao || "";
  const logo = $("#logo");
  if (loja.logo) logo.style.backgroundImage = `url("${encodeURI(loja.logo)}")`;
  else logo.textContent = loja.nome.trim().charAt(0).toUpperCase();
  $("#endereco").textContent = loja.endereco || "";
  atualizarHorario();
  setInterval(atualizarHorario, 60_000);
  const links = [loja.endereco ? esc(loja.endereco) : "",
    loja.instagram ? `<a href="https://instagram.com/${esc(loja.instagram.replace("@", ""))}" target="_blank" rel="noopener">Instagram</a>` : "",
    `<a href="${esc(N.linkWhatsApp(loja.whatsapp, "Olá! Vim pelo catálogo."))}" target="_blank" rel="noopener">WhatsApp</a>`].filter(Boolean);
  $("#rodape").innerHTML = `<p>${links.join(" · ")}</p>
    <p>Catálogo digital por <a href="https://italofonteles.dev" target="_blank" rel="noopener">Ítalo Fonteles</a></p>`;
}

function atualizarHorario() {
  const s = N.situacaoHorario(loja.horarios);
  const el = $("#horario");
  el.textContent = s.texto;
  el.classList.toggle("fechado", !s.aberto);
  return s;
}

// ---------- catálogo ----------
function desenharCategorias() {
  const categorias = [...new Set(produtos.map((p) => p.categoria))];
  $("#categorias").innerHTML = ["", ...categorias].map((c) =>
    `<button type="button" data-categoria="${esc(c)}" class="${c === categoriaAtiva ? "ativa" : ""}">${esc(c || "Tudo")}</button>`).join("");
}

function cartao(p) {
  const imagem = p.imagem ? ` style="background-image:url('${esc(encodeURI(p.imagem))}')"` : "";
  const preco = p.preco ? `${p.apartir ? "<small>a partir de </small>" : ""}${N.brl(p.preco)}` : "";
  return `<button type="button" class="produto${p.disponivel ? "" : " indisponivel"}" data-produto="${esc(p.id)}">
    <div class="txt">${p.destaque ? '<span class="selo">Mais pedido</span>' : ""}
      <h3>${esc(p.nome)}</h3><span class="desc">${esc(p.descricao)}</span><span class="preco">${preco}</span></div>
    <div class="miniatura"${imagem}>${p.imagem ? "" : esc(p.nome.charAt(0))}</div></button>`;
}

function desenhar() {
  const busca = N.slug($("#busca").value);
  const visiveis = produtos.filter((p) => (!categoriaAtiva || p.categoria === categoriaAtiva)
    && (!busca || N.slug(`${p.nome} ${p.descricao} ${p.categoria}`).includes(busca)));
  if (!visiveis.length) {
    $("#catalogo").innerHTML = `<p class="vazio">Nada encontrado${busca ? ` para “${esc($("#busca").value)}”` : ""}.</p>`;
    return;
  }
  const grupos = new Map();
  if (!busca && !categoriaAtiva) {
    const destaques = visiveis.filter((p) => p.destaque && p.disponivel);
    if (destaques.length) grupos.set("Destaques", destaques);
  }
  for (const p of visiveis) grupos.set(p.categoria, [...(grupos.get(p.categoria) || []), p]);
  $("#catalogo").innerHTML = [...grupos].map(([nome, lista]) => `<section class="secao">
    <h2>${esc(nome)}</h2>
    <div class="grade">${[...lista].sort((a, b) => b.disponivel - a.disponivel).map(cartao).join("")}</div></section>`).join("");
}

// ---------- escolher produto ----------
function abrirProduto(id) {
  const p = produtos.find((x) => x.id === id);
  if (!p) return;
  produtoAberto = p;
  quantidade = 1;
  const foto = $("#p-foto");
  foto.style.backgroundImage = p.imagem ? `url('${encodeURI(p.imagem)}')` : "";
  foto.textContent = "";
  $("#p-nome").textContent = p.nome;
  $("#p-descricao").textContent = p.descricao;
  $("#p-obs").value = "";
  const variacoes = $("#p-variacoes");
  variacoes.hidden = !p.variacoes.length;
  variacoes.querySelector(".opcoes").innerHTML = p.variacoes.map((v, i) => `<label>
    <input type="radio" name="variacao" value="${esc(v.nome)}" ${i === 0 ? "checked" : ""}> ${esc(v.nome)}
    <span class="preco-op">${v.preco != null ? N.brl(v.preco) : ""}</span></label>`).join("");
  const adicionais = $("#p-adicionais");
  adicionais.hidden = !p.adicionais.length;
  adicionais.querySelector(".opcoes").innerHTML = p.adicionais.map((a) => `<label>
    <input type="checkbox" name="adicional" value="${esc(a.nome)}"> ${esc(a.nome)}
    <span class="preco-op">${a.preco ? `+ ${N.brl(a.preco)}` : ""}</span></label>`).join("");
  atualizarProduto();
  $("#dlg-produto").showModal();
}

function escolhaAtual() {
  return {
    variacao: $('#form-produto input[name="variacao"]:checked')?.value || "",
    adicionais: [...document.querySelectorAll('#form-produto input[name="adicional"]:checked')].map((i) => i.value),
  };
}

function atualizarProduto() {
  const p = produtoAberto;
  const { variacao, adicionais } = escolhaAtual();
  $("#p-qtd").textContent = quantidade;
  const botao = $("#p-adicionar");
  botao.disabled = !p.disponivel;
  botao.textContent = p.disponivel ? `Adicionar · ${N.brl(N.precoUnidade(p, variacao, adicionais) * quantidade)}` : "Indisponível no momento";
}

$("#form-produto").addEventListener("change", atualizarProduto);
$("#form-produto").addEventListener("click", (e) => {
  const b = e.target.closest("[data-qtd]");
  if (!b) return;
  quantidade = Math.max(1, Math.min(50, quantidade + Number(b.dataset.qtd)));
  atualizarProduto();
});
$("#form-produto").addEventListener("submit", (e) => {
  e.preventDefault();
  if (!produtoAberto?.disponivel) return;
  carrinho = N.adicionar(carrinho, produtoAberto, { ...escolhaAtual(), qtd: quantidade, obs: $("#p-obs").value.trim() });
  guardar(chaveCarrinho, carrinho);
  $("#dlg-produto").close();
  atualizarBarra();
  avisar(`${quantidade}x ${produtoAberto.nome} no pedido`);
});

// ---------- barra e avisos ----------
function atualizarBarra() {
  const itens = carrinho.reduce((s, i) => s + i.qtd, 0);
  $("#ver-pedido").hidden = itens === 0;
  $("#qtd-itens").textContent = itens;
  $("#rotulo-itens").textContent = itens === 1 ? "item" : "itens";
  $("#total-barra").textContent = N.brl(N.totais(loja, carrinho, null).subtotal);
}

let timerAviso;
function avisar(texto, acao) {
  const t = $("#toast");
  t.innerHTML = esc(texto) + (acao ? ` <button type="button">${esc(acao.rotulo)}</button>` : "");
  if (acao) t.querySelector("button").addEventListener("click", () => { acao.fazer(); t.hidden = true; });
  t.hidden = false;
  clearTimeout(timerAviso);
  timerAviso = setTimeout(() => (t.hidden = true), acao ? 12000 : 2500);
}

// ---------- pedido ----------
function prepararPedido() {
  const salvo = ler("cliente", {});
  const entrega = loja.entrega || {};
  $("#op-retirada").hidden = !entrega.retirada;
  $("#bairro").innerHTML = '<option value="">Escolha o bairro</option>'
    + (entrega.bairros || []).map((b) => `<option value="${esc(b.nome)}">${esc(b.nome)} · ${b.taxa ? N.brl(b.taxa) : "grátis"}</option>`).join("")
    + '<option value="__outro__">Outro bairro (taxa a combinar)</option>';
  $("#bairro").insertAdjacentHTML("afterend", '<input type="text" id="bairro-outro" placeholder="Qual bairro?" hidden>');
  $("#aviso-bairro").textContent = entrega.aviso_outros_bairros || "";
  $("#info-retirada").textContent = loja.endereco ? `Retirada em: ${loja.endereco}` : "";
  $("#pagamentos").innerHTML = (loja.pagamento || ["Pix", "Dinheiro"]).map((p, i) =>
    `<label><input type="radio" name="pagamento" value="${esc(p)}" ${i === 0 ? "checked" : ""}> ${esc(p)}</label>`).join("");
  $("#chave-pix").textContent = loja.pix || "";

  // Dados da última compra: o cliente não precisa digitar de novo.
  $("#nome-cliente").value = salvo.nome || "";
  $("#endereco-cliente").value = salvo.endereco || "";
  $("#referencia").value = salvo.referencia || "";
  if (salvo.bairro) {
    const naLista = (entrega.bairros || []).some((b) => b.nome === salvo.bairro);
    $("#bairro").value = naLista ? salvo.bairro : "__outro__";
    if (!naLista) $("#bairro-outro").value = salvo.bairro;
  }
  for (const [nome, valor] of [["tipo", salvo.tipo], ["pagamento", salvo.pagamento]]) {
    const r = document.querySelector(`#form-pedido input[name="${nome}"][value="${CSS.escape(valor || "")}"]`);
    if (r && !r.closest("[hidden]")) r.checked = true;
  }
}

function dadosCliente() {
  const f = $("#form-pedido");
  const bairroEscolhido = $("#bairro").value;
  return {
    tipo: f.querySelector('input[name="tipo"]:checked')?.value || "entrega",
    bairro: bairroEscolhido === "__outro__" ? $("#bairro-outro").value.trim() : bairroEscolhido,
    endereco: $("#endereco-cliente").value.trim(),
    referencia: $("#referencia").value.trim(),
    pagamento: f.querySelector('input[name="pagamento"]:checked')?.value || "",
    troco: $("#troco").value.trim(),
    nome: $("#nome-cliente").value.trim(),
    observacao: $("#observacao").value.trim(),
  };
}

function desenharPedido() {
  $("#itens").innerHTML = carrinho.map((i, n) => `<li class="item">
    <div><b>${esc(i.nome)}</b>${i.variacao ? ` · ${esc(i.variacao)}` : ""}
      ${i.adicionais.length ? `<div class="detalhe">+ ${esc(i.adicionais.join(", "))}</div>` : ""}
      ${i.obs ? `<div class="detalhe">obs.: ${esc(i.obs)}</div>` : ""}</div>
    <div class="qtd"><button type="button" data-item="${n}" data-mudar="-1" aria-label="${i.qtd === 1 ? "Remover" : "Diminuir"}">${i.qtd === 1 ? "🗑" : "−"}</button>
      <output>${i.qtd}</output><button type="button" data-item="${n}" data-mudar="1" aria-label="Aumentar">+</button></div>
    <div>${N.brl(i.preco * i.qtd)}</div></li>`).join("");
  atualizarPedido();
}

function atualizarPedido() {
  const c = dadosCliente();
  const entrega = c.tipo === "entrega";
  $("#campos-entrega").hidden = !entrega;
  $("#info-retirada").hidden = entrega || !loja.endereco;
  $("#bairro-outro").hidden = $("#bairro").value !== "__outro__";
  $("#campo-troco").hidden = c.pagamento !== "Dinheiro";
  $("#info-pix").hidden = !(c.pagamento === "Pix" && loja.pix);

  const t = N.totais(loja, carrinho, c);
  const linhas = [["Subtotal", N.brl(t.subtotal)]];
  if (entrega) linhas.push(["Entrega", !c.bairro ? "escolha o bairro" : t.taxa == null ? "a combinar" : t.taxa ? N.brl(t.taxa) : "grátis"]);
  $("#totais").innerHTML = linhas.map(([a, b]) => `<dt>${a}</dt><dd>${b}</dd>`).join("")
    + `<dt class="total">Total</dt><dd class="total">${N.brl(t.total)}${entrega && t.taxa == null && c.bairro ? " + entrega" : ""}</dd>`;

  const minimo = $("#aviso-minimo");
  minimo.hidden = t.falta_minimo <= 0;
  minimo.textContent = `Pedido mínimo de ${N.brl(loja.pedido_minimo)}: faltam ${N.brl(t.falta_minimo)}.`;
  $("#form-pedido .principal").disabled = t.falta_minimo > 0 || !carrinho.length;

  const horario = atualizarHorario();
  $("#aviso-fechado").hidden = horario.aberto;
  $("#aviso-fechado").textContent = `${horario.texto}. Você pode mandar o pedido: respondemos assim que abrirmos.`;
}

$("#ver-pedido").addEventListener("click", () => {
  desenharPedido();
  $("#erro-pedido").textContent = "";
  $("#dlg-pedido").showModal();
});
$("#form-pedido").addEventListener("input", () => { $("#erro-pedido").textContent = ""; atualizarPedido(); });
$("#form-pedido").addEventListener("click", (e) => {
  const b = e.target.closest("[data-mudar]");
  if (!b) return;
  const n = Number(b.dataset.item);
  carrinho = carrinho.map((i, k) => (k === n ? { ...i, qtd: i.qtd + Number(b.dataset.mudar) } : i)).filter((i) => i.qtd > 0);
  guardar(chaveCarrinho, carrinho);
  atualizarBarra();
  if (!carrinho.length) { $("#dlg-pedido").close(); return; }
  desenharPedido();
});
$("#copiar-pix").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText(loja.pix); avisar("Chave Pix copiada"); }
  catch { avisar(`Chave Pix: ${loja.pix}`); }
});

$("#form-pedido").addEventListener("submit", (e) => {
  e.preventDefault();
  const c = dadosCliente();
  const faltando = [
    [!c.nome, "#nome-cliente", "Informe seu nome."],
    [c.tipo === "entrega" && !c.bairro, $("#bairro").value === "__outro__" ? "#bairro-outro" : "#bairro", "Escolha o bairro da entrega."],
    [c.tipo === "entrega" && !c.endereco, "#endereco-cliente", "Informe o endereço da entrega."],
    [!c.pagamento, "#pagamentos input", "Escolha a forma de pagamento."],
  ].find(([falta]) => falta);
  if (faltando) {
    $("#erro-pedido").textContent = faltando[2];
    $(faltando[1]).focus();
    return;
  }
  guardar("cliente", { nome: c.nome, endereco: c.endereco, referencia: c.referencia, bairro: c.bairro, tipo: c.tipo, pagamento: c.pagamento });
  const link = N.linkWhatsApp(loja.whatsapp, N.mensagem(loja, carrinho, c));
  if (!window.open(link, "_blank")) location.href = link;
  $("#dlg-pedido").close();
  avisar("Abrimos o WhatsApp com o seu pedido. Já enviou?", {
    rotulo: "Limpar carrinho",
    fazer: () => { carrinho = []; guardar(chaveCarrinho, carrinho); atualizarBarra(); },
  });
});

// ---------- eventos gerais ----------
$("#busca").addEventListener("input", desenhar);
$("#categorias").addEventListener("click", (e) => {
  const b = e.target.closest("[data-categoria]");
  if (!b) return;
  categoriaAtiva = b.dataset.categoria;
  desenharCategorias();
  desenhar();
});
$("#catalogo").addEventListener("click", (e) => {
  const b = e.target.closest("[data-produto]");
  if (b) abrirProduto(b.dataset.produto);
});
document.querySelectorAll("[data-fechar]").forEach((b) => b.addEventListener("click", () => b.closest("dialog").close()));
document.querySelectorAll("dialog").forEach((d) => d.addEventListener("click", (e) => { if (e.target === d) d.close(); }));

iniciar();
