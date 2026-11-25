// Transforma a página em app instalável: registra o service worker e controla o botão "Instalar".
// Android/Chrome: usa o pedido de instalação do próprio navegador.
// iPhone/iPad (Safari): mostra o passo a passo "Compartilhar → Adicionar à Tela de Início".

let pedidoInstalacao = null;
let botoes = new Set();

export const rodandoComoApp = () =>
  matchMedia("(display-mode: standalone)").matches || matchMedia("(display-mode: fullscreen)").matches || navigator.standalone === true;
const ehIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

if ("serviceWorker" in navigator) {
  addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => {}));
}
addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); pedidoInstalacao = e; atualizar(); });
addEventListener("appinstalled", () => { pedidoInstalacao = null; atualizar(); });

const podeInstalar = () => !rodandoComoApp() && (!!pedidoInstalacao || ehIOS());

function atualizar() {
  for (const b of botoes) {
    if (!b.isConnected) { botoes.delete(b); continue; }
    b.classList.toggle("oculto", !podeInstalar());
  }
}

/** Liga um botão "Instalar app". Pode ser chamado de novo sempre que a tela for redesenhada. */
export function ligarBotaoInstalar(botao, nomeApp = "o app") {
  if (!botao) return;
  botoes.add(botao);
  botao.onclick = async () => {
    if (pedidoInstalacao) {
      pedidoInstalacao.prompt();
      const { outcome } = await pedidoInstalacao.userChoice;
      if (outcome === "accepted") pedidoInstalacao = null;
      atualizar();
    } else if (ehIOS()) {
      instrucoesIOS(nomeApp);
    }
  };
  atualizar();
}

function instrucoesIOS(nomeApp) {
  const f = document.createElement("div");
  f.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:999;display:flex;align-items:flex-end;justify-content:center;font-family:inherit";
  f.innerHTML = `<div style="background:#fff;color:#1c1c1e;width:100%;max-width:480px;border-radius:20px 20px 0 0;padding:1.4rem 1.3rem calc(1.4rem + env(safe-area-inset-bottom));box-shadow:0 -10px 30px rgba(0,0,0,.2)">
    <h3 style="margin:0 0 .3rem;font-size:1.15rem">Instalar ${nomeApp} no iPhone</h3>
    <p style="margin:0 0 1rem;color:#6e6e73;font-size:.92rem">Leva 10 segundos e o app fica na sua tela inicial:</p>
    <ol style="margin:0;padding-left:1.2rem;line-height:1.9;font-size:.98rem">
      <li>Toque em <b>Compartilhar</b> <span style="display:inline-grid;place-items:center;width:26px;height:26px;border-radius:7px;background:#f2f2f7;vertical-align:middle">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#0a84ff" stroke-width="2.4" stroke-linecap="round"><path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7M16 6l-4-4-4 4M12 2v13"/></svg></span> na barra do Safari</li>
      <li>Role e toque em <b>Adicionar à Tela de Início</b> ➕</li>
      <li>Toque em <b>Adicionar</b></li>
    </ol>
    <p style="margin:.9rem 0 0;color:#6e6e73;font-size:.82rem">Precisa estar aberto no <b>Safari</b>.</p>
    <button style="margin-top:1rem;width:100%;padding:.9rem;border:0;border-radius:12px;background:#1c1c1e;color:#fff;font-weight:700;font-size:1rem">Entendi</button></div>`;
  f.onclick = (e) => { if (e.target === f || e.target.tagName === "BUTTON") f.remove(); };
  document.body.appendChild(f);
}

// ---------- Tela sempre acesa (para o painel no celular/tablet da loja) ----------
let trava = null, querTrava = false;
export async function manterTelaAcesa(ligar) {
  querTrava = ligar;
  try {
    if (ligar && "wakeLock" in navigator && !trava) { trava = await navigator.wakeLock.request("screen"); trava.addEventListener("release", () => { trava = null; }); }
    if (!ligar && trava) { await trava.release(); trava = null; }
  } catch { /* navegador sem suporte: ignora */ }
}
document.addEventListener("visibilitychange", () => { if (!document.hidden && querTrava) manterTelaAcesa(true); });
