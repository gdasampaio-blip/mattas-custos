/* ===========================================================================
   calculo.js — as regras de negócio da Mattas, num lugar só.

   Nada aqui toca a tela nem a planilha: entram os dados, saem os números.
   É a mesma lógica conferida na migração contra a planilha R3P.
   =========================================================================== */

(function (global) {
  "use strict";

  /* Fração de um sócio numa obra.
     Dividimos pela soma dos percentuais da obra em vez de usar o percentual
     cru: assim três sócios com 33,3333 cada valem exatamente um terço, e não
     sobra centavo para ninguém no fim do mês. */
  function fracao(cfgObra, socioId) {
    var soma = 0, meu = 0;
    for (var id in cfgObra) {
      if (!cfgObra.hasOwnProperty(id)) continue;
      var p = Number(cfgObra[id].participacao) || 0;
      soma += p;
      if (id === socioId) meu = p;
    }
    return soma > 0 ? meu / soma : 0;
  }

  /* Quanto cada investidor paga da taxa de ADM da obra: proporcional à
     participação dele entre os investidores daquela obra. */
  function fracaoEntreInvestidores(cfgObra, socioId) {
    var soma = 0, meu = 0;
    for (var id in cfgObra) {
      if (!cfgObra.hasOwnProperty(id)) continue;
      if (cfgObra[id].papel !== "investidor") continue;
      var p = Number(cfgObra[id].participacao) || 0;
      soma += p;
      if (id === socioId) meu = p;
    }
    return soma > 0 ? meu / soma : 0;
  }

  /* Um lançamento só conta quando tem valor. Sem valor é compromisso
     futuro: fica registrado, mas fora de tudo que é dinheiro. */
  function conta(t) {
    return t && t.valor !== null && t.valor !== undefined && t.valor !== "" && Number(t.valor) !== 0;
  }
  function val(t) { return Number(t.valor) || 0; }

  /* --------------------------------------------------------------------- */

  function apurar(dados) {
    var transacoes = dados.transacoes || [];
    var obras = dados.obras || [];
    var socios = dados.socios || [];

    var custo = {};        // por obra: despesas − receitas
    var baseAdm = {};      // por obra: despesas com incidência
    var admObra = {};      // por obra: valor da taxa
    var pago = {};         // por sócio
    var cota = {};         // por sócio
    var pendentes = [];    // lançamentos sem valor

    obras.forEach(function (o) { custo[o.id] = 0; baseAdm[o.id] = 0; admObra[o.id] = 0; });
    socios.forEach(function (s) { pago[s.id] = 0; cota[s.id] = 0; });

    function cfgDe(obraId) {
      for (var i = 0; i < obras.length; i++) if (obras[i].id === obraId) return obras[i].socios || {};
      return {};
    }
    function taxaDe(obraId) {
      for (var i = 0; i < obras.length; i++) if (obras[i].id === obraId) return Number(obras[i].taxaAdm) || 0;
      return 0;
    }

    transacoes.forEach(function (t) {
      if (!conta(t)) { if (t.tipo !== "acerto") pendentes.push(t); return; }
      var v = val(t);

      if (t.tipo === "acerto") {
        if (pago[t.pagante] !== undefined) pago[t.pagante] += v;
        if (pago[t.recebedor] !== undefined) pago[t.recebedor] -= v;
        return;
      }

      if (custo[t.obra] === undefined) return;   // obra desconhecida: ignora

      if (t.tipo === "receita") {
        custo[t.obra] -= v;
        var cfgR = cfgDe(t.obra);
        for (var id in cfgR) {
          if (!cfgR.hasOwnProperty(id)) continue;
          if (pago[id] !== undefined) pago[id] -= v * fracao(cfgR, id);
        }
        return;
      }

      // despesa
      custo[t.obra] += v;
      if (pago[t.pagante] !== undefined) pago[t.pagante] += v;
      if (t.incideAdm) baseAdm[t.obra] += v;
    });

    // taxa de ADM: os investidores pagam, os atuadores recebem.
    // Não é despesa da obra — é transferência entre sócios, então não entra
    // no custo nem volta a ser rateada.
    obras.forEach(function (o) {
      var adm = baseAdm[o.id] * taxaDe(o.id) / 100;
      admObra[o.id] = adm;
      if (!adm) return;
      var cfg = o.socios || {};
      for (var id in cfg) {
        if (!cfg.hasOwnProperty(id)) continue;
        if (pago[id] === undefined) continue;
        if (cfg[id].papel === "investidor") {
          pago[id] -= adm * fracaoEntreInvestidores(cfg, id);
        } else if (cfg[id].papel === "atuador") {
          pago[id] += adm * (Number(cfg[id].admShare) || 0) / 100;
        }
      }
    });

    // cota de cada sócio = sua fatia do custo de cada obra
    obras.forEach(function (o) {
      var cfg = o.socios || {};
      for (var id in cfg) {
        if (!cfg.hasOwnProperty(id)) continue;
        if (cota[id] !== undefined) cota[id] += custo[o.id] * fracao(cfg, id);
      }
    });

    var saldos = socios.map(function (s) {
      return {
        socio: s.id,
        nome: s.nome,
        pago: pago[s.id] || 0,
        cota: cota[s.id] || 0,
        saldo: (cota[s.id] || 0) - (pago[s.id] || 0)   // positivo = deve
      };
    });

    var custoTotal = 0, baseTotal = 0, admTotal = 0;
    obras.forEach(function (o) {
      custoTotal += custo[o.id];
      baseTotal += baseAdm[o.id];
      admTotal += admObra[o.id];
    });

    return {
      custoPorObra: custo,
      basePorObra: baseAdm,
      admPorObra: admObra,
      custoTotal: custoTotal,
      baseAdmTotal: baseTotal,
      admTotal: admTotal,
      saldos: saldos,
      pendentes: pendentes
    };
  }

  /* Quem paga quanto para quem, para fechar o mês com o menor número de
     transferências possível: os devedores pagam os credores, do maior para
     o menor, até zerar. */
  function acertosSugeridos(saldos) {
    var devem = saldos.filter(function (s) { return s.saldo > 0.005; })
                      .map(function (s) { return { id: s.socio, nome: s.nome, v: s.saldo }; })
                      .sort(function (a, b) { return b.v - a.v; });
    var recebem = saldos.filter(function (s) { return s.saldo < -0.005; })
                        .map(function (s) { return { id: s.socio, nome: s.nome, v: -s.saldo }; })
                        .sort(function (a, b) { return b.v - a.v; });
    var lista = [];
    var i = 0, j = 0;
    while (i < devem.length && j < recebem.length) {
      var v = Math.min(devem[i].v, recebem[j].v);
      lista.push({ de: devem[i].nome, para: recebem[j].nome, valor: v });
      devem[i].v -= v;
      recebem[j].v -= v;
      if (devem[i].v < 0.005) i++;
      if (recebem[j].v < 0.005) j++;
    }
    return lista;
  }

  /* Soma de um conjunto de lançamentos, do jeito que o painel mostra:
     despesa soma, receita subtrai, acerto não conta. */
  function somaDeCaixa(transacoes) {
    var s = 0;
    (transacoes || []).forEach(function (t) {
      if (!conta(t) || t.tipo === "acerto") return;
      s += (t.tipo === "receita" ? -1 : 1) * val(t);
    });
    return s;
  }

  global.Calculo = {
    apurar: apurar,
    acertosSugeridos: acertosSugeridos,
    somaDeCaixa: somaDeCaixa,
    fracao: fracao,
    temValor: conta
  };
})(window);
