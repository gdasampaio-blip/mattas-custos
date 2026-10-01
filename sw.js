/* ===========================================================================
   sw.js — o que faz o aplicativo abrir sem internet.

   Guarda uma cópia dos arquivos do próprio aplicativo (tela, estilo, código).
   Os dados não passam por aqui: quem cuida deles é o dados.js, com a cópia
   local da planilha e a fila de lançamentos.

   Ao publicar uma versão nova, troque o número da VERSAO abaixo — é isso que
   faz o celular buscar os arquivos novos em vez de usar os guardados.
   =========================================================================== */

var VERSAO = "mattas-v21";
var ARQUIVOS = [
  "./",
  "./index.html",
  "./config.js",
  "./css/estilo.css",
  "./js/calculo.js",
  "./js/dados.js",
  "./js/app.js",
  "./manifest.json",
  "./icone.svg"
];
/* Os .tsv do histórico saíram daqui junto com a pasta dados-iniciais: eles
   ficavam públicos no site, baixáveis por qualquer um sem login. */

self.addEventListener("install", function (e) {
  e.waitUntil(
    caches.open(VERSAO)
      .then(function (c) { return c.addAll(ARQUIVOS); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys()
      .then(function (nomes) {
        return Promise.all(nomes.map(function (n) {
          if (n !== VERSAO) return caches.delete(n);
        }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (e) {
  var url = e.request.url;

  // Nada do Google passa pelo cache: login e planilha são sempre ao vivo.
  if (url.indexOf("googleapis.com") > -1 ||
      url.indexOf("accounts.google.com") > -1 ||
      url.indexOf("gstatic.com") > -1) return;

  if (e.request.method !== "GET") return;

  // Rede primeiro, cache como rede de segurança: assim uma versão nova
  // chega assim que existe, mas o aplicativo abre mesmo sem sinal.
  e.respondWith(
    fetch(e.request)
      .then(function (r) {
        if (r && r.ok && r.type === "basic") {
          var copia = r.clone();
          caches.open(VERSAO).then(function (c) { c.put(e.request, copia); });
        }
        return r;
      })
      .catch(function () {
        return caches.match(e.request).then(function (c) {
          return c || caches.match("./index.html");
        });
      })
  );
});





