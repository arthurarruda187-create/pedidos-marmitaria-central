// Service worker: faz o cardápio e o painel funcionarem como app no celular.
// Páginas e código: sempre tenta a versão nova da internet; sem internet, usa a última salva.
// Dados (pedidos, cardápio) nunca ficam guardados aqui: vêm sempre do Supabase.
const VERSAO = "app-v31";
const BASE = [
  "./", "./index.html", "./painel.html", "./painel.js", "./comum.js", "./config.js", "./app.js",
  "./cliente.webmanifest", "./painel.webmanifest",
  "./icones/cliente-192.png", "./icones/painel-192.png",
];

self.addEventListener("install", (e) => {
  // cache: "reload" = baixa do servidor de verdade (não do cache do navegador, que pode estar com a versão velha)
  e.waitUntil(caches.open(VERSAO).then((c) => c.addAll(BASE.map((u) => new Request(u, { cache: "reload" })))).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSAO).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // API do Supabase: nunca intercepta (pedidos sempre ao vivo)
  if (url.hostname.endsWith("supabase.co")) return;

  // bibliotecas e fontes externas: usa a cópia salva e atualiza por trás
  if (url.hostname === "cdn.jsdelivr.net" || url.hostname.endsWith("googleapis.com") || url.hostname.endsWith("gstatic.com")) {
    e.respondWith(caches.open(VERSAO).then(async (c) => {
      const salvo = await c.match(req);
      const novo = fetch(req).then((r) => { if (r.ok || r.type === "opaque") c.put(req, r.clone()); return r; }).catch(() => salvo);
      return salvo || novo;
    }));
    return;
  }

  if (url.origin !== location.origin) return;

  // arquivos do próprio site: internet primeiro; se a internet demorar mais de 2,5 s
  // (ou cair), usa a cópia salva — a versão nova fica guardada para a próxima abertura
  // "no-cache": sempre confere com o servidor se tem versão nova (resposta rápida quando não mudou)
  const daRede = fetch(req.url, { cache: "no-cache" }).then((r) => {
    if (r.ok) { const copia = r.clone(); caches.open(VERSAO).then((c) => c.put(req, copia)); }
    return r;
  });
  const salvo = () => caches.match(req, { ignoreSearch: req.mode === "navigate" })
    .then((x) => x || (req.mode === "navigate" ? caches.match(url.pathname.includes("painel") ? "./painel.html" : "./index.html") : null));
  e.respondWith(new Promise((ok) => {
    let feito = false;
    const fim = (r) => { if (!feito && r) { feito = true; ok(r); } };
    const t = setTimeout(() => salvo().then(fim), 2500);
    daRede.then((r) => { clearTimeout(t); fim(r); })
      .catch(() => { clearTimeout(t); salvo().then((x) => { fim(x || Response.error()); }); });
  }));
});
