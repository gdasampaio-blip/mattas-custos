/* ===========================================================================
   config.js — os três dados que ligam o aplicativo à sua planilha.

   Preencha aqui depois de fazer o passo a passo do PLANO.md (seção 5).
   Este arquivo não guarda senha nenhuma: o ID do cliente é público por
   natureza, e quem autoriza o acesso à planilha é você, no login do Google.
   =========================================================================== */

window.CONFIG = {

  // Passo 5.4 do plano: Google Cloud > Credenciais > ID do cliente OAuth.
  // Termina em .apps.googleusercontent.com
  clientId: "257493868802-3k5gee5r2q95i3dh0r6pncj46tg8najq.apps.googleusercontent.com",

  // O id da planilha aparece no meio do endereço dela:
  // https://docs.google.com/spreadsheets/d/ESTA_PARTE_AQUI/edit
  planilhaId: "1gm3Qm5sZiSHCMLEAhI0q6tx-o4LMo9av8fAQMXGiEh4",

  // Só estes e-mails conseguem entrar. Para liberar o Fabinho e a Maria
  // Helena um dia, basta acrescentar o e-mail Google deles nesta lista.
  emailsPermitidos: [
    "gdasampaio@gmail.com"
  ],

  // Endereço da planilha, para o botão "abrir a planilha" do aplicativo.
  // Deixe vazio para o aplicativo montar sozinho a partir do planilhaId.
  linkPlanilha: ""
};
