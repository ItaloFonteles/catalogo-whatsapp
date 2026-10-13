import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as N from "../js/nucleo.js";

const loja = JSON.parse(readFileSync(new URL("../data/loja.json", import.meta.url), "utf8"));
const produtos = N.lerProdutos(N.lerCSV(readFileSync(new URL("../data/produtos.csv", import.meta.url), "utf8")));
const produto = (nome) => produtos.find((p) => p.nome === nome);

test("lê CSV com ponto e vírgula, vírgula, aspas e quebra de linha", () => {
  assert.deepEqual(N.lerCSV("Nome;Preço\nAçaí;12,50\n"), [{ nome: "Açaí", preco: "12,50" }]);
  // Exportado do Google Planilhas: vírgula como separador e número entre aspas
  const google = 'Categoria,Nome,Descrição,Preço\nLanches,"Misto, quente","Pão ""caseiro""\ne queijo","9,00"\r\n';
  const quebra = String.fromCharCode(10);
  assert.deepEqual(N.lerCSV(String.fromCharCode(0xfeff) + ["nome", "", "   ", ""].join(quebra)), []);   // só cabeçalho e linhas em branco
});

test("entende preços do jeito que as pessoas digitam", () => {
  assert.equal(N.numero("R$ 1.234,56"), 1234.56);
  assert.equal(N.numero("12,5"), 12.5);
  assert.equal(N.numero("12.50"), 12.5);
  assert.equal(N.numero(""), null);
  assert.equal(N.numero("abc"), null);
  assert.equal(N.brl(1234.5), "R$ 1.234,50");
});

test("produtos da planilha de exemplo", () => {
  const acai = produto("Açaí tradicional");
  assert.equal(acai.preco, 12);                 // sem preço próprio: o menor tamanho
  assert.equal(acai.apartir, true);
  assert.equal(acai.variacoes.length, 3);
  assert.equal(acai.adicionais.find((a) => a.nome === "Nutella").preco, 6);
  assert.equal(acai.destaque, true);
  assert.equal(produto("Creme de buriti").disponivel, false);
  assert.equal(produto("Água mineral").disponivel, true);
  assert.equal(new Set(produtos.map((p) => p.id)).size, produtos.length);
});

test("sabor sem preço usa o preço do produto", () => {
  const refri = produto("Refrigerante lata");
  assert.equal(refri.apartir, false);
  assert.equal(N.precoUnidade(refri, "Guaraná"), 6);
});

test("preço com tamanho e adicionais", () => {
  const acai = produto("Açaí tradicional");
  assert.equal(N.precoUnidade(acai, "500 ml", ["Granola", "Nutella"]), 24);
  assert.equal(N.precoUnidade(acai, "500 ml", ["não existe"]), 16);
});

test("carrinho junta itens iguais e separa os diferentes", () => {
  const acai = produto("Açaí tradicional");
  let c = N.adicionar([], acai, { variacao: "500 ml", adicionais: ["Granola", "Paçoca"] });
  c = N.adicionar(c, acai, { variacao: "500 ml", adicionais: ["Paçoca", "Granola"], qtd: 2 });
  assert.equal(c.length, 1);
  assert.equal(c[0].qtd, 3);
  c = N.adicionar(c, acai, { variacao: "700 ml" });
  assert.equal(c.length, 2);
});

test("totais, taxa por bairro e pedido mínimo", () => {
  const c = N.adicionar([], produto("Misto quente"), { qtd: 1 });
  assert.deepEqual(N.totais(loja, c, { tipo: "entrega", bairro: "Centro" }),
                   { subtotal: 9, taxa: 4, total: 13, falta_minimo: 6 });
  assert.equal(N.totais(loja, c, { tipo: "entrega", bairro: "Jardim Tropical" }).taxa, null);  // a combinar
  assert.equal(N.totais(loja, c, { tipo: "retirada" }).taxa, 0);
});

test("mensagem do pedido para o WhatsApp", () => {
  let c = N.adicionar([], produto("Açaí tradicional"), { variacao: "500 ml", adicionais: ["Granola"], qtd: 2, obs: "pouco gelo" });
  c = N.adicionar(c, produto("Água mineral"));
  const texto = N.mensagem(loja, c, { tipo: "entrega", bairro: "Caçari", endereco: "Rua A, 10", referencia: "portão azul",
                                      pagamento: "Dinheiro", troco: "50", nome: "Maria", observacao: "" });
  assert.equal(texto, [
    "*Pedido · Açaiteria Exemplo*", "",
    "2x Açaí tradicional (500 ml) — R$ 36,00", "   + Granola", "   obs.: pouco gelo",
    "1x Água mineral — R$ 3,50", "",
    "Subtotal: R$ 39,50", "Entrega (Caçari): R$ 6,00", "*Total: R$ 45,50*", "",
    "Nome: Maria", "Entregar em: Rua A, 10 - Caçari", "Referência: portão azul",
    "Pagamento: Dinheiro (troco para R$ 50,00)",
  ].join("\n"));
  const fora = N.mensagem(loja, c, { tipo: "entrega", bairro: "Jardim Tropical", endereco: "Rua B", pagamento: "Pix", nome: "Ana" });
  assert.match(fora, /Entrega \(Jardim Tropical\): a combinar\n\*Total: R\$ 39,50\* \+ entrega/);
  const retirada = N.mensagem(loja, c, { tipo: "retirada", pagamento: "Pix", nome: "Ana" });
  assert.match(retirada, /Vou retirar na loja/);
  assert.doesNotMatch(retirada, /Entrega/);
});

test("link do WhatsApp", () => {
  assert.equal(N.linkWhatsApp("(95) 99999-9999", "Oi, tudo?"), "https://wa.me/5595999999999?text=Oi%2C%20tudo%3F");
  assert.equal(N.linkWhatsApp("5595999999999", "x"), "https://wa.me/5595999999999?text=x");
});

test("horário de funcionamento", () => {
  const h = { seg: "08:00-12:00, 14:00-18:00", ter: "fechado", qua: "18:00-02:00", qui: "", sex: "", sab: "", dom: "" };
  const dia = (d, hh, mm = 0) => new Date(2026, 9, 12 + d, hh, mm);   // 12/10/2026 é segunda
  assert.deepEqual(N.situacaoHorario(h, dia(0, 9)), { aberto: true, texto: "Aberto agora · até 12:00" });
  assert.deepEqual(N.situacaoHorario(h, dia(0, 13)), { aberto: false, texto: "Fechado agora · abre hoje às 14:00" });
  assert.deepEqual(N.situacaoHorario(h, dia(0, 19)), { aberto: false, texto: "Fechado agora · abre quarta às 18:00" });
  assert.deepEqual(N.situacaoHorario(h, dia(2, 23)), { aberto: true, texto: "Aberto agora · até 02:00" });
  assert.deepEqual(N.situacaoHorario(h, dia(3, 1, 30)), { aberto: true, texto: "Aberto agora · até 02:00" });  // madrugada de quinta
  assert.deepEqual(N.situacaoHorario(h, dia(3, 3)), { aberto: false, texto: "Fechado agora · abre segunda às 08:00" });
  assert.deepEqual(N.situacaoHorario(h, dia(1, 7)), { aberto: false, texto: "Fechado agora · abre amanhã às 18:00" });
  assert.equal(N.situacaoHorario(undefined).aberto, true);
});
