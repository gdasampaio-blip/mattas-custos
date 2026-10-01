/* ===========================================================================
   app.js — a tela.

   Liga o formulário, a lista, o painel e os cadastros aos dados da planilha
   (dados.js) e às regras de negócio (calculo.js).
   =========================================================================== */

(function () {
  "use strict";

  var D = { transacoes: [], obras: [], socios: [], categorias: [], fornecedores: [], lidoEm: null };
  var apuracao = null;
  var editandoId = null;
  var abertoId = null;

  var estado = {
    tipo: "despesa", obra: "", pagante: "", recebedor: "", nf: "pendente",
    adm: true, valor: 0, expr: "", data: hoje(), categoria: "", recorrente: "",
    parcelado: false, nparc: 2
  };
  var filtros = { obra: "todas", mes: "todos", pagante: "todos", dest: "todos",
                  cat: "todas", nf: "todos", sit: "todas", busca: "" };

  var MESES = ["jan","fev","mar","abr","mai","jun","jul","ago","set","out","nov","dez"];
  var DIAS = ["domingo","segunda","terça","quarta","quinta","sexta","sábado"];

  /* ------------------------------------------------------------ utilidades */
  function $(s) { return document.querySelector(s); }
  function el(tag, cls, txt) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt !== null && txt !== undefined) e.textContent = txt;
    return e;
  }
  function hoje() { return isoLocal(new Date()); }
  function isoLocal(d) {
    return d.getFullYear() + "-" + ("0"+(d.getMonth()+1)).slice(-2) + "-" + ("0"+d.getDate()).slice(-2);
  }
  function brl(v) {
    return (Number(v) || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function mesLabel(ym) {
    var p = String(ym).split("-");
    return MESES[Number(p[1]) - 1] + "/" + p[0];
  }
  function diaLabel(iso) {
    if (!iso) return "sem data";
    var p = iso.split("-");
    var d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    if (iso === hoje()) return "hoje · " + p[2] + "/" + p[1];
    return DIAS[d.getDay()] + " · " + p[2] + "/" + p[1] + "/" + p[0].slice(2);
  }
  function obra(id) {
    for (var i = 0; i < D.obras.length; i++) if (D.obras[i].id === id) return D.obras[i];
    return null;
  }
  function obraNome(id) { var o = obra(id); return o ? o.nome : (id || ""); }
  function obraCurto(id) { var o = obra(id); return o ? o.curto : (id || ""); }
  function socioNome(id) {
    for (var i = 0; i < D.socios.length; i++) if (D.socios[i].id === id) return D.socios[i].nome;
    return id || "";
  }
  function categoria(nome) {
    for (var i = 0; i < D.categorias.length; i++) if (D.categorias[i].nome === nome) return D.categorias[i];
    return null;
  }
  function catExiste(nome) { return !!categoria(nome); }
  function catAdm(nome) { var c = categoria(nome); return c ? c.admPadrao : true; }
  function fornecedorExiste(nome) {
    for (var i = 0; i < D.fornecedores.length; i++) if (D.fornecedores[i].nome === nome) return true;
    return false;
  }
  function acharT(id) {
    for (var i = 0; i < D.transacoes.length; i++) if (D.transacoes[i].id === id) return D.transacoes[i];
    return null;
  }
  function temValor(t) { return window.Calculo.temValor(t); }

  /* Uma parcela de compra parcelada é reconhecida pelo fim da descrição:
     "Material Hidráulico - Parcela 1/2 (R$5.745,26)". O valor da parcela mora
     ali, e não na coluna de valor, até o mês dela chegar — com valor, ela já
     entraria no rateio. Assim a planilha não precisa de coluna nova. */
  var RX_PARCELA = / - Parcela (\d+)\/(\d+) \(R\$ ?([\d.]+,\d{2})\)$/;
  function parcelaDe(t) {
    var m = RX_PARCELA.exec((t && t.descricao) || "");
    if (!m) return null;
    return { n: Number(m[1]), de: Number(m[2]),
             valor: Number(m[3].replace(/\./g, "").replace(",", ".")),
             base: t.descricao.slice(0, m.index) };
  }
  function parcelaPendente(t) { return t.tipo === "despesa" && !temValor(t) && !!parcelaDe(t); }
  function somarMeses(iso, k) {
    var p = String(iso).split("-");
    var ano = Number(p[0]), mes = Number(p[1]) - 1 + k, dia = Number(p[2]) || 1;
    var alvo = new Date(ano, mes, 1);
    var ultimo = new Date(alvo.getFullYear(), alvo.getMonth() + 1, 0).getDate();
    return isoLocal(new Date(alvo.getFullYear(), alvo.getMonth(), Math.min(dia, ultimo)));
  }

  /* ------------------------------------------------------------ mensagens */
  var toastTimer = null;
  function toast(msg, direita) {
    var t = $("#toast");
    t.innerHTML = "";
    t.appendChild(el("span", null, msg));
    if (direita) t.appendChild(el("b", null, direita));
    t.classList.add("on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove("on"); }, 3000);
  }
  function toastValor(msg, v) { toast(msg, "R$ " + brl(v)); }

  /* ============================== ENTRADA ============================== */

  function iniciar() {
    window.Dados.configurar(window.CONFIG);

    if (!window.CONFIG || String(window.CONFIG.clientId).indexOf("COLE_AQUI") === 0) {
      mostrarErroPorta("O arquivo config.js ainda não foi preenchido com o ID do cliente e o ID da planilha. " +
                       "Veja a seção 5 do PLANO.md.");
      $("#btn-entrar").disabled = true;
      return;
    }

    $("#btn-entrar").addEventListener("click", function () {
      esconderErroPorta();
      portaCarregando("Abrindo o login do Google...");
      window.Dados.entrar()
        .then(abrirApp)
        .catch(function (e) {
          portaBotao();
          mostrarErroPorta(e.message || "Não consegui entrar.");
        });
    });

    /* O token do Google dura uma hora. Em vez de pedir o login de novo a cada
       abertura, tentamos renovar em silêncio: se a sessão do Google está viva e
       a permissão já foi dada, ninguém vê tela nenhuma. O botão só aparece
       quando esse caminho falha. */
    if (window.Dados.podeTentarSilencioso()) {
      portaCarregando("Entrando...");
      window.Dados.entrarSilencioso()
        .then(abrirApp)
        .catch(function () { portaBotao(); });
    } else {
      portaBotao();
    }
  }

  function portaCarregando(msg) {
    var c = $("#porta-corpo");
    c.innerHTML = "";
    var d = el("div", "carregando");
    d.appendChild(el("i", "girando"));
    d.appendChild(el("span", null, msg));
    c.appendChild(d);
  }
  function portaBotao() {
    var c = $("#porta-corpo");
    c.innerHTML = "";
    c.appendChild(el("p", "porta-txt", "Entre com a conta Google que tem acesso à planilha."));
    var b = el("button", "save", "Entrar com o Google");
    b.id = "btn-entrar";
    b.addEventListener("click", function () {
      esconderErroPorta();
      portaCarregando("Abrindo o login do Google...");
      window.Dados.entrar().then(abrirApp).catch(function (e) {
        portaBotao(); mostrarErroPorta(e.message || "Não consegui entrar.");
      });
    });
    c.appendChild(b);
  }
  function mostrarErroPorta(msg) {
    var e = $("#porta-erro");
    e.textContent = msg; e.hidden = false;
  }
  function esconderErroPorta() { $("#porta-erro").hidden = true; }

  function abrirApp() {
    portaCarregando("Conferindo a planilha...");
    return window.Dados.estrutura()
      .then(function (abas) {
        var faltam = window.Dados.abasQueFaltam(abas);
        if (faltam.length) return oferecerImportacao(faltam);
        return lerEAbrir();
      })
      .catch(function (e) {
        portaBotao();
        mostrarErroPorta(e.message || "Não consegui abrir a planilha.");
      });
  }

  /* Primeira vez: a planilha ainda está vazia. */
  function oferecerImportacao(faltam) {
    var c = $("#porta-corpo");
    c.innerHTML = "";
    c.appendChild(el("p", "porta-txt",
      "Esta planilha ainda está vazia. Posso montar tudo agora: crio as abas e escrevo os " +
      "1.013 lançamentos do histórico, de janeiro de 2023 até hoje, já conferidos contra a planilha antiga."));
    var b = el("button", "save", "Montar a planilha e importar o histórico");
    b.addEventListener("click", function () {
      portaCarregando("Preparando...");
      window.Dados.importarHistorico(function (msg) { portaCarregando(msg); })
        .then(function () { return lerEAbrir(); })
        .catch(function (e) {
          portaBotao();
          mostrarErroPorta("A importação parou: " + (e.message || "erro desconhecido") +
                           " — o que já entrou continua lá; pode tentar de novo.");
        });
    });
    c.appendChild(b);
    var faltamTxt = el("div", "porta-rodape", "Abas a criar: " + faltam.join(", ") + ".");
    c.appendChild(faltamTxt);
  }

  function lerEAbrir() {
    portaCarregando("Lendo a planilha...");
    return window.Dados.carregar()
      .then(function (dados) {
        D = dados;
        $("#porta").hidden = true;
        $("#app").hidden = false;
        montarTudo();
        return window.Dados.sincronizar().catch(function () {});
      })
      .then(function () { atualizarRede(); })
      .catch(function (e) {
        var cache = window.Dados.doCache();
        if (cache) {
          D = cache;
          $("#porta").hidden = true;
          $("#app").hidden = false;
          montarTudo();
          toast("Sem conexão com a planilha. Mostrando a última cópia deste aparelho.");
        } else {
          portaBotao();
          mostrarErroPorta(e.message || "Não consegui ler a planilha.");
        }
      });
  }

  /* ============================== MONTAGEM ============================== */

  function montarTudo() {
    if (!estado.obra && D.obras.length) estado.obra = D.obras[0].id;
    if (!estado.pagante && D.socios.length) estado.pagante = D.socios[0].id;
    if (!estado.recebedor && D.socios.length > 1) estado.recebedor = D.socios[1].id;
    if (!estado.categoria && D.categorias.length) estado.categoria = D.categorias[0].nome;

    var u = window.Dados.usuario();
    if (u) $("#quem").textContent = u.email;

    montarChips();
    montarListasAuxiliares();
    $("#data").value = estado.data;
    $("#categoria").value = estado.categoria;
    $("#brandctx").textContent = obraCurto(estado.obra);
    sincronizarAdm();
    ligarEventos();
    aplicarTipo("despesa");
    recalcular();
    irPara("lancar");
  }

  function recalcular() {
    apuracao = window.Calculo.apurar(D);
    montarFiltros();
    renderTx();
    renderPainel();
    renderCadastros();
    atualizarRede();
  }

  function chipsDe(cont, itens, campo, rotulo, aoEscolher) {
    cont.innerHTML = "";
    itens.forEach(function (it) {
      var b = el("button", "chip", rotulo(it));
      b.type = "button";
      b.setAttribute("aria-pressed", String(estado[campo] === it.id));
      b.addEventListener("click", function () {
        estado[campo] = it.id;
        Array.prototype.forEach.call(cont.children, function (c) { c.setAttribute("aria-pressed", "false"); });
        b.setAttribute("aria-pressed", "true");
        if (aoEscolher) aoEscolher(it);
        validar();
      });
      cont.appendChild(b);
    });
  }

  function montarChips() {
    var ativas = D.obras.filter(function (o) { return o.status !== "encerrada"; });
    chipsDe($("#obras"), ativas, "obra", function (o) { return o.curto; }, function (o) {
      $("#brandctx").textContent = o.curto;
    });
    chipsDe($("#pagantes"), D.socios, "pagante", function (s) { return s.nome; });
    chipsDe($("#recebedores"), D.socios, "recebedor", function (s) { return s.nome; });
  }

  function montarListasAuxiliares() {
    var lf = $("#l-forn"); lf.innerHTML = "";
    D.fornecedores.slice().sort(function (a, b) { return a.nome.localeCompare(b.nome, "pt-BR"); })
      .forEach(function (f) { var o = document.createElement("option"); o.value = f.nome; lf.appendChild(o); });

    // descrições que você mais usa, para o autocompletar
    var cont = {};
    D.transacoes.forEach(function (t) {
      // parcela sugere só a descrição da compra, sem o "- Parcela 1/2 (R$...)"
      var pc = parcelaDe(t), ds = pc ? pc.base : t.descricao;
      if (ds) cont[ds] = (cont[ds] || 0) + 1;
    });
    var ld = $("#l-desc"); ld.innerHTML = "";
    Object.keys(cont).sort(function (a, b) { return cont[b] - cont[a]; }).slice(0, 40)
      .forEach(function (d) { var o = document.createElement("option"); o.value = d; ld.appendChild(o); });
  }

  /* ====================== COMBOBOX DE CATEGORIA ====================== */

  var cbIdx = -1, cbOpts = [];
  function cbAbrir(filtro) {
    var lista = $("#cblist");
    var q = (filtro || "").trim().toLowerCase();
    cbOpts = D.categorias.map(function (c) { return c.nome; })
      .filter(function (n) { return !q || n.toLowerCase().indexOf(q) !== -1; });
    lista.innerHTML = "";
    if (!cbOpts.length) {
      lista.appendChild(el("div", "cb-vazio", "Nenhuma categoria com esse texto. Cadastre em Cadastros."));
    } else {
      cbOpts.forEach(function (nome, i) {
        var d = el("div", "cb-opt");
        d.setAttribute("role", "option");
        if (q) {
          var p = nome.toLowerCase().indexOf(q);
          d.appendChild(document.createTextNode(nome.slice(0, p)));
          d.appendChild(el("b", null, nome.slice(p, p + q.length)));
          d.appendChild(document.createTextNode(nome.slice(p + q.length)));
        } else { d.textContent = nome; }
        if (i === cbIdx) d.classList.add("on");
        d.addEventListener("mousedown", function (ev) { ev.preventDefault(); cbEscolher(nome); });
        lista.appendChild(d);
      });
    }
    lista.hidden = false;
    $("#categoria").setAttribute("aria-expanded", "true");
  }
  function cbFechar() {
    $("#cblist").hidden = true;
    $("#categoria").setAttribute("aria-expanded", "false");
    cbIdx = -1;
  }
  function cbEscolher(nome) {
    estado.categoria = nome;
    var i = $("#categoria");
    i.value = nome; i.classList.remove("erro");
    cbFechar(); sincronizarAdm();
    $("#cathint").textContent = "";
    validar();
  }
  function cbValidarSaida() {
    var i = $("#categoria"), v = i.value.trim();
    if (catExiste(v)) { cbEscolher(v); return; }
    var q = v.toLowerCase();
    var m = q ? D.categorias.filter(function (c) { return c.nome.toLowerCase().indexOf(q) !== -1; }) : [];
    if (m.length === 1) { cbEscolher(m[0].nome); return; }
    i.value = estado.categoria || "";
    i.classList.toggle("erro", v !== "" && v !== estado.categoria);
    $("#cathint").textContent = v ? "essa categoria não existe" : "digite para filtrar";
    if (v) setTimeout(function () {
      i.classList.remove("erro");
      $("#cathint").textContent = "digite para filtrar";
    }, 2200);
    cbFechar();
  }
  function sincronizarAdm() {
    estado.adm = catAdm(estado.categoria);
    $("#adm").setAttribute("aria-pressed", String(estado.adm));
    $("#admhint").textContent = estado.adm
      ? "tem trabalho envolvido — sugerido pela categoria"
      : "conta fixa, sem trabalho envolvido — sugerido pela categoria";
  }

  /* ============================ FORMULÁRIO ============================ */

  function lerValor(txt) {
    var t = String(txt).trim();
    if (!t) return { cent: 0, expr: "" };
    if (/^[0-9+\-*/(). ]+$/.test(t) && /[+\-*/]/.test(t.replace(/^-/, ""))) {
      try {
        var r = Function('"use strict";return (' + t.replace(/,/g, ".") + ")")();
        if (typeof r === "number" && isFinite(r)) return { cent: Math.round(r * 100), expr: t };
      } catch (e) {}
    }
    var d = t.replace(/[^\d]/g, "");
    return { cent: d ? parseInt(d, 10) : 0, expr: "" };
  }

  function validar() {
    var tem = estado.valor > 0;
    var h = $("#hint"), btn = $("#salvar");
    var ok = false;

    if (estado.tipo === "acerto") {
      ok = tem && estado.pagante !== estado.recebedor;
      btn.textContent = editandoId ? "Salvar alterações" : "Registrar acerto";
      if (!tem) h.textContent = "Preencha o valor para salvar";
      else if (estado.pagante === estado.recebedor) h.textContent = "Escolha dois sócios diferentes";
      else h.textContent = socioNome(estado.pagante) + " depositou para " + socioNome(estado.recebedor);
    } else {
      var base = $("#destinatario").value.trim() !== "" &&
                 $("#descricao").value.trim() !== "" && catExiste(estado.categoria);
      ok = base;
      var semValor = base && !tem;
      if (emParcelas()) {
        var n = estado.nparc;
        ok = base && tem && n >= 2;
        btn.textContent = "Salvar " + (n >= 2 ? n + " parcelas" : "parcelas");
        if (!base) h.textContent = "Falta o destinatário, a descrição ou a categoria";
        else if (!tem) h.textContent = "Preencha o valor total da compra";
        else if (n < 2) h.textContent = "Informe 2 parcelas ou mais";
        else h.textContent = n + "x de R$ " + brl(Math.floor(estado.valor / n) / 100) +
                             " · ficam sem valor até você lançar as parcelas do mês";
        btn.disabled = !ok;
        return;
      }
      btn.textContent = editandoId ? "Salvar alterações"
                      : (semValor ? "Salvar sem valor"
                      : (estado.tipo === "receita" ? "Salvar receita" : "Salvar lançamento"));
      if (!base) h.textContent = "Falta o destinatário, a descrição ou a categoria";
      else if (semValor) h.textContent = "Fica aguardando valor, fora do rateio até você preencher";
      else if (estado.expr) h.textContent = "Conta " + estado.expr + " guardada na observação";
      else h.textContent = obraNome(estado.obra) + " · " + socioNome(estado.pagante) +
                           (estado.tipo === "receita" ? " recebeu" : " pagou");
    }
    btn.disabled = !ok;
  }

  function aplicarTipo(t) {
    estado.tipo = t;
    Array.prototype.forEach.call(document.querySelectorAll("[data-tipo]"), function (b) {
      b.setAttribute("aria-pressed", String(b.dataset.tipo === t));
    });
    var acerto = (t === "acerto"), receita = (t === "receita");
    $("#f-destinatario").hidden = acerto;
    $("#f-descricao").hidden = acerto;
    $("#f-categoria").hidden = acerto;
    $("#f-obra").hidden = acerto;
    $("#f-adm").hidden = acerto || receita;
    $("#f-nf").hidden = acerto;
    $("#f-recebedor").hidden = !acerto;
    $("#lblPagante").textContent = acerto ? "Quem depositou" : (receita ? "Quem recebeu" : "Quem pagou");
    $("#lblDest").textContent = receita ? "Quem pagou" : "Destinatário";
    pintarParcelado();
    validar();
  }

  /* Parcelar só existe ao criar uma despesa: editar uma parcela é editar
     aquela linha, não a compra inteira. */
  function emParcelas() { return estado.parcelado && estado.tipo === "despesa" && !editandoId; }
  function pintarParcelado() {
    $("#f-parcelado").hidden = estado.tipo !== "despesa" || !!editandoId;
    $("#parcelado").setAttribute("aria-pressed", String(estado.parcelado));
    $("#f-nparc").hidden = !estado.parcelado;
    $("#parchint").textContent = estado.parcelado
      ? "o valor é o total da compra · uma parcela por mês, a partir da data"
      : "à vista";
  }

  function pintarRecorrente() {
    var on = !!estado.recorrente;
    $("#recorrente").setAttribute("aria-pressed", String(on));
    $("#rechint").textContent = !on ? "não se repete"
      : (estado.recorrente === "nova" ? "repete todo mês · valor ainda a conferir"
                                      : "repete todo mês");
  }

  function dadosDoFormulario() {
    var dest = $("#destinatario").value.trim();
    var obs = [$("#obs").value.trim(), estado.expr ? "conta: " + estado.expr : ""].filter(Boolean).join(" · ");
    return {
      data: estado.data,
      tipo: estado.tipo,
      obra: estado.tipo === "acerto" ? "" : estado.obra,
      pagante: estado.pagante,
      recebedor: estado.tipo === "acerto" ? estado.recebedor : "",
      destinatario: estado.tipo === "acerto" ? socioNome(estado.recebedor) : dest,
      descricao: estado.tipo === "acerto" ? "Acerto entre sócios" : $("#descricao").value.trim(),
      categoria: estado.tipo === "acerto" ? "" : estado.categoria,
      valor: estado.valor > 0 ? estado.valor / 100 : null,
      incideAdm: estado.tipo === "despesa" ? estado.adm : false,
      statusNf: estado.tipo === "acerto" ? "" : estado.nf,
      observacao: obs,
      /* Salvar um lançamento que veio do preencher recorrentes é exatamente o
         ato de conferi-lo: ele deixa de ser "nova" e vira "sim". */
      recorrente: estado.recorrente === "nova" ? "sim" : estado.recorrente
    };
  }

  function limparFormulario() {
    $("#valor").value = ""; estado.valor = 0; estado.expr = "";
    $("#destinatario").value = ""; $("#descricao").value = ""; $("#obs").value = "";
    $("#destnovo").hidden = true;
    estado.recorrente = ""; estado.recorrenteEra = "";
    pintarRecorrente();
    estado.parcelado = false; estado.nparc = 2; $("#nparc").value = "2";
    pintarParcelado();
  }

  function salvar() {
    var d = dadosDoFormulario();
    var btn = $("#salvar");
    btn.disabled = true;

    // fornecedor novo entra no cadastro junto
    if (d.tipo !== "acerto" && d.destinatario && !fornecedorExiste(d.destinatario)) {
      var novo = { id: "FX" + Date.now().toString(36), nome: d.destinatario,
                   razao: "", doc: "", contato: "", pagamento: "", endereco: "", tipo: "" };
      D.fornecedores.push(novo);
      window.Dados.acrescentarLinhaEm("fornecedores",
        [novo.id, novo.nome, "", "", "", "", "", "cadastrado pelo aplicativo"]).catch(function () {});
    }

    if (emParcelas()) { salvarParcelado(d); return; }

    if (editandoId) {
      var alvo = acharT(editandoId);
      if (alvo) for (var k in d) if (d.hasOwnProperty(k)) alvo[k] = d[k];
      window.Dados.executar("update", alvo)
        .then(function (r) {
          if (alvo) alvo.naoEnviado = !!r.enfileirado;
          window.Dados.guardarCache(D);
          if (r.enfileirado) toast("Guardado aqui, ainda não entrou na planilha — " + (r.motivo || ""));
          else toastValor("Lançamento atualizado", (alvo && alvo.valor) || 0);
          sairDaEdicao();
          irPara("tx");
        });
      return;
    }

    d.id = window.Dados.novoId();
    d.origem = "app";
    D.transacoes.push(d);
    window.Dados.executar("add", d)
      .then(function (r) {
        // enquanto a planilha não confirmar, o lançamento fica marcado
        d.naoEnviado = !!r.enfileirado;
        window.Dados.guardarCache(D);
        if (r.enfileirado) {
          toast("Guardado aqui, ainda não entrou na planilha — " + (r.motivo || ""));
        } else if (!temValor(d)) {
          toast("Salvo aguardando valor", "fora do rateio");
        } else {
          toastValor("Lançado na planilha", d.valor);
        }
        limparFormulario();
        montarListasAuxiliares();
        recalcular();
        validar();
        $("#valor").focus();
      });
  }

  /* Uma compra parcelada vira uma linha por parcela, uma por mês a partir da
     data escolhida, todas sem valor. Os centavos que não dividem certo ficam
     na primeira parcela, como faz o cartão. */
  function salvarParcelado(d) {
    var n = estado.nparc;
    var total = Math.round(d.valor * 100);
    var base = Math.floor(total / n), resto = total - base * n;
    var obs = [d.observacao, "compra parcelada: total R$ " + brl(total / 100) + " em " + n + "x"]
      .filter(Boolean).join(" · ");
    var criados = [];
    for (var k = 1; k <= n; k++) {
      var p = {};
      for (var c in d) if (d.hasOwnProperty(c)) p[c] = d[c];
      var cent = base + (k === 1 ? resto : 0);
      p.id = window.Dados.novoId();
      p.origem = "app";
      p.data = somarMeses(d.data, k - 1);
      p.valor = null;
      p.recorrente = "";
      p.observacao = obs;
      p.descricao = d.descricao + " - Parcela " + k + "/" + n + " (R$" + brl(cent / 100) + ")";
      D.transacoes.push(p);
      criados.push(p);
    }

    var enfileirados = 0;
    criados.reduce(function (pr, p) {
      return pr.then(function () {
        return window.Dados.executar("add", p).then(function (r) {
          p.naoEnviado = !!r.enfileirado;
          if (r.enfileirado) enfileirados++;
        });
      });
    }, Promise.resolve()).then(function () {
      window.Dados.guardarCache(D);
      toast(n + " parcelas criadas, sem valor" +
            (enfileirados ? " · " + enfileirados + " esperando sinal" : ""),
            "R$ " + brl(total / 100));
      limparFormulario();
      montarListasAuxiliares();
      recalcular();
      validar();
      $("#valor").focus();
    });
  }

  function editar(id) {
    var t = acharT(id); if (!t) return;
    fecharSheet();
    editandoId = id;

    aplicarTipo(t.tipo);
    estado.data = t.data; $("#data").value = t.data;
    Array.prototype.forEach.call(document.querySelectorAll("[data-dia]"), function (c) { c.setAttribute("aria-pressed", "false"); });
    var p = (t.data || "").split("-");
    $("#datahint").textContent = (t.data === hoje() ? "hoje" : (p[2] ? p[2] + "/" + p[1] : ""));

    estado.valor = t.valor ? Math.round(t.valor * 100) : 0;
    estado.expr = "";
    $("#valor").value = t.valor ? brl(t.valor) : "";
    $("#destinatario").value = t.tipo === "acerto" ? "" : t.destinatario;
    $("#descricao").value = t.tipo === "acerto" ? "" : t.descricao;
    $("#obs").value = t.observacao || "";
    $("#destnovo").hidden = true;

    if (t.categoria) { estado.categoria = t.categoria; $("#categoria").value = t.categoria; }
    if (t.obra) estado.obra = t.obra;
    estado.pagante = t.pagante || estado.pagante;
    if (t.recebedor) estado.recebedor = t.recebedor;
    estado.nf = t.statusNf || "pendente";
    estado.adm = !!t.incideAdm;
    estado.recorrente = t.recorrente || "";
    estado.recorrenteEra = estado.recorrente;
    pintarRecorrente();
    montarChips();
    $("#adm").setAttribute("aria-pressed", String(estado.adm));
    $("#admhint").textContent = estado.adm ? "incide nesta despesa" : "não incide nesta despesa";
    Array.prototype.forEach.call(document.querySelectorAll("[data-nf]"), function (c) {
      c.setAttribute("aria-pressed", String(c.dataset.nf === estado.nf));
    });

    $("#edbanner").hidden = false;
    $("#edquem").textContent = t.tipo === "acerto"
      ? socioNome(t.pagante) + " → " + socioNome(t.recebedor)
      : (t.destinatario + " · " + t.descricao);
    irPara("lancar");
    validar();
    $("#v-lancar").scrollTop = 0;
  }

  function sairDaEdicao() {
    editandoId = null;
    $("#edbanner").hidden = true;
    limparFormulario();
    recalcular();
    validar();
  }

  /* ============================ TRANSAÇÕES ============================ */

  function opcoes(sel, itens, atual) {
    sel.innerHTML = "";
    itens.forEach(function (it) {
      var o = document.createElement("option");
      o.value = it[0]; o.textContent = it[1];
      sel.appendChild(o);
    });
    sel.value = atual;
  }

  function montarFiltros() {
    var cont = $("#filtroObra");
    cont.innerHTML = "";
    // "Acertos" não é uma obra: acerto entre sócios não pertence a obra nenhuma,
    // e sem esta opção só dava para achá-los dentro de "Todas".
    [{ id: "todas", curto: "Todas" }]
      .concat(D.obras)
      .concat([{ id: "acertos", curto: "Acertos" }])
      .forEach(function (o) {
      var b = el("button", "chip", o.curto);
      b.type = "button";
      b.setAttribute("aria-pressed", String(filtros.obra === o.id));
      b.addEventListener("click", function () { filtros.obra = o.id; montarFiltros(); renderTx(); });
      cont.appendChild(b);
    });

    var meses = {};
    D.transacoes.forEach(function (t) { if (t.data) meses[t.data.slice(0, 7)] = 1; });
    opcoes($("#f-mes"), [["todos", "Todos os meses"]].concat(
      Object.keys(meses).sort().reverse().map(function (m) { return [m, mesLabel(m)]; })
    ), filtros.mes);

    opcoes($("#f-pag"), [["todos", "Todos"]].concat(
      D.socios.map(function (s) { return [s.id, s.nome]; })
    ), filtros.pagante);

    var dests = {};
    D.transacoes.forEach(function (t) { if (t.destinatario) dests[t.destinatario] = 1; });
    opcoes($("#f-dest"), [["todos", "Todos"]].concat(
      Object.keys(dests).sort(function (a, b) { return a.localeCompare(b, "pt-BR"); })
        .map(function (d) { return [d, d]; })
    ), filtros.dest);

    var cats = {};
    D.transacoes.forEach(function (t) { if (t.categoria) cats[t.categoria] = 1; });
    opcoes($("#f-cat"), [["todas", "Todas"]].concat(
      Object.keys(cats).sort().map(function (c) { return [c, c]; })
    ), filtros.cat);

    opcoes($("#f-nfsel"), [["todos", "Todas"], ["pendente", "Falta a nota"],
                           ["recebida", "Já tenho"], ["nao_aplica", "Não vai ter"],
                           ["nao_informado", "Não informado"]], filtros.nf);

    var qSem = D.transacoes.filter(function (t) { return t.tipo !== "acerto" && !temValor(t); }).length;
    var qConferir = contarAConferir();
    var qParc = D.transacoes.filter(parcelaPendente).length;
    opcoes($("#f-sit"), [["todas", "Todos"],
                         ["sem", "Sem valor (" + qSem + ")"],
                         ["com", "Com valor"],
                         ["conferir", "Conferir valor (" + qConferir + ")"],
                         ["parcelas", "Parcelas a lançar (" + qParc + ")"]], filtros.sit);

    var n = 0;
    if (filtros.mes !== "todos") n++;
    if (filtros.pagante !== "todos") n++;
    if (filtros.dest !== "todos") n++;
    if (filtros.cat !== "todas") n++;
    if (filtros.nf !== "todos") n++;
    if (filtros.sit !== "todas") n++;
    var c = $("#fcnt");
    c.hidden = n === 0; c.textContent = String(n);
  }

  function filtrar() {
    var q = filtros.busca.trim().toLowerCase();
    return D.transacoes.filter(function (t) {
      var sem = t.tipo !== "acerto" && !temValor(t);
      if (filtros.obra === "acertos") {
        if (t.tipo !== "acerto") return false;
      } else if (filtros.obra !== "todas" && t.obra !== filtros.obra) {
        return false;
      }
      if (filtros.mes !== "todos" && String(t.data).slice(0, 7) !== filtros.mes) return false;
      if (filtros.pagante !== "todos" && t.pagante !== filtros.pagante) return false;
      if (filtros.dest !== "todos" && t.destinatario !== filtros.dest) return false;
      if (filtros.cat !== "todas" && t.categoria !== filtros.cat) return false;
      if (filtros.nf !== "todos" && t.statusNf !== filtros.nf) return false;
      if (filtros.sit === "sem" && !sem) return false;
      if (filtros.sit === "com" && sem) return false;
      if (filtros.sit === "conferir" && t.recorrente !== "nova") return false;
      if (filtros.sit === "parcelas" && !parcelaPendente(t)) return false;
      if (q) {
        var alvo = (t.destinatario + " " + t.descricao + " " + (t.observacao || "")).toLowerCase();
        if (alvo.indexOf(q) === -1) return false;
      }
      return true;
    }).sort(function (a, b) {
      if (a.data === b.data) return 0;
      return a.data < b.data ? 1 : -1;
    });
  }

  function etiqueta(txt, cls) { return el("span", "tag " + (cls || ""), txt); }

  function renderTx() {
    var lista = filtrar();
    var soma = window.Calculo.somaDeCaixa(lista);
    var semValor = lista.filter(function (t) { return t.tipo !== "acerto" && !temValor(t); }).length;

    var r = $("#resumo");
    r.innerHTML = "";
    var esq = el("span", null, lista.length + (lista.length === 1 ? " lançamento" : " lançamentos"));
    if (semValor) {
      var av = el("b", null, "  ·  " + semValor + " sem valor");
      av.style.color = "var(--crit)";
      esq.appendChild(av);
    }
    r.appendChild(esq);
    var s = el("span", null, "soma  ");
    s.appendChild(el("b", null, "R$ " + brl(soma)));
    r.appendChild(s);

    var cont = $("#txlist");
    cont.innerHTML = "";
    if (!lista.length) {
      var v = el("div", "pad");
      v.style.color = "var(--ink-3)";
      v.textContent = "Nenhum lançamento com esses filtros.";
      cont.appendChild(v);
      return;
    }

    var dia = "";
    lista.slice(0, 400).forEach(function (t) {
      if (t.data !== dia) { dia = t.data; cont.appendChild(el("div", "txday", diaLabel(t.data))); }
      var sem = t.tipo !== "acerto" && !temValor(t);
      var row = el("button", "txrow");
      row.type = "button";
      row.appendChild(el("div", "who", t.tipo === "acerto"
        ? socioNome(t.pagante) + " → " + socioNome(t.recebedor)
        : t.destinatario));
      row.appendChild(sem
        ? el("div", "val sem", "a definir")
        : el("div", "val" + (t.tipo === "receita" ? " in" : ""),
             (t.tipo === "receita" ? "+" : "") + brl(t.valor)));
      row.appendChild(el("div", "meta", [t.descricao,
        t.obra ? obraCurto(t.obra) : "entre sócios",
        socioNome(t.pagante)].filter(Boolean).join(" · ")));
      var tags = el("div", "tags");
      if (t.naoEnviado) tags.appendChild(etiqueta("não enviado", "sem"));
      if (t.recorrente === "nova") tags.appendChild(etiqueta("conferir valor", "sem"));
      else if (t.recorrente === "sim") tags.appendChild(etiqueta("recorrente", "adm"));
      var pc = parcelaDe(t);
      if (pc) tags.appendChild(etiqueta("parcela " + pc.n + "/" + pc.de, sem ? "sem" : "adm"));
      if (sem) tags.appendChild(etiqueta(pc ? "a lançar no mês" : "sem valor", "sem"));
      if (t.statusNf === "pendente" && !sem) tags.appendChild(etiqueta("falta NF", "nf"));
      if (t.statusNf === "recebida") tags.appendChild(etiqueta("NF ok", "ok"));
      if (t.incideAdm && !sem) tags.appendChild(etiqueta("ADM", "adm"));
      row.appendChild(tags);
      row.addEventListener("click", function () { abrirDetalhe(t.id); });
      cont.appendChild(row);
    });

    if (lista.length > 400) {
      var m = el("div", "pad");
      m.style.color = "var(--ink-3)";
      m.textContent = "Mostrando os 400 mais recentes. Use os filtros para chegar nos outros.";
      cont.appendChild(m);
    }
  }

  /* ============================== DETALHE ============================== */

  function abrirDetalhe(id) {
    var t = acharT(id); if (!t) return;
    abertoId = id;
    var sem = t.tipo !== "acerto" && !temValor(t);
    var s = $("#sheet");
    s.innerHTML = "";
    s.appendChild(el("div", "grab"));

    var top = el("div", "sh-top");
    top.appendChild(el("h3", null, t.tipo === "acerto"
      ? socioNome(t.pagante) + " → " + socioNome(t.recebedor) : t.destinatario));
    s.appendChild(top);
    s.appendChild(el("p", "sh-sub", (t.descricao || "") + " · " + diaLabel(t.data)));

    if (sem) {
      s.appendChild(el("div", "aviso",
        "Este lançamento está sem valor: não entra no custo da obra nem no rateio entre os sócios. " +
        "Preencha o valor abaixo quando pagar."));
    }

    var ed = el("div", "edit2");
    var cv = el("div", "ecell");
    cv.appendChild(el("span", "fl", t.tipo === "receita" ? "Valor recebido" : "Valor pago"));
    var iv = document.createElement("input");
    iv.className = "inp"; iv.inputMode = "decimal";
    iv.value = temValor(t) ? brl(t.valor) : "";
    iv.placeholder = "0,00";
    cv.appendChild(iv); ed.appendChild(cv);

    var cd = el("div", "ecell");
    cd.appendChild(el("span", "fl", "Data"));
    var idata = document.createElement("input");
    idata.className = "inp"; idata.type = "date"; idata.value = t.data;
    cd.appendChild(idata); ed.appendChild(cd);
    s.appendChild(ed);

    var aplicar = el("button", "btn-aplicar", "Salvar alteração");
    aplicar.type = "button"; aplicar.disabled = true;
    function mudou() {
      var r = lerValor(iv.value);
      var novoValor = r.cent > 0 ? r.cent / 100 : null;
      aplicar.disabled = (novoValor === t.valor && idata.value === t.data);
      aplicar.textContent = (sem && r.cent > 0) ? "Lançar valor e entrar no rateio" : "Salvar alteração";
    }
    iv.addEventListener("input", mudou);
    idata.addEventListener("change", mudou);
    aplicar.addEventListener("click", function () {
      var r = lerValor(iv.value);
      t.valor = r.cent > 0 ? r.cent / 100 : null;
      t.data = idata.value || t.data;
      if (r.expr) t.observacao = [t.observacao, "conta: " + r.expr].filter(Boolean).join(" · ");
      aplicar.disabled = true;
      gravarAlteracao(t, sem && temValor(t) ? "Valor lançado, entrou no rateio" : "Lançamento atualizado");
    });
    s.appendChild(aplicar);

    var dl = el("dl", "sh-grid");
    dl.style.marginTop = "16px";
    function par(k, v) { dl.appendChild(el("dt", null, k)); dl.appendChild(el("dd", null, v)); }
    if (t.obra) par("Obra", obraNome(t.obra));
    if (t.categoria) par("Categoria", t.categoria);
    par(t.tipo === "acerto" ? "Depositou" : "Pagou", socioNome(t.pagante));
    if (t.observacao) par("Observação", t.observacao);
    if (t.origem && t.origem !== "app") par("Linha na planilha antiga", t.origem);
    s.appendChild(dl);

    if (t.tipo !== "acerto") {
      var lb = el("div", "lbl"); lb.appendChild(el("span", null, "Nota fiscal"));
      s.appendChild(lb);
      var chips = el("div", "gchips");
      chips.style.marginTop = "7px";
      [["pendente", "Falta a nota"], ["recebida", "Já tenho"], ["nao_aplica", "Não vai ter"]]
        .forEach(function (op) {
          var b = el("button", "chip", op[1]);
          b.type = "button";
          b.setAttribute("aria-pressed", String(t.statusNf === op[0]));
          b.addEventListener("click", function () {
            t.statusNf = op[0];
            Array.prototype.forEach.call(chips.children, function (c) { c.setAttribute("aria-pressed", "false"); });
            b.setAttribute("aria-pressed", "true");
            gravarAlteracao(t, "Nota fiscal atualizada", true);
          });
          chips.appendChild(b);
        });
      s.appendChild(chips);

      if (t.tipo === "despesa") {
        var tg = el("div", "toggle");
        tg.style.marginTop = "14px";
        var txt = el("div", "t-txt");
        txt.appendChild(el("b", null, "Incide taxa de ADM"));
        txt.appendChild(el("span", null, "muda a base da taxa e o balanço dos sócios"));
        var sw = el("button", "sw");
        sw.type = "button";
        sw.setAttribute("aria-pressed", String(!!t.incideAdm));
        sw.addEventListener("click", function () {
          t.incideAdm = !t.incideAdm;
          sw.setAttribute("aria-pressed", String(t.incideAdm));
          gravarAlteracao(t, "Incidência de ADM atualizada", true);
        });
        tg.appendChild(txt); tg.appendChild(sw);
        s.appendChild(tg);
      }
    }

    var acoes = el("div", "sh-acoes");
    var bEditar = el("button", "btn-sec", "Editar tudo");
    bEditar.type = "button";
    bEditar.addEventListener("click", function () { editar(t.id); });
    var bFechar = el("button", "btn-sec", "Fechar");
    bFechar.type = "button";
    bFechar.addEventListener("click", fecharSheet);
    acoes.appendChild(bEditar); acoes.appendChild(bFechar);
    s.appendChild(acoes);

    var excluir = el("button", "btn-sec btn-del btn-full", "Excluir lançamento");
    excluir.type = "button";
    var armado = false;
    excluir.addEventListener("click", function () {
      if (!armado) {
        armado = true;
        excluir.textContent = "Tocar de novo para excluir de vez";
        excluir.classList.add("armado");
        setTimeout(function () {
          if (!armado) return;
          armado = false;
          excluir.textContent = "Excluir lançamento";
          excluir.classList.remove("armado");
        }, 4000);
        return;
      }
      excluir.disabled = true;
      window.Dados.executar("delete", t.id)
        .then(function (r) {
          D.transacoes = D.transacoes.filter(function (x) { return x.id !== t.id; });
          window.Dados.guardarCache(D);
          fecharSheet();
          recalcular();
          toast(r.enfileirado
            ? "Exclusão guardada, ainda não aplicada na planilha — " + (r.motivo || "")
            : "Lançamento excluído", t.destinatario);
        });
    });
    s.appendChild(excluir);

    s.classList.add("on");
    $("#scrim").classList.add("on");
  }

  function gravarAlteracao(t, msg, manterAberto) {
    window.Dados.executar("update", t)
      .then(function (r) {
        t.naoEnviado = !!r.enfileirado;
        window.Dados.guardarCache(D);
        recalcular();
        if (!manterAberto) fecharSheet();
        toast(r.enfileirado
          ? "Guardado aqui, ainda não entrou na planilha — " + (r.motivo || "")
          : msg);
      });
  }

  function fecharSheet() {
    abertoId = null;
    $("#sheet").classList.remove("on");
    $("#scrim").classList.remove("on");
  }

  /* =============================== PAINEL =============================== */

  function renderPainel() {
    if (!apuracao) return;

    /* Um recorrente preenchido entra no rateio com o valor do mês passado.
       Enquanto houver algum sem conferir, o painel avisa — esquecer disso é
       fechar o mês com número estimado. */
    var aConferir = contarAConferir();
    var aviso = $("#rec-aviso");
    aviso.hidden = !aConferir;
    if (aConferir) {
      aviso.textContent = aConferir === 1
        ? "1 recorrente preenchido ainda está com o valor do mês anterior. Confira antes de fechar."
        : aConferir + " recorrentes preenchidos ainda estão com o valor do mês anterior. Confira antes de fechar.";
    }

    /* Parcela cujo mês já chegou e ainda está sem valor é custo que ficou
       fora do rateio — o mesmo tipo de esquecimento que o aviso acima pega. */
    var ymHoje = hoje().slice(0, 7);
    var atrasadas = D.transacoes.filter(function (t) {
      return parcelaPendente(t) && String(t.data).slice(0, 7) <= ymHoje;
    }).length;
    var pa = $("#parc-aviso");
    pa.hidden = !atrasadas;
    if (atrasadas) {
      pa.textContent = (atrasadas === 1 ? "1 parcela" : atrasadas + " parcelas") + " até " +
        mesLabel(ymHoje) + " ainda sem valor, fora do rateio. Use “Lançar parcelas do mês”.";
    }

    function somaMes(ym) {
      return window.Calculo.somaDeCaixa(D.transacoes.filter(function (t) {
        return String(t.data).slice(0, 7) === ym;
      }));
    }
    var d = new Date();
    var mesAtual = hoje().slice(0, 7);
    var ant = new Date(d.getFullYear(), d.getMonth() - 1, 1);
    var mesAnt = ant.getFullYear() + "-" + ("0" + (ant.getMonth() + 1)).slice(-2);
    var vMes = somaMes(mesAtual), vAnt = somaMes(mesAnt);

    $("#k-custo").textContent = brl(apuracao.custoTotal);
    $("#k-mes").textContent = brl(vMes);
    $("#k-ant").textContent = brl(vAnt);
    $("#k-mes-l").textContent = mesLabel(mesAtual);
    $("#k-ant-l").textContent = mesLabel(mesAnt);
    var vr = $("#k-var");
    if (vAnt > 0) {
      var pct = (vMes - vAnt) / vAnt * 100;
      vr.textContent = (pct >= 0 ? "Gastando " + pct.toFixed(0) + "% a mais que em "
                                 : "Gastando " + Math.abs(pct).toFixed(0) + "% a menos que em ") + mesLabel(mesAnt) + ".";
    } else { vr.textContent = ""; }

    var maior = 0;
    D.obras.forEach(function (o) { maior = Math.max(maior, Math.abs(apuracao.custoPorObra[o.id] || 0)); });
    var bars = $("#barras");
    bars.innerHTML = "";
    D.obras.forEach(function (o) {
      var v = apuracao.custoPorObra[o.id] || 0;
      var linha = el("div", "bar");
      var bl = el("div", "bl");
      bl.appendChild(el("b", null, o.nome));
      bl.appendChild(el("span", null, (v < 0 ? "−" : "") + brl(Math.abs(v))));
      var tr = el("div", "track");
      var fi = el("div", "fill" + (v < 0 ? " neg" : ""));
      fi.style.width = (maior ? Math.max(2, Math.abs(v) / maior * 100) : 0) + "%";
      tr.appendChild(fi);
      linha.appendChild(bl); linha.appendChild(tr);
      bars.appendChild(linha);
    });

    var bal = $("#balanco");
    bal.innerHTML = "";
    apuracao.saldos.forEach(function (s) {
      var row = el("div", "balrow");
      row.appendChild(el("div", "n", s.nome));
      var v = el("div", "s " + (s.saldo > 0 ? "deve" : "recebe"), brl(Math.abs(s.saldo)));
      v.appendChild(el("small", null, s.saldo > 0 ? "a depositar" : "a receber"));
      row.appendChild(v);
      bal.appendChild(row);
    });
    $("#balhint").textContent = "Taxa de ADM de R$ " + brl(apuracao.admTotal) +
      " já aplicada, sobre base de R$ " + brl(apuracao.baseAdmTotal) + ". A soma dos saldos fecha em zero.";

    var acertos = window.Calculo.acertosSugeridos(apuracao.saldos);
    var ac = $("#acertos");
    ac.innerHTML = "";
    if (!acertos.length) {
      ac.appendChild(el("div", "acerto-vazio", "Ninguém deve nada a ninguém neste momento."));
    } else {
      acertos.forEach(function (a) {
        var linha = el("div", "acerto-linha");
        linha.appendChild(el("span", null, a.de + " deposita para " + a.para));
        linha.appendChild(el("b", null, "R$ " + brl(a.valor)));
        ac.appendChild(linha);
      });
    }
  }

  /* ============================= CADASTROS ============================= */

  function renderCadastros() {
    var usos = {};
    D.transacoes.forEach(function (t) { if (t.destinatario) usos[t.destinatario] = (usos[t.destinatario] || 0) + 1; });

    var lf = $("#lista-forn"); lf.innerHTML = "";
    D.fornecedores.slice().sort(function (a, b) { return a.nome.localeCompare(b.nome, "pt-BR"); })
      .forEach(function (f) {
        var it = el("div", "caditem");
        it.appendChild(el("span", null, f.nome));
        it.appendChild(el("span", "tag", usos[f.nome] ? usos[f.nome] + "x" : "novo"));
        lf.appendChild(it);
      });
    $("#n-forn").textContent = D.fornecedores.length;

    var lc = $("#lista-cat"); lc.innerHTML = "";
    D.categorias.forEach(function (c) {
      var it = el("div", "caditem");
      it.appendChild(el("span", null, c.nome));
      it.appendChild(el("span", "tag" + (c.admPadrao ? " adm" : ""), c.admPadrao ? "ADM" : "sem ADM"));
      lc.appendChild(it);
    });
    $("#n-cat").textContent = D.categorias.length;

    var lo = $("#lista-obra"); lo.innerHTML = "";
    D.obras.forEach(function (o) {
      var it = el("button", "caditem");
      it.type = "button";
      it.appendChild(el("span", null, o.nome));
      var dir = el("span");
      dir.style.display = "flex"; dir.style.alignItems = "center"; dir.style.gap = "8px";
      dir.appendChild(el("span", "tag", "ADM " + pct(o.taxaAdm) + "%"));
      dir.appendChild(el("span", "seta", "›"));
      it.appendChild(dir);
      it.addEventListener("click", function () { abrirObra(o.id); });
      lo.appendChild(it);
    });
    $("#n-obra").textContent = D.obras.length;

    var ls = $("#lista-soc"); ls.innerHTML = "";
    D.socios.forEach(function (s) {
      var it = el("div", "caditem");
      it.appendChild(el("span", null, s.nome));
      var papeis = {};
      D.obras.forEach(function (o) {
        var c = o.socios && o.socios[s.id];
        if (c && c.papel !== "fora") papeis[c.papel] = 1;
      });
      var lista = Object.keys(papeis);
      it.appendChild(el("span", "tag", lista.length ? lista.join(" / ") : "sem obra"));
      ls.appendChild(it);
    });
    $("#n-soc").textContent = D.socios.length;

    $("#info-lido").textContent = D.lidoEm
      ? "Planilha lida em " + new Date(D.lidoEm).toLocaleString("pt-BR")
      : "Ainda não li a planilha neste aparelho.";
    var f = window.Dados.fila();
    $("#info-fila").textContent = f.length
      ? f.length + (f.length === 1 ? " lançamento esperando o sinal voltar" : " lançamentos esperando o sinal voltar")
      : "Nada pendente para subir.";
  }

  function pct(n) {
    return Number(n).toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 4 });
  }

  function abrirObra(id) {
    var o = obra(id); if (!o) return;
    if (!o.socios) o.socios = {};
    abertoId = "obra:" + id;

    var s = $("#sheet");
    s.innerHTML = "";
    s.appendChild(el("div", "grab"));
    var top = el("div", "sh-top");
    top.appendChild(el("h3", null, o.nome));
    s.appendChild(top);
    s.appendChild(el("p", "sh-sub",
      "Quem entra nesta obra, com quanto, e como a taxa de ADM se reparte. Atuador toca a obra e " +
      "recebe a ADM; investidor entra com capital e paga a ADM; não participa fica de fora do rateio."));

    var fn = el("div", "field");
    var lbn = el("div", "lbl");
    lbn.appendChild(el("span", null, "Nome da obra"));
    lbn.appendChild(el("em", null, "muda só o nome, os lançamentos ficam"));
    fn.appendChild(lbn);
    var inome = document.createElement("input");
    inome.className = "inp"; inome.value = o.nome;
    inome.addEventListener("change", function () {
      var v = inome.value.trim();
      if (!v) { inome.value = o.nome; return; }
      o.nome = v;
      o.curto = v.split(" - ").pop();      // "Casa 2 - Cedro" -> "Cedro"
      persistirObra(o);
      top.querySelector("h3").textContent = o.nome;
      montarChips();
      $("#brandctx").textContent = obraCurto(estado.obra);
    });
    fn.appendChild(inome);
    s.appendChild(fn);

    var ft = el("div", "field");
    ft.style.marginTop = "12px";
    var lb = el("div", "lbl");
    lb.appendChild(el("span", null, "Taxa de ADM da obra"));
    lb.appendChild(el("em", null, "% sobre as despesas com incidência"));
    ft.appendChild(lb);
    var it = document.createElement("input");
    it.className = "inp"; it.value = pct(o.taxaAdm); it.inputMode = "decimal";
    it.addEventListener("change", function () {
      var v = parseFloat(it.value.replace(",", "."));
      if (!isNaN(v) && v >= 0) { o.taxaAdm = v; persistirObra(o); }
      it.value = pct(o.taxaAdm);
    });
    ft.appendChild(it);
    s.appendChild(ft);
    var esp = el("div"); esp.style.height = "12px"; s.appendChild(esp);

    var head = el("div", "cfg");
    ["Sócio", "Part. %", "Papel", "ADM %"].forEach(function (h) { head.appendChild(el("div", "ch", h)); });
    s.appendChild(head);

    var somas = el("div", "somas");
    function atualizarSomas() {
      var sp = 0, sa = 0;
      D.socios.forEach(function (so) {
        var c = o.socios[so.id];
        if (!c || c.papel === "fora") return;
        sp += Number(c.participacao) || 0;
        if (c.papel === "atuador") sa += Number(c.admShare) || 0;
      });
      somas.innerHTML = "";
      somas.appendChild(el("span", Math.abs(sp - 100) < 0.01 ? "ok" : "bad", "Participação: " + pct(sp) + "%"));
      somas.appendChild(el("span", Math.abs(sa - 100) < 0.01 ? "ok" : "bad", "Repartição da ADM: " + pct(sa) + "%"));
    }

    D.socios.forEach(function (so) {
      if (!o.socios[so.id]) o.socios[so.id] = { participacao: 0, papel: "fora", admShare: 0 };
      var c = o.socios[so.id];
      var row = el("div", "cfg");
      row.appendChild(el("div", "nm", so.nome));

      var ip = document.createElement("input");
      ip.inputMode = "decimal"; ip.value = pct(c.participacao);
      ip.addEventListener("change", function () {
        var v = parseFloat(ip.value.replace(",", "."));
        c.participacao = isNaN(v) ? 0 : v;
        ip.value = pct(c.participacao);
        atualizarSomas(); persistirSocios(o);
      });
      row.appendChild(ip);

      var sp = document.createElement("select");
      [["atuador", "Atuador"], ["investidor", "Investidor"], ["fora", "Não participa"]].forEach(function (op) {
        var e2 = document.createElement("option");
        e2.value = op[0]; e2.textContent = op[1];
        sp.appendChild(e2);
      });
      sp.value = c.papel;
      row.appendChild(sp);

      var ia = document.createElement("input");
      ia.inputMode = "decimal"; ia.value = pct(c.admShare);
      ia.disabled = c.papel !== "atuador";
      ia.addEventListener("change", function () {
        var v = parseFloat(ia.value.replace(",", "."));
        c.admShare = isNaN(v) ? 0 : v;
        ia.value = pct(c.admShare);
        atualizarSomas(); persistirSocios(o);
      });
      row.appendChild(ia);

      sp.addEventListener("change", function () {
        c.papel = sp.value;
        if (c.papel !== "atuador") { c.admShare = 0; ia.value = "0"; }
        ia.disabled = c.papel !== "atuador";
        atualizarSomas(); persistirSocios(o);
      });

      s.appendChild(row);
    });

    atualizarSomas();
    s.appendChild(somas);

    var acoes = el("div", "sh-acoes");
    var fechar = el("button", "btn-sec", "Fechar");
    fechar.type = "button";
    fechar.addEventListener("click", fecharSheet);
    acoes.appendChild(fechar);
    s.appendChild(acoes);

    s.classList.add("on");
    $("#scrim").classList.add("on");
  }

  /* Nome, apelido e taxa moram na aba `obras`. */
  function persistirObra(o) {
    window.Dados.guardarCache(D);
    recalcular();
    window.Dados.salvarObra(o).catch(function (e) {
      toast("Não consegui gravar a obra na planilha: " + (e.message || ""));
    });
  }

  /* Participação, papel e fatia da ADM moram na aba `obra_socios`. */
  function persistirSocios(o) {
    window.Dados.guardarCache(D);
    recalcular();
    window.Dados.salvarObraSocios(o.id, o.socios).catch(function (e) {
      toast("Não consegui gravar a configuração na planilha: " + (e.message || ""));
    });
  }

  /* ============================== RELATÓRIO ============================== */

  /* Antes de gerar, pergunta o que entra: quais meses e quais obras.
     Os meses saem dos próprios lançamentos, então a lista nunca mostra um mês
     vazio. O balanço entre sócios e o custo por obra continuam acumulados
     desde o começo — é o saldo de hoje, recortá-lo não faria sentido. */
  /* ====================== PREENCHER RECORRENTES ======================
     Algumas contas voltam todo mês — condomínio, internet, luz, seguro —
     às vezes no mesmo valor, às vezes não. Em vez de digitar tudo de novo na
     virada, o lançamento é marcado como recorrente uma vez e o programa copia
     o mais recente de cada um para o mês escolhido, já com o último valor como
     ponto de partida e com a marca "conferir valor". */

  /* Duas linhas são o mesmo gasto recorrente quando combinam nisto. A data e o
     valor ficam de fora de propósito: é justamente o que muda de mês para mês. */
  function assinaturaRec(t) {
    return [t.tipo, t.obra || "", t.pagante || "", t.recebedor || "",
            (t.destinatario || "").toLowerCase(),
            (t.descricao || "").toLowerCase(),
            (t.categoria || "").toLowerCase()].join("|");
  }

  function ultimoDiaDoMes(ano, mes) { return new Date(ano, mes, 0).getDate(); }

  /* Devolve o que seria criado, sem criar nada — é o que a tela mostra antes
     de você confirmar. */
  function planoDeRecorrentes(ym) {
    var primeiroDoMes = ym + "-01";
    var jaNoMes = {};
    D.transacoes.forEach(function (t) {
      if (String(t.data).slice(0, 7) === ym) jaNoMes[assinaturaRec(t)] = true;
    });

    var modelos = {};
    D.transacoes.forEach(function (t) {
      if (t.recorrente !== "sim" && t.recorrente !== "nova") return;
      if (String(t.data) >= primeiroDoMes) return;      // só olha para trás
      var a = assinaturaRec(t);
      if (!modelos[a] || String(t.data) > String(modelos[a].data)) modelos[a] = t;
    });

    var novos = [], repetidos = 0;
    var p = ym.split("-");
    var ultimo = ultimoDiaDoMes(Number(p[0]), Number(p[1]));
    for (var a in modelos) {
      if (!modelos.hasOwnProperty(a)) continue;
      if (jaNoMes[a]) { repetidos++; continue; }
      var m = modelos[a];
      var dia = Number(String(m.data).split("-")[2]) || 1;
      if (dia > ultimo) dia = ultimo;                   // 31 em mês de 30 vira 30
      novos.push({
        data: ym + "-" + ("0" + dia).slice(-2),
        tipo: m.tipo, obra: m.obra, pagante: m.pagante, recebedor: m.recebedor,
        destinatario: m.destinatario, descricao: m.descricao, categoria: m.categoria,
        valor: m.valor, incideAdm: m.incideAdm,
        statusNf: m.tipo === "acerto" ? "" : "pendente",
        /* a observação não é copiada: ela costuma falar do mês de origem */
        observacao: "", recorrente: "nova",
        _de: m.data
      });
    }
    novos.sort(function (x, y) { return x.data < y.data ? -1 : 1; });
    return { novos: novos, repetidos: repetidos, modelos: Object.keys(modelos).length };
  }

  function contarAConferir() {
    return D.transacoes.filter(function (t) { return t.recorrente === "nova"; }).length;
  }

  function abrirPreencherRecorrentes() {
    abertoId = "recorrentes";
    var hj = new Date();
    var ym = hj.getFullYear() + "-" + ("0" + (hj.getMonth() + 1)).slice(-2);

    var s = $("#sheet");
    s.innerHTML = "";
    s.appendChild(el("div", "grab"));
    var top = el("div", "sh-top");
    top.appendChild(el("h3", null, "Preencher recorrentes"));
    s.appendChild(top);
    s.appendChild(el("p", "sh-sub",
      "Copia para o mês escolhido cada lançamento marcado como recorrente, com o " +
      "último valor conhecido. Eles entram marcados como “conferir valor” para você " +
      "ajustar um a um. O que já existir no mês não é duplicado."));

    var lb = el("div", "lbl");
    lb.appendChild(el("span", null, "Mês"));
    s.appendChild(lb);

    var cell = el("div", "ecell");
    cell.style.marginTop = "7px";
    var iMes = document.createElement("input");
    iMes.className = "inp"; iMes.type = "month"; iMes.value = ym;
    cell.appendChild(iMes);
    s.appendChild(cell);

    var resumo = el("div", "hintline");
    resumo.style.cssText = "text-align:left;margin-top:12px";
    s.appendChild(resumo);

    var lista = el("div", "acertos");
    lista.style.marginTop = "8px";
    s.appendChild(lista);

    var aplicar = el("button", "btn-aplicar", "Preencher");
    aplicar.type = "button";
    aplicar.style.marginTop = "14px";
    s.appendChild(aplicar);

    var acoes = el("div", "sh-acoes");
    var fechar = el("button", "btn-sec", "Cancelar");
    fechar.type = "button";
    fechar.addEventListener("click", fecharSheet);
    acoes.appendChild(fechar);
    s.appendChild(acoes);

    var plano = null;
    function prever() {
      lista.innerHTML = "";
      if (!iMes.value) { resumo.textContent = "Escolha o mês."; aplicar.disabled = true; return; }
      plano = planoDeRecorrentes(iMes.value);
      if (!plano.modelos) {
        resumo.textContent = "Nenhum lançamento está marcado como recorrente ainda. " +
                             "Marque na tela de lançar, na chave “Se repete todo mês”.";
        aplicar.disabled = true;
        return;
      }
      if (!plano.novos.length) {
        resumo.textContent = "Os " + plano.modelos + " recorrentes já estão em " +
                             mesLabel(iMes.value) + ". Nada a fazer.";
        aplicar.disabled = true;
        return;
      }
      resumo.textContent = plano.novos.length +
        (plano.novos.length === 1 ? " lançamento entra" : " lançamentos entram") +
        " em " + mesLabel(iMes.value) +
        (plano.repetidos ? " · " + plano.repetidos + " já estava lá" : "");
      aplicar.disabled = false;
      plano.novos.forEach(function (n) {
        var li = el("div", "acerto-item");
        li.appendChild(el("span", null,
          (n.tipo === "acerto" ? socioNome(n.pagante) + " → " + socioNome(n.recebedor)
                               : n.destinatario) +
          " · " + (n.obra ? obraCurto(n.obra) : "entre sócios")));
        li.appendChild(el("b", null, temValor(n) ? brl(n.valor) : "sem valor"));
        lista.appendChild(li);
      });
    }
    iMes.addEventListener("change", prever);
    iMes.addEventListener("input", prever);

    aplicar.addEventListener("click", function () {
      if (!plano || !plano.novos.length) return;
      aplicar.disabled = true;
      var alvo = iMes.value;
      var criados = plano.novos.map(function (n) {
        var d = {};
        for (var k in n) if (n.hasOwnProperty(k) && k !== "_de") d[k] = n[k];
        d.id = window.Dados.novoId();
        d.origem = "recorrente";
        D.transacoes.push(d);
        return d;
      });
      fecharSheet();

      /* Um a um, para que cada linha tenha sua própria confirmação da planilha
         — e para que uma que falhe vá para a fila sem derrubar as outras. */
      var enfileirados = 0;
      var fila = criados.reduce(function (p, d) {
        return p.then(function () {
          return window.Dados.executar("add", d).then(function (r) {
            d.naoEnviado = !!r.enfileirado;
            if (r.enfileirado) enfileirados++;
          });
        });
      }, Promise.resolve());

      fila.then(function () {
        window.Dados.guardarCache(D);
        recalcular();
        /* cai direto na lista do que precisa ser conferido, que é o passo
           seguinte do trabalho */
        filtros.mes = alvo;
        filtros.sit = "conferir";
        irPara("tx");
        toast(criados.length + (criados.length === 1 ? " recorrente lançado" : " recorrentes lançados") +
              " em " + mesLabel(alvo) +
              (enfileirados ? " · " + enfileirados + " esperando sinal" : "") +
              " — confira os valores");
      });
    });

    prever();
    s.classList.add("on");
    $("#scrim").classList.add("on");
  }

  /* ====================== LANÇAR PARCELAS DO MÊS ======================
     As parcelas de uma compra parcelada nascem sem valor. No mês de cada uma,
     este botão copia o valor que está escrito na descrição para a coluna de
     valor — é aí que ela entra no custo da obra e no rateio. Rodar duas vezes
     no mesmo mês não faz nada: só pega as que ainda estão sem valor. */
  function abrirLancarParcelas() {
    abertoId = "parcelas";
    var ymHoje = hoje().slice(0, 7);

    var s = $("#sheet");
    s.innerHTML = "";
    s.appendChild(el("div", "grab"));
    var top = el("div", "sh-top");
    top.appendChild(el("h3", null, "Lançar parcelas do mês"));
    s.appendChild(top);
    s.appendChild(el("p", "sh-sub",
      "Coloca o valor nas parcelas do mês escolhido que ainda estão sem valor. " +
      "A partir daí elas entram no custo da obra e no rateio entre os sócios."));

    var lb = el("div", "lbl");
    lb.appendChild(el("span", null, "Mês"));
    s.appendChild(lb);

    var cell = el("div", "ecell");
    cell.style.marginTop = "7px";
    var iMes = document.createElement("input");
    iMes.className = "inp"; iMes.type = "month"; iMes.value = ymHoje;
    cell.appendChild(iMes);
    s.appendChild(cell);

    var resumo = el("div", "hintline");
    resumo.style.cssText = "text-align:left;margin-top:12px";
    s.appendChild(resumo);

    var lista = el("div", "acertos");
    lista.style.marginTop = "8px";
    s.appendChild(lista);

    var aviso = el("div", "hintline");
    aviso.style.cssText = "text-align:left;margin-top:8px";
    s.appendChild(aviso);

    var aplicar = el("button", "btn-aplicar", "Lançar valores");
    aplicar.type = "button";
    aplicar.style.marginTop = "14px";
    s.appendChild(aplicar);

    var acoes = el("div", "sh-acoes");
    var fechar = el("button", "btn-sec", "Cancelar");
    fechar.type = "button";
    fechar.addEventListener("click", fecharSheet);
    acoes.appendChild(fechar);
    s.appendChild(acoes);

    var doMes = [];
    function prever() {
      lista.innerHTML = "";
      aviso.textContent = "";
      var ym = iMes.value;
      if (!ym) { resumo.textContent = "Escolha o mês."; aplicar.disabled = true; return; }
      doMes = D.transacoes.filter(function (t) {
        return parcelaPendente(t) && String(t.data).slice(0, 7) === ym;
      }).sort(function (a, b) { return a.data < b.data ? -1 : 1; });

      var antes = D.transacoes.filter(function (t) {
        return parcelaPendente(t) && String(t.data).slice(0, 7) < ym;
      }).length;
      if (antes) {
        aviso.textContent = "Atenção: " + (antes === 1 ? "1 parcela" : antes + " parcelas") +
          " de meses anteriores " + (antes === 1 ? "continua" : "continuam") +
          " sem valor. Escolha o mês delas para lançar.";
      }

      if (!doMes.length) {
        resumo.textContent = "Nenhuma parcela sem valor em " + mesLabel(ym) + ".";
        aplicar.disabled = true;
        return;
      }
      var soma = doMes.reduce(function (a, t) { return a + parcelaDe(t).valor; }, 0);
      resumo.textContent = doMes.length + (doMes.length === 1 ? " parcela" : " parcelas") +
        " em " + mesLabel(ym) + " · total R$ " + brl(soma);
      aplicar.disabled = false;
      doMes.forEach(function (t) {
        var pc = parcelaDe(t);
        var li = el("div", "acerto-linha");
        li.appendChild(el("span", null, t.destinatario + " · " + pc.base + " " + pc.n + "/" + pc.de +
                                        " · " + obraCurto(t.obra)));
        li.appendChild(el("b", null, brl(pc.valor)));
        lista.appendChild(li);
      });
    }
    iMes.addEventListener("change", prever);
    iMes.addEventListener("input", prever);

    aplicar.addEventListener("click", function () {
      if (!doMes.length) return;
      aplicar.disabled = true;
      var alvo = iMes.value;
      var itens = doMes.slice();
      itens.forEach(function (t) { t.valor = parcelaDe(t).valor; });
      fecharSheet();

      var enfileirados = 0;
      itens.reduce(function (p, t) {
        return p.then(function () {
          return window.Dados.executar("update", t).then(function (r) {
            t.naoEnviado = !!r.enfileirado;
            if (r.enfileirado) enfileirados++;
          });
        });
      }, Promise.resolve()).then(function () {
        window.Dados.guardarCache(D);
        recalcular();
        filtros.mes = alvo;
        filtros.sit = "todas";
        irPara("tx");
        toast(itens.length + (itens.length === 1 ? " parcela lançada" : " parcelas lançadas") +
              " em " + mesLabel(alvo) +
              (enfileirados ? " · " + enfileirados + " esperando sinal" : ""));
      });
    });

    prever();
    s.classList.add("on");
    $("#scrim").classList.add("on");
  }

  var CHAVE_RELOPTS = "mattas.relatorio.opcoes.v1";
  function lerOpcoesRelatorio() {
    var vazio = { obras: {}, custo: {}, mensal: {}, pizza: {}, corrida: false };
    try {
      var g = JSON.parse(localStorage.getItem(CHAVE_RELOPTS) || "null");
      if (!g) return vazio;
      vazio.corrida = !!g.corrida;
      ["obras", "custo", "mensal", "pizza"].forEach(function (k) {
        (g[k] || []).forEach(function (id) {
          // uma obra apagada depois não pode ressuscitar na tela de opções
          if (k === "obras" && id === "acertos") { vazio[k][id] = true; return; }
          if (obra(id)) vazio[k][id] = true;
        });
      });
    } catch (e) {}
    return vazio;
  }
  function guardarOpcoesRelatorio(sels, corrida) {
    try {
      var g = { corrida: !!corrida };
      for (var k in sels) if (sels.hasOwnProperty(k)) g[k] = Object.keys(sels[k]);
      localStorage.setItem(CHAVE_RELOPTS, JSON.stringify(g));
    } catch (e) {}
  }

  function abrirOpcoesRelatorio() {
    abertoId = "relatorio";

    var hj = new Date();
    var periodoTudo = false;      // começa em "definir período", no mês corrente

    /* As escolhas de obra ficam guardadas: quem manda o mesmo relatório todo
       dia 1º não deve ter que remarcar os mesmos chips todo mês. */
    var lembrado = lerOpcoesRelatorio();
    var selObras = lembrado.obras;   // vazio = todas
    var selCusto = lembrado.custo;   // vazio = todas
    var selMensal = lembrado.mensal; // vazio = nenhum gráfico
    var selPizza = lembrado.pizza;   // vazio = nenhuma rosca

    var s = $("#sheet");
    s.innerHTML = "";
    s.appendChild(el("div", "grab"));
    var top = el("div", "sh-top");
    top.appendChild(el("h3", null, "Relatório para os sócios"));
    s.appendChild(top);
    s.appendChild(el("p", "sh-sub",
      "Escolha os meses e as obras que entram na lista de lançamentos. O balanço entre sócios e o " +
      "custo por obra saem sempre acumulados, desde o começo."));

    /* ---------------- período ---------------- */
    var lbP = el("div", "lbl");
    lbP.appendChild(el("span", null, "Período"));
    s.appendChild(lbP);

    var segP = el("div", "gchips g2");
    segP.style.marginTop = "7px";
    var btTudo = el("button", "chip", "Todo o período");
    var btDatas = el("button", "chip", "Definir período");
    btTudo.type = "button"; btDatas.type = "button";
    btTudo.addEventListener("click", function () { periodoTudo = true; pintarPeriodo(); });
    btDatas.addEventListener("click", function () { periodoTudo = false; pintarPeriodo(); });
    segP.appendChild(btTudo); segP.appendChild(btDatas);
    s.appendChild(segP);

    var faixa = el("div", "edit2");
    faixa.style.marginTop = "10px";
    var c1 = el("div", "ecell");
    c1.appendChild(el("span", "fl", "De"));
    var iDe = document.createElement("input");
    iDe.className = "inp"; iDe.type = "date";
    iDe.value = isoLocal(new Date(hj.getFullYear(), hj.getMonth(), 1));
    c1.appendChild(iDe);
    var c2 = el("div", "ecell");
    c2.appendChild(el("span", "fl", "Até"));
    var iAte = document.createElement("input");
    iAte.className = "inp"; iAte.type = "date"; iAte.value = hoje();
    c2.appendChild(iAte);
    faixa.appendChild(c1); faixa.appendChild(c2);
    s.appendChild(faixa);

    function pintarPeriodo() {
      btTudo.setAttribute("aria-pressed", String(periodoTudo));
      btDatas.setAttribute("aria-pressed", String(!periodoTudo));
      faixa.hidden = periodoTudo;
    }

    /* Um período que cobre um mês fechado vira "set/2026" no título, em vez de
       "01/09/2026 a 30/09/2026" — é como você fala do fechamento. */
    function rotuloDatas(de, ate) {
      var pd = de.split("-"), pa = ate.split("-");
      var ultimoDia = new Date(Number(pd[0]), Number(pd[1]), 0).getDate();
      if (pd[0] === pa[0] && pd[1] === pa[1] && Number(pd[2]) === 1 &&
          (Number(pa[2]) === ultimoDia || ate === hoje())) {
        return mesLabel(de.slice(0, 7));
      }
      return pd[2] + "/" + pd[1] + "/" + pd[0] + " a " + pa[2] + "/" + pa[1] + "/" + pa[0];
    }

    /* ---------------- as quatro escolhas de obra ----------------
       São independentes de propósito: dá para listar o custo das cinco obras,
       pedir o gráfico mensal de duas e a rosca de uma só. */
    function linhaDeObras(titulo, sel, opcoes) {
      opcoes = opcoes || {};
      var lb = el("div", "lbl");
      lb.style.marginTop = "16px";
      lb.appendChild(el("span", null, titulo));
      var resumo = el("em", null, "");
      lb.appendChild(resumo);
      s.appendChild(lb);
      if (opcoes.ajuda) s.appendChild(el("p", "sh-sub", opcoes.ajuda));

      var lista = D.obras.slice();
      if (opcoes.comAcertos) lista = lista.concat([{ id: "acertos", curto: "Acertos" }]);

      var caixa = el("div", "gchips");
      caixa.style.marginTop = "7px";
      var botoes = {};
      lista.forEach(function (o) {
        var b = el("button", "chip", o.curto);
        b.type = "button";
        b.addEventListener("click", function () {
          if (sel[o.id]) delete sel[o.id]; else sel[o.id] = true;
          pintar();
        });
        botoes[o.id] = b;
        caixa.appendChild(b);
      });
      s.appendChild(caixa);

      function pintar() {
        var n = Object.keys(sel).length;
        lista.forEach(function (o) { botoes[o.id].setAttribute("aria-pressed", String(!!sel[o.id])); });
        resumo.textContent = n ? (n === 1 ? "1 escolhida" : n + " escolhidas")
                               : (opcoes.vazio || "todas");
      }
      pintar();
      return pintar;
    }

    linhaDeObras("Obras nos lançamentos", selObras, { comAcertos: true });

    /* ---------------- separada por obra ou lista corrida ---------------- */
    var corrida = lembrado.corrida;

    var lbL = el("div", "lbl");
    lbL.style.marginTop = "16px";
    lbL.appendChild(el("span", null, "Lista de lançamentos"));
    var resumoL = el("em", null, "");
    lbL.appendChild(resumoL);
    s.appendChild(lbL);

    var segL = el("div", "gchips g2");
    segL.style.marginTop = "7px";
    var btSep = el("button", "chip", "Separada por obra");
    var btCorr = el("button", "chip", "Lista corrida");
    btSep.type = "button"; btCorr.type = "button";
    btSep.addEventListener("click", function () { corrida = false; pintarLista(); });
    btCorr.addEventListener("click", function () { corrida = true; pintarLista(); });
    segL.appendChild(btSep); segL.appendChild(btCorr);
    s.appendChild(segL);

    function pintarLista() {
      btSep.setAttribute("aria-pressed", String(!corrida));
      btCorr.setAttribute("aria-pressed", String(corrida));
      resumoL.textContent = corrida
        ? "tudo junto, em ordem de data"
        : "um bloco e um subtotal por obra";
    }
    pintarLista();

    linhaDeObras("Custo por obra", selCusto, {});
    linhaDeObras("Gráfico de gasto mês a mês", selMensal, {
      vazio: "nenhum",
      ajuda: "Um gráfico separado para cada obra escolhida, com todo o histórico dela."
    });
    linhaDeObras("Gráfico de para onde foi o dinheiro", selPizza, {
      vazio: "nenhum",
      ajuda: "Uma rosca por obra escolhida, com o gasto por categoria."
    });

    /* ---------------- formato ---------------- */
    // começa no formato do aparelho em que você está, que acerta quase sempre
    var formato = window.innerWidth < 900 ? "celular" : "computador";

    var lbF = el("div", "lbl");
    lbF.style.marginTop = "16px";
    lbF.appendChild(el("span", null, "Formato"));
    var resumoF = el("em", null, "");
    lbF.appendChild(resumoF);
    s.appendChild(lbF);

    var segF = el("div", "gchips g2");
    segF.style.marginTop = "7px";
    var btCel = el("button", "chip", "Celular");
    var btPC = el("button", "chip", "Computador");
    btCel.type = "button"; btPC.type = "button";
    btCel.addEventListener("click", function () { formato = "celular"; pintarFormato(); });
    btPC.addEventListener("click", function () { formato = "computador"; pintarFormato(); });
    segF.appendChild(btCel); segF.appendChild(btPC);
    s.appendChild(segF);

    function pintarFormato() {
      btCel.setAttribute("aria-pressed", String(formato === "celular"));
      btPC.setAttribute("aria-pressed", String(formato === "computador"));
      resumoF.textContent = formato === "celular"
        ? "lista, boa de ler no telefone"
        : "tabelas, boas de imprimir";
    }

    /* ---------------- gerar ---------------- */
    var gerar = el("button", "btn-aplicar", "Gerar relatório");
    gerar.type = "button";
    gerar.style.marginTop = "16px";
    gerar.addEventListener("click", function () {
      var de = iDe.value, ate = iAte.value;
      if (!periodoTudo) {
        if (!de || !ate) { toast("Preencha as duas datas do período."); return; }
        if (de > ate) { toast("A data inicial está depois da final."); return; }
      }
      var idsObra = Object.keys(selObras);

      var filtro = function (t) {
        var dt = String(t.data);
        if (!periodoTudo && (dt < de || dt > ate)) return false;
        if (!idsObra.length) return true;
        if (t.tipo === "acerto") return idsObra.indexOf("acertos") >= 0;
        return idsObra.indexOf(t.obra) >= 0;
      };

      var rotuloP = periodoTudo ? "todo o período" : rotuloDatas(de, ate);
      var rotuloO = idsObra.length
        ? idsObra.map(function (id) { return id === "acertos" ? "acertos" : obraCurto(id); }).join(", ")
        : "";

      guardarOpcoesRelatorio({ obras: selObras, custo: selCusto,
                               mensal: selMensal, pizza: selPizza }, corrida);

      fecharSheet();
      gerarRelatorio(filtro, rotuloP + (rotuloO ? " · " + rotuloO : ""), formato, {
        custo:   Object.keys(selCusto),
        mensal:  Object.keys(selMensal),
        pizza:   Object.keys(selPizza),
        corrida: corrida
      });
    });
    s.appendChild(gerar);

    var acoes = el("div", "sh-acoes");
    var fechar = el("button", "btn-sec", "Cancelar");
    fechar.type = "button";
    fechar.addEventListener("click", fecharSheet);
    acoes.appendChild(fechar);
    s.appendChild(acoes);

    pintarPeriodo();
    pintarFormato();
    s.classList.add("on");
    $("#scrim").classList.add("on");
  }

  /* ====================== GRÁFICOS DO RELATÓRIO ====================== */

  /* Oito cores de série, na ordem validada para daltonismo. A cor segue a obra,
     nunca a posição no gráfico: se você tirar uma obra do relatório, as outras
     continuam com a mesma cor. */
  var CORES_SERIE = ["var(--s1)", "var(--s2)", "var(--s3)", "var(--s4)",
                     "var(--s5)", "var(--s6)", "var(--s7)", "var(--s8)"];
  function corDaObra(id) {
    for (var i = 0; i < D.obras.length; i++) if (D.obras[i].id === id) return CORES_SERIE[i % 8];
    return "var(--s9)";
  }
  function brl0(v) {
    return (Number(v) || 0).toLocaleString("pt-BR", { maximumFractionDigits: 0 });
  }
  function mil(v) { return (Number(v) / 1000).toFixed(1).replace(".", ","); }
  function ehLote(cat) { return /^LOTE/i.test(String(cat || "")); }
  function escapar(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;"); }

  /* A compra do lote fica de fora dos dois gráficos. Com ela dentro, o mês da
     escritura vira uma torre de 350 mil e os dois anos de obra somem rente ao
     chão — o gráfico deixa de responder à pergunta que você faz a ele. O valor
     do lote continua inteiro no custo por obra, e aparece escrito ao lado da
     rosca para ninguém achar que sumiu. */
  function serieMensal(obraId) {
    var por = {};
    D.transacoes.forEach(function (t) {
      if (t.obra !== obraId || t.tipo !== "despesa" || !temValor(t)) return;
      if (ehLote(t.categoria)) return;
      var m = String(t.data).slice(0, 7);
      por[m] = (por[m] || 0) + Number(t.valor);
    });
    return Object.keys(por).sort().map(function (m) { return [m, por[m]]; });
  }

  function porCategoria(obraId) {
    var por = {}, lote = 0;
    D.transacoes.forEach(function (t) {
      if (t.obra !== obraId || t.tipo !== "despesa" || !temValor(t)) return;
      if (ehLote(t.categoria)) { lote += Number(t.valor); return; }
      var c = t.categoria || "sem categoria";
      por[c] = (por[c] || 0) + Number(t.valor);
    });
    var lista = Object.keys(por).map(function (c) { return [c, por[c]]; })
                      .sort(function (a, b) { return b[1] - a[1]; });
    var fatias;
    if (lista.length <= 9) {
      fatias = lista.map(function (c, i) { return [c[0], c[1], CORES_SERIE[i % 8]]; });
    } else {
      fatias = lista.slice(0, 8).map(function (c, i) { return [c[0], c[1], CORES_SERIE[i]]; });
      var resto = lista.slice(8).reduce(function (a, c) { return a + c[1]; }, 0);
      fatias.push(["Outras " + (lista.length - 8) + " categorias", resto, "var(--s9)"]);
    }
    return { fatias: fatias, lote: lote, quantas: lista.length };
  }

  function svgBarras(dados, cor, celular) {
    var L = 42, R = 10, T = 22;
    var W = celular ? 356 : 800;
    var ph = celular ? 154 : 184;
    var pw = W - L - R;
    var passo = pw / dados.length, larg = Math.min(26, passo - 3);

    /* Todo mês tem nome. Quando as barras ficam estreitas demais para o nome
       caber deitado, ele fica de pé — é o que acontece com 34 meses no
       celular. O tamanho da letra acompanha a largura que sobrou. */
    /* De pé, o que ocupa a largura não é o comprimento do nome e sim a altura
       da linha da fonte, coisa de uma vez e meia o tamanho da letra. Daí o
       divisor: é ele que garante que "dez" e "jan" não encostem um no outro. */
    /* No celular o nome do mês fica sempre de pé, mesmo quando caberia deitado:
       obra com poucos meses e obra com trinta e quatro passam a ter a mesma
       cara, em vez de cada relatório sair de um jeito. */
    var deitado = !celular && passo >= 18;
    var fm = deitado ? (passo < 26 ? 8 : 9)
                     : Math.min(8, Math.max(5, passo / 1.5));
    var alturaMes = deitado ? 13 : (5 + fm * 1.9);
    var B = alturaMes + 16;
    var H = T + ph + B;
    var base = T + ph;              // a linha do zero
    var yMes = deitado ? base + 13 : base + 5;
    var yAno = base + alturaMes + 11;

    var topo = 0;
    dados.forEach(function (d) { topo = Math.max(topo, d[1]); });
    if (topo <= 0) topo = 1;
    var degrau = Math.pow(10, Math.floor(Math.log(topo / 4) / Math.LN10));
    degrau = Math.ceil((topo / 4) / degrau) * degrau;
    var teto = Math.ceil(topo / degrau) * degrau;
    var media = dados.reduce(function (a, d) { return a + d[1]; }, 0) / dados.length;
    var y = function (v) { return T + ph - (v / teto) * ph; };
    var fv = celular ? 6.5 : 7.5;
    var s = ['<svg class="gr" viewBox="0 0 ' + W + " " + H +
             '" role="img" aria-label="Gasto mês a mês">'];

    for (var g = 0; g <= teto + 0.5; g += degrau) {
      s.push('<line x1="' + L + '" y1="' + y(g) + '" x2="' + (W - R) + '" y2="' + y(g) +
             '" stroke="' + (g === 0 ? "var(--line-strong)" : "var(--grid)") + '" stroke-width="1"/>');
      s.push('<text x="' + (L - 6) + '" y="' + (y(g) + 3) + '" text-anchor="end" class="eixo">' +
             (g === 0 ? "0" : mil(g)) + "</text>");
    }

    dados.forEach(function (d, i) {
      var x = L + i * passo + (passo - larg) / 2;
      var alt = Math.max(2, (d[1] / teto) * ph);
      s.push('<rect x="' + x.toFixed(1) + '" y="' + y(d[1]).toFixed(1) + '" width="' +
             larg.toFixed(1) + '" height="' + alt.toFixed(1) + '" fill="' + cor + '" rx="3"/>');
      var cx = (x + larg / 2).toFixed(1), cy = (y(d[1]) - 4).toFixed(1);
      if (celular) {
        s.push('<text x="' + cx + '" y="' + cy + '" text-anchor="start" class="valrot" font-size="' +
               fv + '" transform="rotate(-90 ' + cx + " " + cy + ')">' + mil(d[1]) + "</text>");
      } else {
        s.push('<text x="' + cx + '" y="' + cy + '" text-anchor="middle" class="valrot" font-size="' +
               fv + '">' + mil(d[1]) + "</text>");
      }
      var p = d[0].split("-");
      if (i === 0 || p[1] === "01") {
        s.push('<text x="' + cx + '" y="' + yAno + '" text-anchor="middle" class="anorot">' +
               p[0] + "</text>");
      }
      var nomeMes = MESES[Number(p[1]) - 1];
      if (deitado) {
        s.push('<text x="' + cx + '" y="' + yMes + '" text-anchor="middle" class="mesrot" ' +
               'font-size="' + fm + '">' + nomeMes + "</text>");
      } else {
        s.push('<text x="' + cx + '" y="' + yMes + '" text-anchor="end" class="mesrot" ' +
               'font-size="' + fm + '" transform="rotate(-90 ' + cx + " " + yMes + ')">' +
               nomeMes + "</text>");
      }
    });

    /* A média é desenhada depois das barras, para ficar por cima delas. O valor
       dela vive na legenda, fora do desenho: dentro do gráfico ele tapava um
       mês ou era tapado por ele. */
    s.push('<line x1="' + L + '" y1="' + y(media) + '" x2="' + (W - R) + '" y2="' + y(media) +
           '" class="media"/>');
    s.push("</svg>");
    return s.join("");
  }

  function svgRosca(fatias) {
    var total = fatias.reduce(function (a, c) { return a + c[1]; }, 0) || 1;
    var cx = 100, cy = 100, re = 86, ri = 55, ang = -Math.PI / 2;
    var s = ['<svg class="gr" viewBox="0 0 200 200" width="200" height="200" ' +
             'role="img" aria-label="Gasto por categoria">'];
    fatias.forEach(function (c) {
      var a1 = ang + (c[1] / total) * Math.PI * 2;
      var p = function (r, a) { return [(cx + r * Math.cos(a)).toFixed(2), (cy + r * Math.sin(a)).toFixed(2)]; };
      var A = p(re, ang), B = p(re, a1), C = p(ri, a1), E = p(ri, ang);
      var gr = (a1 - ang) > Math.PI ? 1 : 0;
      s.push('<path d="M' + A[0] + " " + A[1] + " A" + re + " " + re + " 0 " + gr + " 1 " +
             B[0] + " " + B[1] + " L" + C[0] + " " + C[1] + " A" + ri + " " + ri + " 0 " +
             gr + " 0 " + E[0] + " " + E[1] + '" fill="' + c[2] +
             '" stroke="var(--surface)" stroke-width="2" stroke-linejoin="round"/>');
      ang = a1;
    });
    s.push("</svg>");
    return s.join("");
  }

  function curtoBrl(v) {
    if (v >= 1000000) return (v / 1000000).toFixed(1).replace(".", ",") + " mi";
    if (v >= 1000) return Math.round(v / 1000) + " mil";
    return String(Math.round(v));
  }

  /* O relatório sai em dois formatos. No computador, tabelas — é o que imprime
     bem em A4 e o que o contador espera ver. No celular, tabela de seis colunas
     vira sopa: lá cada lançamento é um bloco em duas linhas, com o valor à
     direita, que é como se lê no polegar. */
  function gerarRelatorio(filtro, rotulo, formato, escolhas) {
    var e = escolhas || {};
    /* custo vazio quer dizer todas as obras; gráfico vazio quer dizer nenhum
       gráfico — é o padrão de quem só quer a prestação de contas. */
    var esc = {
      custo:   e.custo  || [],
      mensal:  e.mensal || [],
      pizza:   e.pizza  || [],
      corrida: !!e.corrida
    };
    var doPeriodo = D.transacoes.filter(filtro)
                                .sort(function (a, b) { return a.data < b.data ? -1 : 1; });
    var acertos = window.Calculo.acertosSugeridos(apuracao.saldos);
    var somaPeriodo = window.Calculo.somaDeCaixa(doPeriodo);

    function dia(t) { var p = String(t.data).split("-"); return p[2] + "/" + p[1] + "/" + p[0].slice(2); }
    function valorTxt(t) {
      return temValor(t) ? (t.tipo === "receita" ? "+" : "") + brl(t.valor) : "a definir";
    }
    function classeValor(t) { return temValor(t) ? "" : " semvalor"; }

    var grupos = D.obras.map(function (o) {
      return { nome: o.nome, itens: doPeriodo.filter(function (t) { return t.obra === o.id; }) };
    }).filter(function (g) { return g.itens.length; });
    var entreSocios = doPeriodo.filter(function (t) { return t.tipo === "acerto"; });

    var h = [];
    var celular = (formato === "celular");
    h.push('<div class="rel' + (celular ? ' rel-cel' : '') + '">');
    h.push('<h1>Mattas Custos</h1>');
    h.push('<p class="sub">' + rotulo + ' · gerado em ' + new Date().toLocaleString("pt-BR") + '</p>');

    /* ---------- balanço ---------- */
    h.push('<h2>Balanço entre sócios</h2>');
    if (celular) {
      apuracao.saldos.forEach(function (s) {
        h.push('<div class="cartao coluna">');
        h.push('<div class="linha"><span class="forte">' + s.nome + '</span>' +
               '<b class="' + (s.saldo > 0 ? 'deve' : 'recebe') + '">' + brl(Math.abs(s.saldo)) + '</b></div>');
        h.push('<div class="miudo">' + (s.saldo > 0 ? "a depositar" : "a receber") + '</div>');
        h.push('</div>');
      });
    } else {
      h.push('<table><tr><th>Sócio</th><th class="n">Já pagou</th><th class="n">Cota</th>' +
             '<th class="n">Saldo</th></tr>');
      apuracao.saldos.forEach(function (s) {
        h.push('<tr><td>' + s.nome + '</td><td class="n">' + brl(s.pago) + '</td><td class="n">' +
               brl(s.cota) + '</td><td class="n">' + brl(Math.abs(s.saldo)) +
               (s.saldo > 0 ? " a depositar" : " a receber") + '</td></tr>');
      });
      h.push('</table>');
    }

    /* ---------- quem deposita para quem ---------- */
    h.push('<h2>Quem deposita para quem</h2>');
    if (!acertos.length) {
      h.push('<p>Ninguém deve nada a ninguém neste momento.</p>');
    } else if (celular) {
      acertos.forEach(function (a) {
        h.push('<div class="cartao"><span>' + a.de + ' <em>para</em> ' + a.para +
               '</span><b>' + brl(a.valor) + '</b></div>');
      });
    } else {
      h.push('<table><tr><th>De</th><th>Para</th><th class="n">Valor</th></tr>');
      acertos.forEach(function (a) {
        h.push('<tr><td>' + a.de + '</td><td>' + a.para + '</td><td class="n">' + brl(a.valor) + '</td></tr>');
      });
      h.push('</table>');
    }

    /* ---------- custo por obra ---------- */
    var obrasCusto = D.obras.filter(function (o) {
      return !esc.custo.length || esc.custo.indexOf(o.id) >= 0;
    });
    if (obrasCusto.length) {
      var totalCusto = obrasCusto.reduce(function (a, o) {
        return a + (apuracao.custoPorObra[o.id] || 0);
      }, 0);
      var parcial = obrasCusto.length < D.obras.length;
      h.push('<h2>Custo por obra</h2>');
      if (celular) {
        obrasCusto.forEach(function (o) {
          h.push('<div class="cartao"><span>' + o.nome + '</span><b>' +
                 brl(apuracao.custoPorObra[o.id] || 0) + '</b></div>');
        });
        h.push('<div class="cartao total"><span>' + (parcial ? "Soma das obras acima" : "Total") +
               '</span><b>' + brl(totalCusto) + '</b></div>');
      } else {
        h.push('<table><tr><th>Obra</th><th class="n">Custo acumulado</th></tr>');
        obrasCusto.forEach(function (o) {
          h.push('<tr><td>' + o.nome + '</td><td class="n">' +
                 brl(apuracao.custoPorObra[o.id] || 0) + '</td></tr>');
        });
        h.push('<tr class="destaque"><td>' + (parcial ? "Soma das obras acima" : "Total") +
               '</td><td class="n">' + brl(totalCusto) + '</td></tr>');
        h.push('</table>');
      }
    }

    /* ---------- gasto mês a mês, um gráfico por obra ---------- */
    var comMensal = D.obras.filter(function (o) {
      return esc.mensal.indexOf(o.id) >= 0 && serieMensal(o.id).length;
    });
    if (comMensal.length) {
      h.push('<h2>Gasto mês a mês</h2>');
      comMensal.forEach(function (o) {
        var d = serieMensal(o.id);
        var t = d.reduce(function (a, x) { return a + x[1]; }, 0);
        var cor = corDaObra(o.id);
        h.push('<div class="fig">');
        h.push('<div class="figcab"><span class="nm"><i style="background:' + cor + '"></i>' +
               o.nome + '</span><span class="vl">R$ ' + brl0(t) + '</span>' +
               '<span class="dt">' + mesLabel(d[0][0]) + ' a ' + mesLabel(d[d.length - 1][0]) +
               ' · ' + d.length + ' meses com gasto · <span class="leg"><i></i>média de R$ ' +
               brl0(t / d.length) + '</span> · valores nas barras em R$ mil, ' +
               'sem a compra do lote</span></div>');
        h.push(svgBarras(d, cor, celular));
        h.push('</div>');
      });
    }

    /* ---------- para onde foi o dinheiro, uma rosca por obra ---------- */
    var comPizza = D.obras.filter(function (o) {
      return esc.pizza.indexOf(o.id) >= 0 && porCategoria(o.id).fatias.length;
    });
    if (comPizza.length) {
      h.push('<h2>Para onde foi o dinheiro</h2>');
      comPizza.forEach(function (o) {
        var r = porCategoria(o.id);
        var t = r.fatias.reduce(function (a, c) { return a + c[1]; }, 0);
        h.push('<div class="fig">');
        h.push('<div class="figcab"><span class="nm"><i style="background:' + corDaObra(o.id) +
               '"></i>' + o.nome + '</span><span class="vl">R$ ' + brl0(t) + '</span>' +
               (r.lote ? '<span class="dt">fora a compra do lote, de R$ ' + brl0(r.lote) + '</span>' : '') +
               '</div>');
        h.push('<div class="pizza"><div class="rosca">' + svgRosca(r.fatias) +
               '<div class="centro"><span class="ck">Total</span><span class="cv">R$ ' +
               curtoBrl(t) + '</span></div></div><div>');
        h.push('<table><tr><th>Categoria</th><th class="n">Valor</th><th class="n">%</th></tr>');
        r.fatias.forEach(function (c) {
          h.push('<tr><td><span class="cat"><i style="background:' + c[2] + '"></i>' +
                 escapar(c[0]) + '</span></td><td class="n">' + brl0(c[1]) + '</td><td class="n">' +
                 (c[1] / t * 100).toFixed(1).replace(".", ",") + '%</td></tr>');
        });
        h.push('</table></div></div></div>');
      });
    }

    /* ---------- lançamentos ----------
       Em lista corrida, tudo o que passou pelo filtro vira uma sequência só,
       em ordem de data, com uma coluna dizendo de qual obra é cada linha. É o
       formato de quem quer conferir o extrato do período de ponta a ponta, sem
       pular de bloco em bloco. Em lista separada, cada obra tem seu bloco e seu
       subtotal, que é o formato de prestação de contas. */
    h.push('<h2>Lançamentos — ' + rotulo + ' (' + doPeriodo.length + ')</h2>');

    if (esc.corrida) {
      /* No extrato corrido, um acerto precisa dizer quem pagou quem: ele não
         tem destinatário nem categoria como os outros lançamentos. */
      var obraDoItem = function (t) {
        return t.tipo === "acerto" ? "Acerto" : (obraCurto(t.obra) || "—");
      };
      var quemRecebeu = function (t) {
        return t.tipo === "acerto"
          ? socioNome(t.pagante) + " → " + socioNome(t.recebedor)
          : t.destinatario;
      };

      if (celular) {
        doPeriodo.forEach(function (t) {
          h.push('<div class="lanc">');
          h.push('<div class="linha"><span class="forte">' + quemRecebeu(t) + '</span>' +
                 '<b class="' + (t.tipo === "receita" ? "recebe" : "") + classeValor(t) + '">' +
                 valorTxt(t) + '</b></div>');
          h.push('<div class="miudo">' + dia(t) + ' · ' + obraDoItem(t) +
                 (t.descricao ? ' · ' + t.descricao : "") +
                 (t.categoria ? ' · ' + t.categoria : "") +
                 ' · ' + socioNome(t.pagante) + '</div>');
          h.push('</div>');
        });
        h.push('<div class="cartao total"><span>Total da lista</span><b>' +
               brl(somaPeriodo) + '</b></div>');
      } else {
        h.push('<table><tr><th>Data</th><th>Obra</th><th>Destinatário</th><th>Descrição</th>' +
               '<th>Categoria</th><th>Pagou</th><th class="n">Valor</th></tr>');
        doPeriodo.forEach(function (t) {
          h.push('<tr><td class="dt">' + dia(t) + '</td><td>' + obraDoItem(t) + '</td><td>' +
                 quemRecebeu(t) + '</td><td>' + (t.descricao || "") + '</td><td>' +
                 (t.categoria || "—") + '</td><td>' + socioNome(t.pagante) +
                 '</td><td class="n' + classeValor(t) + '">' + valorTxt(t) + '</td></tr>');
        });
        h.push('<tr class="destaque"><td colspan="6">Total da lista</td><td class="n">' +
               brl(somaPeriodo) + '</td></tr>');
        h.push('</table>');
      }

      if (entreSocios.length) {
        h.push('<p class="sub">Os ' + entreSocios.length +
               (entreSocios.length === 1 ? ' acerto marcado' : ' acertos marcados') +
               ' como "Acerto" não entram no custo das obras nem no total acima: ' +
               'são dinheiro passando de um sócio para outro.</p>');
      }
    } else {

    grupos.forEach(function (g) {
      var soma = window.Calculo.somaDeCaixa(g.itens);
      h.push('<h3>' + g.nome + ' <span class="cont">' + g.itens.length +
             (g.itens.length === 1 ? ' lançamento' : ' lançamentos') + '</span></h3>');
      if (celular) {
        g.itens.forEach(function (t) {
          h.push('<div class="lanc">');
          h.push('<div class="linha"><span class="forte">' + t.destinatario + '</span>' +
                 '<b class="' + (t.tipo === "receita" ? "recebe" : "") + classeValor(t) + '">' +
                 valorTxt(t) + '</b></div>');
          h.push('<div class="miudo">' + dia(t) + ' · ' + (t.descricao || "") +
                 (t.categoria ? ' · ' + t.categoria : "") + ' · ' + socioNome(t.pagante) + '</div>');
          h.push('</div>');
        });
        h.push('<div class="cartao total"><span>Subtotal</span><b>' + brl(soma) + '</b></div>');
      } else {
        h.push('<table><tr><th>Data</th><th>Destinatário</th><th>Descrição</th>' +
               '<th>Categoria</th><th>Pagou</th><th class="n">Valor</th></tr>');
        g.itens.forEach(function (t) {
          h.push('<tr><td class="dt">' + dia(t) + '</td><td>' + t.destinatario + '</td><td>' +
                 (t.descricao || "") + '</td><td>' + (t.categoria || "—") + '</td><td>' +
                 socioNome(t.pagante) + '</td><td class="n' + classeValor(t) + '">' +
                 valorTxt(t) + '</td></tr>');
        });
        h.push('<tr class="destaque"><td colspan="5">Subtotal</td><td class="n">' + brl(soma) + '</td></tr>');
        h.push('</table>');
      }
    });

    if (entreSocios.length) {
      h.push('<h3>Acertos entre sócios <span class="cont">' + entreSocios.length +
             (entreSocios.length === 1 ? ' lançamento' : ' lançamentos') + '</span></h3>');
      if (celular) {
        entreSocios.forEach(function (t) {
          h.push('<div class="lanc">');
          h.push('<div class="linha"><span class="forte">' + socioNome(t.pagante) +
                 ' <em>para</em> ' + socioNome(t.recebedor) + '</span><b>' + brl(t.valor) + '</b></div>');
          h.push('<div class="miudo">' + dia(t) + '</div>');
          h.push('</div>');
        });
      } else {
        h.push('<table><tr><th>Data</th><th>De</th><th>Para</th><th class="n">Valor</th></tr>');
        entreSocios.forEach(function (t) {
          h.push('<tr><td class="dt">' + dia(t) + '</td><td>' + socioNome(t.pagante) + '</td><td>' +
                 socioNome(t.recebedor) + '</td><td class="n">' + brl(t.valor) + '</td></tr>');
        });
        h.push('</table>');
      }
      h.push('<p class="sub">Acertos não entram no custo das obras: são dinheiro passando de um ' +
             'sócio para outro.</p>');
    }
    }

    h.push('<h2>Total do período</h2>');
    if (celular) {
      h.push('<div class="cartao total"><span>Despesas menos receitas, sem os acertos</span><b>' +
             brl(somaPeriodo) + '</b></div>');
    } else {
      h.push('<table><tr class="destaque"><td>Despesas menos receitas, sem contar os acertos</td>' +
             '<td class="n">' + brl(somaPeriodo) + '</td></tr></table>');
    }
    h.push('</div>');

    var w = window.open("", "_blank");
    if (!w) { toast("O navegador bloqueou a janela do relatório. Libere e tente de novo."); return; }

    /* O relatório usa o estilo do aplicativo, e lá html e body são travados na
       altura da tela, com overflow escondido — é o que mantém a barra de abas
       fixa. Numa página de relatório isso corta tudo depois da primeira tela
       na hora de imprimir, então aqui a trava é desfeita. */
    var estiloProprio =
      'html,body{height:auto!important;min-height:0!important;overflow:visible!important;' +
      'overscroll-behavior:auto!important;background:#fff!important}' +
      'body{padding:' + (celular ? '14px' : '22px') + '}' +
      /* Sem isto o navegador joga fora o preenchimento das barras e das fatias
         na impressão, e o gráfico sai em branco. */
      '*{-webkit-print-color-adjust:exact;print-color-adjust:exact}' +
      '@page{margin:12mm}' +
      '@media print{body{padding:0}' +
      'h1,h2,h3{break-after:avoid;page-break-after:avoid}' +
      'tr,.lanc,.cartao,.fig{break-inside:avoid;page-break-inside:avoid}}';

    /* O relatório é sempre claro, mesmo com o sistema no modo escuro: ele vai
       para papel e para o WhatsApp, onde fundo preto não serve. O data-theme
       trava os tokens de cor na versão clara. */
    w.document.write('<!doctype html><html lang="pt-BR" data-theme="light"><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width, initial-scale=1">' +
      '<title>Mattas Custos — ' + rotulo + '</title>' +
      '<link rel="stylesheet" href="' + location.href.replace(/[^\/]*$/, "") + 'css/estilo.css">' +
      '<style>' + estiloProprio + '</style>' +
      '</head><body>' + h.join("") + '</body></html>');
    w.document.close();
    // espera a folha de estilo carregar antes de chamar a impressão
    setTimeout(function () { w.print(); }, 1200);
  }

  /* ============================== NAVEGAÇÃO ============================== */

  function irPara(v) {
    ["lancar", "tx", "painel", "cad"].forEach(function (k) { $("#v-" + k).hidden = (k !== v); });
    Array.prototype.forEach.call(document.querySelectorAll(".tab"), function (b) {
      b.setAttribute("aria-selected", String(b.dataset.view === v));
    });
    if (v === "tx") { montarFiltros(); renderTx(); }
    if (v === "painel") renderPainel();
    if (v === "cad") renderCadastros();
  }

  function atualizarRede() {
    var f = window.Dados.fila();
    var p = $("#netpill"), txt = $("#nettxt");
    p.classList.remove("off", "alerta");
    if (!window.Dados.temSinal()) {
      p.classList.add("off");
      txt.textContent = f.length ? f.length + " esperando sinal" : "sem sinal";
    } else if (f.length) {
      // com internet e ainda na fila: alguma coisa não entrou. Vermelho, não âmbar.
      p.classList.add("alerta");
      txt.textContent = f.length + (f.length === 1 ? " não enviado" : " não enviados");
    } else {
      txt.textContent = "sincronizado";
    }
  }

  function sincronizarAgora() {
    if (!window.Dados.temSinal()) { toast("Sem internet agora. O que está na fila sobe sozinho quando voltar."); return; }
    toast("Sincronizando...");
    window.Dados.sincronizar()
      .then(function (r) {
        if (r.enviados) toast(r.enviados + (r.enviados === 1 ? " lançamento enviado" : " lançamentos enviados"));
        return window.Dados.carregar();
      })
      .then(function (dados) {
        D = dados;
        montarChips(); montarListasAuxiliares();
        recalcular();
        toast("Tudo em dia com a planilha.");
      })
      .catch(function (e) { toast(e.message || "Não consegui sincronizar."); atualizarRede(); });
  }

  /* =============================== EVENTOS =============================== */

  var eventosLigados = false;
  function ligarEventos() {
    if (eventosLigados) return;
    eventosLigados = true;

    $("#valor").addEventListener("input", function (e) {
      var r = lerValor(e.target.value);
      estado.valor = r.cent; estado.expr = r.expr;
      validar();
    });
    $("#valor").addEventListener("blur", function (e) { if (estado.valor > 0) e.target.value = brl(estado.valor / 100); });
    $("#valor").addEventListener("focus", function (e) { if (estado.expr) e.target.value = estado.expr; });

    Array.prototype.forEach.call(document.querySelectorAll("[data-dia]"), function (b) {
      b.addEventListener("click", function () {
        var d = new Date();
        d.setDate(d.getDate() - parseInt(b.dataset.dia, 10));
        estado.data = isoLocal(d);
        $("#data").value = estado.data;
        Array.prototype.forEach.call(document.querySelectorAll("[data-dia]"), function (c) { c.setAttribute("aria-pressed", "false"); });
        b.setAttribute("aria-pressed", "true");
        $("#datahint").textContent = b.textContent.toLowerCase();
        validar();
      });
    });
    $("#data").addEventListener("change", function (e) {
      estado.data = e.target.value || hoje();
      Array.prototype.forEach.call(document.querySelectorAll("[data-dia]"), function (c) { c.setAttribute("aria-pressed", "false"); });
      var p = estado.data.split("-");
      $("#datahint").textContent = p[2] + "/" + p[1];
      validar();
    });

    Array.prototype.forEach.call(document.querySelectorAll("[data-tipo]"), function (b) {
      b.addEventListener("click", function () { aplicarTipo(b.dataset.tipo); });
    });
    Array.prototype.forEach.call(document.querySelectorAll("[data-nf]"), function (b) {
      b.addEventListener("click", function () {
        estado.nf = b.dataset.nf;
        Array.prototype.forEach.call(document.querySelectorAll("[data-nf]"), function (c) { c.setAttribute("aria-pressed", "false"); });
        b.setAttribute("aria-pressed", "true");
      });
    });

    var cat = $("#categoria");
    cat.addEventListener("focus", function () { cbIdx = -1; cbAbrir(""); cat.select(); });
    cat.addEventListener("input", function () { cbIdx = -1; cbAbrir(cat.value); });
    cat.addEventListener("blur", function () { setTimeout(cbValidarSaida, 60); });
    cat.addEventListener("keydown", function (ev) {
      if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
        ev.preventDefault();
        if ($("#cblist").hidden) cbAbrir(cat.value);
        cbIdx += (ev.key === "ArrowDown" ? 1 : -1);
        if (cbIdx < 0) cbIdx = cbOpts.length - 1;
        if (cbIdx >= cbOpts.length) cbIdx = 0;
        cbAbrir(cat.value);
        var on = $("#cblist").querySelector(".cb-opt.on");
        if (on && on.scrollIntoView) on.scrollIntoView({ block: "nearest" });
      } else if (ev.key === "Enter") {
        ev.preventDefault();
        if (cbIdx >= 0 && cbOpts[cbIdx]) cbEscolher(cbOpts[cbIdx]);
        else if (cbOpts.length === 1) cbEscolher(cbOpts[0]);
        else cbValidarSaida();
      } else if (ev.key === "Escape") { cbFechar(); }
    });

    $("#adm").addEventListener("click", function () {
      estado.adm = !estado.adm;
      $("#adm").setAttribute("aria-pressed", String(estado.adm));
      $("#admhint").textContent = estado.adm ? "você marcou que incide" : "você marcou que não incide";
    });

    $("#recorrente").addEventListener("click", function () {
      /* Ligar de novo um lançamento que veio do preencher recorrentes e ainda
         não foi conferido devolve o estado "nova", não "sim": o desligar e
         religar não pode servir de conferência acidental. */
      estado.recorrente = estado.recorrente ? "" : (estado.recorrenteEra === "nova" ? "nova" : "sim");
      pintarRecorrente();
      // recorrente e parcelada não combinam: as parcelas já cobrem os meses seguintes
      if (estado.recorrente && estado.parcelado) { estado.parcelado = false; pintarParcelado(); validar(); }
    });

    $("#parcelado").addEventListener("click", function () {
      estado.parcelado = !estado.parcelado;
      if (estado.parcelado && estado.recorrente) { estado.recorrente = ""; pintarRecorrente(); }
      pintarParcelado();
      validar();
      if (estado.parcelado) $("#nparc").select();
    });
    $("#nparc").addEventListener("input", function (e) {
      var n = parseInt(e.target.value, 10);
      estado.nparc = isNaN(n) ? 0 : Math.min(60, n);
      validar();
    });

    $("#destinatario").addEventListener("input", function (e) {
      var v = e.target.value.trim();
      $("#destnovo").hidden = !(v !== "" && !fornecedorExiste(v));
      validar();
    });
    $("#descricao").addEventListener("input", validar);
    $("#salvar").addEventListener("click", salvar);
    $("#edcancel").addEventListener("click", sairDaEdicao);

    $("#busca").addEventListener("input", function (e) { filtros.busca = e.target.value; renderTx(); });
    $("#btnfiltros").addEventListener("click", function () {
      var p = $("#fpanel"), aberto = !p.hidden;
      p.hidden = aberto;
      $("#btnfiltros").setAttribute("aria-expanded", String(!aberto));
    });
    $("#f-mes").addEventListener("change", function (e) { filtros.mes = e.target.value; montarFiltros(); renderTx(); });
    $("#f-pag").addEventListener("change", function (e) { filtros.pagante = e.target.value; montarFiltros(); renderTx(); });
    $("#f-dest").addEventListener("change", function (e) { filtros.dest = e.target.value; montarFiltros(); renderTx(); });
    $("#f-cat").addEventListener("change", function (e) { filtros.cat = e.target.value; montarFiltros(); renderTx(); });
    $("#f-nfsel").addEventListener("change", function (e) { filtros.nf = e.target.value; montarFiltros(); renderTx(); });
    $("#f-sit").addEventListener("change", function (e) { filtros.sit = e.target.value; montarFiltros(); renderTx(); });
    $("#limpar").addEventListener("click", function () {
      filtros = { obra: "todas", mes: "todos", pagante: "todos", dest: "todos",
                  cat: "todas", nf: "todos", sit: "todas", busca: "" };
      $("#busca").value = "";
      montarFiltros(); renderTx();
    });

    $("#add-forn").addEventListener("click", function () {
      var v = $("#novo-forn").value.trim();
      if (!v || fornecedorExiste(v)) { $("#novo-forn").value = ""; return; }
      var novo = { id: "FX" + Date.now().toString(36), nome: v, razao: "", doc: "",
                   contato: "", pagamento: "", endereco: "", tipo: "" };
      D.fornecedores.push(novo);
      $("#novo-forn").value = "";
      window.Dados.guardarCache(D);
      montarListasAuxiliares(); renderCadastros();
      window.Dados.acrescentarLinhaEm("fornecedores", [novo.id, v, "", "", "", "", "", ""])
        .then(function () { toast("Fornecedor cadastrado"); })
        .catch(function (e) { toast("Cadastrei aqui, mas não consegui gravar na planilha."); });
    });

    $("#add-cat").addEventListener("click", function () {
      var v = $("#novo-cat").value.trim().toUpperCase();
      if (!v || catExiste(v)) { $("#novo-cat").value = ""; return; }
      var nova = { id: "CX" + Date.now().toString(36), nome: v, admPadrao: true };
      D.categorias.push(nova);
      $("#novo-cat").value = "";
      window.Dados.guardarCache(D);
      renderCadastros();
      window.Dados.acrescentarLinhaEm("categorias", [nova.id, v, "TRUE", "TRUE"])
        .then(function () { toast("Categoria cadastrada"); })
        .catch(function () { toast("Cadastrei aqui, mas não consegui gravar na planilha."); });
    });

    $("#add-obra").addEventListener("click", function () {
      var v = $("#novo-obra").value.trim();
      if (!v) return;
      var modelo = D.obras.length ? D.obras[0] : null;
      var nova = {
        id: "o" + Date.now().toString(36), nome: v, curto: v.split(" - ").pop(),
        status: "ativa", taxaAdm: modelo ? modelo.taxaAdm : 10, socios: {}
      };
      D.socios.forEach(function (s) {
        var m = modelo && modelo.socios ? modelo.socios[s.id] : null;
        nova.socios[s.id] = m ? { participacao: m.participacao, papel: m.papel, admShare: m.admShare }
                              : { participacao: 0, papel: "fora", admShare: 0 };
      });
      D.obras.push(nova);
      $("#novo-obra").value = "";
      window.Dados.guardarCache(D);
      montarChips(); recalcular();
      window.Dados.acrescentarLinhaEm("obras", [nova.id, nova.nome, nova.curto, "ativa", nova.taxaAdm])
        .then(function () { return window.Dados.salvarObraSocios(nova.id, nova.socios); })
        .then(function () { toast("Obra criada com a mesma composição de " + (modelo ? modelo.nome : "")); })
        .catch(function () { toast("Criei aqui, mas não consegui gravar na planilha."); });
      abrirObra(nova.id);
    });

    $("#add-soc").addEventListener("click", function () {
      var v = $("#novo-soc").value.trim();
      if (!v) return;
      var novo = { id: "s" + Date.now().toString(36), nome: v, email: "" };
      D.socios.push(novo);
      $("#novo-soc").value = "";
      window.Dados.guardarCache(D);
      montarChips(); recalcular();
      window.Dados.acrescentarLinhaEm("socios", [novo.id, v, "", "TRUE"])
        .then(function () { toast("Sócio cadastrado. Abra cada obra para definir a participação dele."); })
        .catch(function () { toast("Cadastrei aqui, mas não consegui gravar na planilha."); });
    });

    $("#btn-planilha").addEventListener("click", function () {
      var url = window.CONFIG.linkPlanilha ||
                ("https://docs.google.com/spreadsheets/d/" + window.CONFIG.planilhaId + "/edit");
      window.open(url, "_blank");
    });
    $("#btn-sair").addEventListener("click", function () {
      window.Dados.sair();
      location.reload();
    });
    $("#btn-relatorio").addEventListener("click", abrirOpcoesRelatorio);
    $("#btn-recorrentes").addEventListener("click", abrirPreencherRecorrentes);
    $("#btn-parcelas").addEventListener("click", abrirLancarParcelas);
    $("#netpill").addEventListener("click", sincronizarAgora);

    $("#scrim").addEventListener("click", fecharSheet);
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && abertoId) fecharSheet(); });

    Array.prototype.forEach.call(document.querySelectorAll(".tab"), function (b) {
      b.addEventListener("click", function () { irPara(b.dataset.view); });
    });

    window.addEventListener("online", function () {
      atualizarRede();
      window.Dados.sincronizar().then(function (r) {
        if (r.enviados) { toast(r.enviados + " lançamento(s) enviados"); atualizarRede(); }
      }).catch(function () {});
    });
    window.addEventListener("offline", atualizarRede);
  }

  /* =============================== PARTIDA =============================== */

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", iniciar);
  else iniciar();

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("sw.js").catch(function () {});
    });
  }
})();
