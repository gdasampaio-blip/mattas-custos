/* ===========================================================================
   dados.js — a conversa com a planilha Google.

   A planilha é o banco de dados. Este arquivo cuida de:
     · entrar com a conta Google e pedir permissão de escrita na planilha
     · ler todas as abas de uma vez
     · gravar, alterar e apagar lançamentos
     · guardar uma cópia local, para o aplicativo abrir instantâneo
     · segurar o que foi lançado sem internet e subir quando o sinal voltar

   Toda escrita é por acréscimo ou por linha localizada pelo id — nunca por
   posição fixa, e nunca reescrevendo a planilha inteira.
   =========================================================================== */

(function (global) {
  "use strict";

  var CHAVE_CACHE = "mattas.cache.v1";
  var CHAVE_FILA  = "mattas.fila.v1";
  var CHAVE_TOKEN = "mattas.token.v1";
  var CHAVE_EMAIL = "mattas.email.v1";
  var CHAVE_SILENCIO = "mattas.silencioso.v1";

  var cfg = null;
  var tokenClient = null;
  var token = null;
  var tokenExpira = 0;
  var usuario = null;
  var idsDasAbas = {};        // nome da aba -> sheetId numérico
  var linhaDoId = {};         // id do lançamento -> número da linha na planilha

  var COLUNAS = {
    /* "recorrente" guarda três estados: vazio (não se repete), "sim" (se repete
       todo mês) e "nova" (foi criada pelo preencher recorrentes e o valor ainda
       não foi conferido). Entrou depois da planilha já existir, então tudo que
       lê essa coluna precisa aguentar encontrá-la vazia. */
    transacoes:   ["id","data","tipo","obra","pagante","recebedor","destinatario",
                   "descricao","categoria","valor","incide_adm","status_nf",
                   "observacao","origem_linha","recorrente"],
    obras:        ["id","nome","curto","status","taxa_adm_pct"],
    obra_socios:  ["obra","socio","participacao_pct","papel","adm_share_pct"],
    socios:       ["id","nome","email","ativo"],
    categorias:   ["id","nome","incide_adm_padrao","ativa"],
    fornecedores: ["id","nome_fantasia","razao_social","cnpj_cpf","contato",
                   "pagamento","endereco","tipo"]
  };

  /* ----------------------------------------------------------- utilidades */

  function guardar(chave, valor) {
    try { localStorage.setItem(chave, JSON.stringify(valor)); } catch (e) {}
  }
  function ler(chave, padrao) {
    try {
      var s = localStorage.getItem(chave);
      return s ? JSON.parse(s) : padrao;
    } catch (e) { return padrao; }
  }

  function serialParaIso(n) {
    var base = Date.UTC(1899, 11, 30);
    var d = new Date(base + Math.floor(n) * 86400000);
    return d.toISOString().slice(0, 10);
  }
  function normalizaData(v) {
    if (v === null || v === undefined || v === "") return "";
    if (typeof v === "number") return serialParaIso(v);
    var s = String(v).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    var m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);       // 18/09/2026
    if (m) return m[3] + "-" + ("0"+m[2]).slice(-2) + "-" + ("0"+m[1]).slice(-2);
    var n = Number(s);
    if (!isNaN(n) && n > 20000) return serialParaIso(n);
    return s;
  }
  function numero(v) {
    if (v === null || v === undefined || v === "") return null;
    if (typeof v === "number") return v;
    var s = String(v).trim().replace(/\s/g, "");
    if (s === "") return null;
    // aceita 1.234,56 e 1234.56
    if (s.indexOf(",") > -1) s = s.replace(/\./g, "").replace(",", ".");
    var n = Number(s);
    return isNaN(n) ? null : n;
  }
  function booleano(v) {
    var s = String(v).trim().toUpperCase();
    return s === "TRUE" || s === "VERDADEIRO" || s === "SIM" || s === "1";
  }
  function novoId() {
    var r = "";
    var abc = "abcdefghijklmnopqrstuvwxyz0123456789";
    for (var i = 0; i < 10; i++) r += abc.charAt(Math.floor(Math.random() * abc.length));
    return "n" + Date.now().toString(36) + r.slice(0, 5);
  }

  /* --------------------------------------------------------------- login */

  function carregarBiblioteca() {
    return new Promise(function (ok, erro) {
      if (global.google && global.google.accounts && global.google.accounts.oauth2) return ok();
      var s = document.createElement("script");
      s.src = "https://accounts.google.com/gsi/client";
      s.async = true;
      s.onload = function () { ok(); };
      s.onerror = function () { erro(new Error("Não consegui carregar o login do Google.")); };
      document.head.appendChild(s);
    });
  }

  /* O Google só entrega um token de uma hora. Pedir "consent" a cada vez fazia
     a tela de consentimento (e o aviso de app não verificado) aparecer em toda
     abertura do aplicativo. Com prompt vazio, quando a sessão do Google está
     viva e a permissão já foi dada, o token é renovado sem nenhuma tela — o
     "consent" fica só para o caso em que o silencioso falha. */
  function pedirToken(comConsentimento, prazoMs) {
    return new Promise(function (ok, erro) {
      if (!tokenClient) {
        tokenClient = global.google.accounts.oauth2.initTokenClient({
          client_id: cfg.clientId,
          scope: "https://www.googleapis.com/auth/spreadsheets " +
                 "https://www.googleapis.com/auth/userinfo.email",
          callback: function () {}
        });
      }
      var respondeu = false;
      tokenClient.callback = function (resp) {
        if (respondeu) return;
        respondeu = true;
        if (resp.error) { erro(new Error(resp.error_description || resp.error)); return; }
        token = resp.access_token;
        tokenExpira = Date.now() + (Number(resp.expires_in) || 3600) * 1000 - 60000;
        guardar(CHAVE_TOKEN, { token: token, expira: tokenExpira });
        ok(token);
      };
      /* Há casos (janelinha barrada pelo navegador, sessão do Google expirada)
         em que o pedido não chama de volta nem com erro. Sem prazo, o
         aplicativo ficaria na tela "Entrando..." para sempre. */
      setTimeout(function () {
        if (respondeu) return;
        respondeu = true;
        erro(new Error("O Google não respondeu ao pedido de acesso."));
      }, prazoMs || 120000);

      var opcoes = { prompt: comConsentimento ? "consent" : "" };
      var email = ler(CHAVE_EMAIL, null);
      if (email && !comConsentimento) opcoes.hint = email;
      try {
        tokenClient.requestAccessToken(opcoes);
      } catch (e) { respondeu = true; erro(e); }
    });
  }

  function tokenValido() {
    if (token && Date.now() < tokenExpira) return true;
    var g = ler(CHAVE_TOKEN, null);
    if (g && g.token && Date.now() < g.expira) { token = g.token; tokenExpira = g.expira; return true; }
    return false;
  }

  function garantirToken() {
    if (tokenValido()) return Promise.resolve(token);
    return carregarBiblioteca().then(function () { return pedirToken(false); });
  }

  /* Clique no botão "Entrar": tenta o caminho sem tela primeiro; só se ele
     falhar é que o Google é chamado para pedir permissão de novo. */
  function entrar() {
    return carregarBiblioteca()
      .then(function () { return pedirToken(false); })
      .catch(function () { return pedirToken(true); })
      .then(quemSou);
  }

  /* Abertura do aplicativo: renova o token sem nenhuma tela. Se não der, quem
     chamou mostra o botão de entrar.

     O Google abre o pedido de token numa janelinha, e navegador nenhum deixa
     abrir janela sem alguém ter clicado em alguma coisa. No computador, quando
     as janelas do site estão liberadas, ela abre e fecha sozinha e a entrada é
     automática; no iPhone ela é sempre barrada. Por isso, quando o caminho
     silencioso falha neste aparelho, o aplicativo desiste dele e passa a
     mostrar o botão na hora, em vez de fazer você esperar por nada. */
  function podeTentarSilencioso() {
    if (tokenValido()) return true;
    return ler(CHAVE_SILENCIO, "1") !== "0";
  }

  function entrarSilencioso() {
    if (tokenValido()) return quemSou();
    return carregarBiblioteca()
      .then(function () { return pedirToken(false, 4000); })
      .then(function () { guardar(CHAVE_SILENCIO, "1"); return quemSou(); })
      .catch(function (e) { guardar(CHAVE_SILENCIO, "0"); throw e; });
  }

  function quemSou() {
    return chamar("https://www.googleapis.com/oauth2/v3/userinfo").then(function (u) {
      usuario = { email: (u.email || "").toLowerCase(), nome: u.name || u.email };
      guardar(CHAVE_EMAIL, usuario.email);
      var permitidos = (cfg.emailsPermitidos || []).map(function (e) { return e.toLowerCase(); });
      if (permitidos.length && permitidos.indexOf(usuario.email) === -1) {
        throw new Error("A conta " + usuario.email + " não tem acesso a este sistema.");
      }
      return usuario;
    });
  }

  function sair() {
    token = null; tokenExpira = 0; usuario = null;
    try { localStorage.removeItem(CHAVE_TOKEN); } catch (e) {}
  }

  /* ------------------------------------------------------------ chamadas */

  /* Uma promessa que nunca resolve nem rejeita é pior do que um erro: o
     aplicativo fica esperando para sempre e o lançamento se perde em silêncio.
     Foi o que aconteceu em 21/09/2026. Toda chamada agora tem prazo. */
  function comPrazo(promessa, ms, oQue) {
    return new Promise(function (ok, erro) {
      var acabou = false;
      var t = setTimeout(function () {
        if (acabou) return;
        acabou = true;
        erro(new Error("network: o Google não respondeu a tempo (" + oQue + ")"));
      }, ms || 25000);
      promessa.then(
        function (r) { if (acabou) return; acabou = true; clearTimeout(t); ok(r); },
        function (e) { if (acabou) return; acabou = true; clearTimeout(t); erro(e); }
      );
    });
  }

  function chamar(url, opcoes) {
    return comPrazo(chamarSemPrazo(url, opcoes), 25000, url.indexOf("append") > -1 ? "gravar" : "ler");
  }

  function chamarSemPrazo(url, opcoes) {
    opcoes = opcoes || {};
    return garantirToken().then(function (t) {
      var cab = opcoes.headers || {};
      cab["Authorization"] = "Bearer " + t;
      if (opcoes.body) cab["Content-Type"] = "application/json";
      return fetch(url, {
        method: opcoes.method || "GET",
        headers: cab,
        body: opcoes.body ? JSON.stringify(opcoes.body) : undefined
      });
    }).then(function (r) {
      if (r.status === 401) { sair(); throw new Error("Sessão expirada. Entre de novo."); }
      if (!r.ok) {
        return r.text().then(function (txt) {
          throw new Error("Google respondeu " + r.status + ": " + txt.slice(0, 200));
        });
      }
      return r.json();
    });
  }

  function urlPlanilha(caminho) {
    return "https://sheets.googleapis.com/v4/spreadsheets/" + cfg.planilhaId + caminho;
  }

  /* --------------------------------------------------------------- leitura */

  function linhasParaObjetos(valores, colunas) {
    if (!valores || !valores.length) return { itens: [], cabecalho: colunas.slice(), linhas: {} };
    var cab = valores[0].map(function (c) { return String(c).trim().toLowerCase(); });
    var idx = {};
    colunas.forEach(function (nome) { idx[nome] = cab.indexOf(nome); });
    var itens = [], linhas = {};
    for (var i = 1; i < valores.length; i++) {
      var linha = valores[i];
      if (!linha || !linha.length) continue;
      var o = { _linha: i + 1 };
      colunas.forEach(function (nome) {
        o[nome] = idx[nome] >= 0 ? (linha[idx[nome]] !== undefined ? linha[idx[nome]] : "") : "";
      });
      if (o.id) linhas[o.id] = i + 1;
      itens.push(o);
    }
    return { itens: itens, cabecalho: cab, linhas: linhas };
  }

  function montarTransacao(o) {
    return {
      id: String(o.id),
      data: normalizaData(o.data),
      tipo: String(o.tipo || "despesa").trim(),
      obra: String(o.obra || "").trim(),
      pagante: String(o.pagante || "").trim(),
      recebedor: String(o.recebedor || "").trim(),
      destinatario: String(o.destinatario || "").trim(),
      descricao: String(o.descricao || "").trim(),
      categoria: String(o.categoria || "").trim(),
      valor: numero(o.valor),
      incideAdm: booleano(o.incide_adm),
      statusNf: String(o.status_nf || "").trim(),
      observacao: String(o.observacao || "").trim(),
      origem: String(o.origem_linha || "").trim(),
      recorrente: String(o.recorrente || "").trim().toLowerCase(),
      _linha: o._linha
    };
  }

  function carregar() {
    var abas = ["transacoes", "obras", "obra_socios", "socios", "categorias", "fornecedores"];
    var q = abas.map(function (a) { return "ranges=" + encodeURIComponent(a + "!A:Z"); }).join("&");
    var url = urlPlanilha("/values:batchGet?" + q + "&valueRenderOption=UNFORMATTED_VALUE");

    return chamar(url).then(function (resp) {
      var por = {};
      (resp.valueRanges || []).forEach(function (vr, i) {
        por[abas[i]] = linhasParaObjetos(vr.values || [], COLUNAS[abas[i]]);
      });

      linhaDoId = por.transacoes.linhas;

      /* A planilha nasceu sem a coluna "recorrente". Se ela ainda não existe,
         escrevemos o cabeçalho antes de seguir: sem ele, gravar a coluna O
         encheria uma coluna sem nome, e na leitura seguinte o dado sumiria. */
      var precisaColuna = por.transacoes.cabecalho.indexOf("recorrente") < 0;
      return (precisaColuna ? criarColunaRecorrente(por.transacoes.cabecalho.length)
                            : Promise.resolve())
        .then(function () { return montarDados(por); });
    });
  }

  function criarColunaRecorrente(quantasJaTem) {
    var letra = String.fromCharCode(65 + quantasJaTem);   // 14 colunas -> "O"
    return chamar(urlPlanilha("/values/transacoes!" + letra + "1?valueInputOption=RAW"),
                  { method: "PUT", body: { values: [["recorrente"]] } })
      .catch(function () { /* sem a coluna o aplicativo ainda funciona, só não guarda a marca */ });
  }

  function montarDados(por) {
      var socios = por.socios.itens
        .filter(function (s) { return s.id && booleano(s.ativo); })
        .map(function (s) { return { id: String(s.id), nome: String(s.nome), email: String(s.email || "") }; });

      var cfgPorObra = {};
      por.obra_socios.itens.forEach(function (os) {
        var ob = String(os.obra || "").trim();
        if (!ob) return;
        if (!cfgPorObra[ob]) cfgPorObra[ob] = {};
        cfgPorObra[ob][String(os.socio).trim()] = {
          participacao: numero(os.participacao_pct) || 0,
          papel: String(os.papel || "fora").trim(),
          admShare: numero(os.adm_share_pct) || 0
        };
      });

      var obras = por.obras.itens
        .filter(function (o) { return o.id; })
        .map(function (o) {
          return {
            id: String(o.id), nome: String(o.nome), curto: String(o.curto || o.nome),
            status: String(o.status || "ativa"),
            taxaAdm: numero(o.taxa_adm_pct) || 0,
            socios: cfgPorObra[String(o.id)] || {}
          };
        });

      var categorias = por.categorias.itens
        .filter(function (c) { return c.nome && booleano(c.ativa); })
        .map(function (c) {
          return { id: String(c.id), nome: String(c.nome).trim(), admPadrao: booleano(c.incide_adm_padrao) };
        });

      var fornecedores = por.fornecedores.itens
        .filter(function (f) { return f.nome_fantasia; })
        .map(function (f) {
          return {
            id: String(f.id), nome: String(f.nome_fantasia).trim(),
            razao: String(f.razao_social || ""), doc: String(f.cnpj_cpf || ""),
            contato: String(f.contato || ""), pagamento: String(f.pagamento || ""),
            endereco: String(f.endereco || ""), tipo: String(f.tipo || "")
          };
        });

      var dados = {
        transacoes: por.transacoes.itens.filter(function (t) { return t.id; }).map(montarTransacao),
        obras: obras, socios: socios, categorias: categorias, fornecedores: fornecedores,
        lidoEm: new Date().toISOString()
      };

      /* O que está na fila ainda não existe na planilha. Sem isto, um
         lançamento esperando para subir sumiria da tela na próxima abertura,
         como se nunca tivesse existido. */
      fila().forEach(function (item) {
        if (item.op !== "add" || !item.dados) return;
        var jaTem = dados.transacoes.some(function (t) { return t.id === item.dados.id; });
        if (jaTem) return;
        var copia = {};
        for (var k in item.dados) if (item.dados.hasOwnProperty(k)) copia[k] = item.dados[k];
        copia.naoEnviado = true;
        dados.transacoes.push(copia);
      });

      guardar(CHAVE_CACHE, dados);
      return dados;
  }

  function doCache() { return ler(CHAVE_CACHE, null); }

  /* ---------------------------------------------------------------- escrita */

  function paraLinha(t) {
    return [
      t.id, t.data, t.tipo, t.obra || "", t.pagante || "", t.recebedor || "",
      t.destinatario || "", t.descricao || "", t.categoria || "",
      (t.valor === null || t.valor === undefined || t.valor === "") ? "" : Number(t.valor),
      t.incideAdm ? "TRUE" : "FALSE", t.statusNf || "", t.observacao || "", t.origem || "app",
      t.recorrente || ""
    ];
  }

  function acrescentar(t) {
    if (!t.id) t.id = novoId();
    var url = urlPlanilha("/values/transacoes!A:O:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS");
    return chamar(url, { method: "POST", body: { values: [paraLinha(t)] } }).then(function (r) {
      /* Só damos por gravado quando a planilha confirma a linha escrita.
         Sem esta conferência, uma resposta vazia passava por sucesso. */
      var up = r && r.updates;
      if (!up || !up.updatedRows) throw new Error("A planilha não confirmou a gravação.");
      var faixa = up.updatedRange || "";
      var m = faixa.match(/!A(\d+)/);
      if (m) linhaDoId[t.id] = Number(m[1]);
      return t;
    });
  }

  function atualizar(t) {
    var linha = linhaDoId[t.id] || t._linha;
    if (!linha) return localizarLinha(t.id).then(function (l) {
      if (!l) throw new Error("Não achei esse lançamento na planilha.");
      linhaDoId[t.id] = l;
      return atualizar(t);
    });
    var url = urlPlanilha("/values/transacoes!A" + linha + ":O" + linha + "?valueInputOption=USER_ENTERED");
    return chamar(url, { method: "PUT", body: { values: [paraLinha(t)] } }).then(function () { return t; });
  }

  function localizarLinha(id) {
    return chamar(urlPlanilha("/values/transacoes!A:A")).then(function (r) {
      var v = r.values || [];
      for (var i = 1; i < v.length; i++) if (String(v[i][0]) === String(id)) return i + 1;
      return null;
    });
  }

  function idDaAba(nome) {
    if (idsDasAbas[nome]) return Promise.resolve(idsDasAbas[nome]);
    return chamar(urlPlanilha("?fields=sheets.properties")).then(function (r) {
      (r.sheets || []).forEach(function (s) {
        idsDasAbas[s.properties.title] = s.properties.sheetId;
      });
      return idsDasAbas[nome];
    });
  }

  function excluir(id) {
    var linha = linhaDoId[id];
    var p = linha ? Promise.resolve(linha) : localizarLinha(id);
    return p.then(function (l) {
      if (!l) throw new Error("Não achei esse lançamento na planilha.");
      return idDaAba("transacoes").then(function (sheetId) {
        return chamar(urlPlanilha(":batchUpdate"), {
          method: "POST",
          body: {
            requests: [{
              deleteDimension: {
                range: { sheetId: sheetId, dimension: "ROWS", startIndex: l - 1, endIndex: l }
              }
            }]
          }
        });
      });
    }).then(function () {
      // as linhas abaixo subiram uma posição
      delete linhaDoId[id];
      for (var k in linhaDoId) if (linhaDoId[k] > (linha || 0)) linhaDoId[k]--;
    });
  }

  /* ----------------------------------------------------- fila de pendências */

  function fila() { return ler(CHAVE_FILA, []); }
  function gravarFila(f) { guardar(CHAVE_FILA, f); }

  function enfileirar(op, dados) {
    var f = fila();
    f.push({ op: op, dados: dados, em: new Date().toISOString() });
    gravarFila(f);
    return f.length;
  }

  function temSinal() { return navigator.onLine !== false; }

  /* Executa uma operação: se houver internet, direto na planilha; se não,
     guarda na fila.

     Regra que vale para qualquer falha, seja de rede, de sessão expirada ou
     de resposta estranha do Google: o lançamento vai para a fila. Nunca se
     perde e nunca é dado por salvo sem a planilha ter confirmado. Antes, um
     erro que não fosse de rede descartava o lançamento. */
  function executar(op, t) {
    if (!temSinal()) {
      enfileirar(op, t);
      return Promise.resolve({ enfileirado: true, motivo: "sem internet agora" });
    }
    var p = op === "add" ? acrescentar(t) : (op === "update" ? atualizar(t) : excluir(t));
    return p.then(function (r) { return { enfileirado: false, resultado: r }; })
            .catch(function (e) {
              enfileirar(op, t);
              return { enfileirado: true, motivo: (e && e.message) || "não consegui gravar" };
            });
  }

  function sincronizar() {
    var f = fila();
    if (!f.length || !temSinal()) return Promise.resolve({ enviados: 0, restam: f.length });
    var enviados = 0;
    var seq = Promise.resolve();
    f.forEach(function (item) {
      seq = seq.then(function () {
        var p = item.op === "add" ? acrescentar(item.dados)
              : (item.op === "update" ? atualizar(item.dados) : excluir(item.dados));
        return p.then(function () { enviados++; });
      });
    });
    return seq.then(function () {
      gravarFila([]);
      return { enviados: enviados, restam: 0 };
    }).catch(function (e) {
      // o que já subiu sai da fila, o resto fica para a próxima
      gravarFila(fila().slice(enviados));
      throw e;
    });
  }

  /* ------------------------------------------------- primeira carga dos dados

     Na primeira vez, a planilha está vazia. Em vez de você criar seis abas e
     colar seis arquivos à mão, o próprio aplicativo monta tudo: cria as abas,
     ajusta a planilha para o Brasil e escreve o histórico migrado.
  */

  function estrutura() {
    return chamar(urlPlanilha("?fields=sheets.properties(sheetId,title)")).then(function (r) {
      var nomes = [];
      (r.sheets || []).forEach(function (s) {
        idsDasAbas[s.properties.title] = s.properties.sheetId;
        nomes.push(s.properties.title);
      });
      return nomes;
    });
  }

  function abasQueFaltam(existentes) {
    var precisa = ["transacoes", "obras", "obra_socios", "socios", "categorias", "fornecedores"];
    return precisa.filter(function (n) { return existentes.indexOf(n) === -1; });
  }

  /* Converte o texto de um .tsv em matriz, transformando em número as colunas
     que precisam ser número. Sem isso, "5020,76" poderia entrar como texto. */
  function tsvParaMatriz(texto, colunasNumericas) {
    var linhas = String(texto).replace(/\r/g, "").split("\n").filter(function (l) { return l.trim() !== ""; });
    if (!linhas.length) return [];
    var cab = linhas[0].split("\t");
    var idx = {};
    (colunasNumericas || []).forEach(function (c) {
      var p = cab.indexOf(c);
      if (p >= 0) idx[p] = true;
    });
    var saida = [cab];
    for (var i = 1; i < linhas.length; i++) {
      var campos = linhas[i].split("\t");
      var linha = [];
      for (var j = 0; j < cab.length; j++) {
        var v = campos[j] !== undefined ? campos[j] : "";
        if (idx[j] && v !== "") {
          var n = numero(v);
          linha.push(n === null ? v : n);
        } else {
          linha.push(v);
        }
      }
      saida.push(linha);
    }
    return saida;
  }

  var NUMERICAS = {
    transacoes:  ["valor"],
    obras:       ["taxa_adm_pct"],
    obra_socios: ["participacao_pct", "adm_share_pct"],
    socios: [], categorias: [], fornecedores: []
  };

  function importarHistorico(aoAndar) {
    var abas = ["transacoes", "obras", "obra_socios", "socios", "categorias", "fornecedores"];
    var conteudo = {};

    function avisar(msg) { if (aoAndar) aoAndar(msg); }

    /* Os .tsv do histórico NÃO vão mais no pacote publicado. Qualquer um que
       soubesse o endereço do site baixava três anos de lançamentos, valores e
       fornecedores sem precisar de login nenhum — eles ficavam soltos numa
       pasta pública. Ficam guardados só na pasta do projeto, e se um dia for
       preciso importar de novo, é só colocá-los de volta na pasta app antes de
       gerar o pacote. */
    avisar("Buscando os arquivos do histórico...");
    return Promise.all(abas.map(function (a) {
      return fetch("dados-iniciais/" + a + ".tsv").then(function (r) {
        if (!r.ok) {
          throw new Error("Os arquivos do histórico não estão publicados neste site — " +
                          "é de propósito, para ninguém baixá-los sem login. Para importar " +
                          "de novo, republique o site com a pasta dados-iniciais dentro.");
        }
        return r.text();
      }).then(function (t) { conteudo[a] = tsvParaMatriz(t, NUMERICAS[a]); });
    }))
    .then(estrutura)
    .then(function (existentes) {
      var faltam = abasQueFaltam(existentes);
      var pedidos = faltam.map(function (n) { return { addSheet: { properties: { title: n } } }; });
      // planilha no padrão brasileiro: vírgula decimal e fuso de São Paulo
      pedidos.push({
        updateSpreadsheetProperties: {
          properties: { locale: "pt_BR", timeZone: "America/Sao_Paulo" },
          fields: "locale,timeZone"
        }
      });
      // a aba solta que toda planilha nova traz vira o lugar da sua conferência
      var solta = existentes.filter(function (n) { return abasQueFaltam([n]).length === 6; })[0];
      if (solta && existentes.indexOf("conferencia") === -1 && idsDasAbas[solta] !== undefined) {
        pedidos.push({
          updateSheetProperties: {
            properties: { sheetId: idsDasAbas[solta], title: "conferencia" },
            fields: "title"
          }
        });
      }
      avisar("Criando as abas...");
      return chamar(urlPlanilha(":batchUpdate"), { method: "POST", body: { requests: pedidos } });
    })
    .then(function () {
      var seq = Promise.resolve();
      abas.forEach(function (a) {
        seq = seq.then(function () {
          avisar("Escrevendo " + a + " (" + (conteudo[a].length - 1) + " linhas)...");
          return chamar(urlPlanilha("/values/" + a + "!A1?valueInputOption=USER_ENTERED"),
                        { method: "PUT", body: { values: conteudo[a] } });
        });
      });
      return seq;
    })
    .then(function () {
      idsDasAbas = {};
      avisar("Pronto.");
      return true;
    });
  }

  /* ---------------------------------------------------------- cadastros */

  function acrescentarLinhaEm(aba, valores) {
    var url = urlPlanilha("/values/" + aba + "!A:Z:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS");
    return chamar(url, { method: "POST", body: { values: [valores] } });
  }

  /* Grava a linha da obra na aba `obras` — nome, apelido, situação e taxa.
     Localiza pela coluna do id, nunca pela posição. */
  function salvarObra(o) {
    return chamar(urlPlanilha("/values/obras!A:E")).then(function (r) {
      var v = r.values || [];
      var linha = -1;
      for (var i = 1; i < v.length; i++) {
        if (String(v[i][0]).trim() === String(o.id)) { linha = i + 1; break; }
      }
      var valores = [o.id, o.nome, o.curto, o.status || "ativa", o.taxaAdm];
      if (linha < 0) return acrescentarLinhaEm("obras", valores);
      return chamar(urlPlanilha("/values/obras!A" + linha + ":E" + linha + "?valueInputOption=USER_ENTERED"),
                    { method: "PUT", body: { values: [valores] } });
    });
  }

  function salvarObraSocios(obraId, cfgSocios) {
    // regrava o bloco daquela obra: apaga o que existe e acrescenta de novo
    return chamar(urlPlanilha("/values/obra_socios!A:E")).then(function (r) {
      var v = r.values || [];
      var restantes = [v[0] || ["obra","socio","participacao_pct","papel","adm_share_pct"]];
      for (var i = 1; i < v.length; i++) {
        if (String(v[i][0]).trim() !== String(obraId)) restantes.push(v[i]);
      }
      for (var s in cfgSocios) {
        if (!cfgSocios.hasOwnProperty(s)) continue;
        var c = cfgSocios[s];
        restantes.push([obraId, s, c.participacao, c.papel, c.admShare]);
      }
      return chamar(urlPlanilha("/values/obra_socios!A:E:clear"), { method: "POST", body: {} })
        .then(function () {
          return chamar(urlPlanilha("/values/obra_socios!A1?valueInputOption=USER_ENTERED"),
                        { method: "PUT", body: { values: restantes } });
        });
    });
  }

  global.Dados = {
    configurar: function (c) { cfg = c; },
    entrar: entrar,
    entrarSilencioso: entrarSilencioso,
    podeTentarSilencioso: podeTentarSilencioso,
    sair: sair,
    usuario: function () { return usuario; },
    jaEntrou: function () { return tokenValido(); },
    quemSou: quemSou,
    carregar: carregar,
    doCache: doCache,
    executar: executar,
    sincronizar: sincronizar,
    fila: fila,
    temSinal: temSinal,
    novoId: novoId,
    estrutura: estrutura,
    abasQueFaltam: abasQueFaltam,
    tsvParaMatriz: tsvParaMatriz,
    importarHistorico: importarHistorico,
    acrescentarLinhaEm: acrescentarLinhaEm,
    salvarObra: salvarObra,
    salvarObraSocios: salvarObraSocios,
    guardarCache: function (d) { guardar(CHAVE_CACHE, d); }
  };
})(window);
