# Sistema de pedidos próprio — guia de instalação

Sistema de pedidos para **uma loja**, inspirado nas funções principais do Anota AI:

| Parte | O que faz |
|---|---|
| **Cardápio do cliente** (`site/index.html`) | Cliente abre o link, escolhe produtos e adicionais, informa entrega ou retirada, paga e acompanha o pedido. |
| **Pagamento** | Configurado para **cartão na maquininha**, **dinheiro** e **Pix enviado pela loja**: no painel, o botão "Enviar Pix" manda ao cliente pelo WhatsApp a chave Pix da loja e o valor exato do pedido; depois é só clicar em "Marcar pago". |
| **Pagamento online (opcional, desligado)** | Pix (QR Code + copia e cola) e cartão pelo Mercado Pago. O pedido só vai para a cozinha depois que o pagamento é **confirmado automaticamente**. Dinheiro e cartão na entrega também funcionam. |
| **Pedido no WhatsApp** | Depois de pedir, o cliente toca em "Enviar pedido no WhatsApp da loja" e a mensagem chega pronta (itens, endereço, total, pagamento, link de acompanhamento). No painel, o botão "WhatsApp" manda ao cliente o status do pedido. |
| **Painel da loja** (`site/painel.html`) | Pedidos em tempo real com campainha, em 3 colunas (Novos → Em preparo → Prontos/em entrega), impressão para impressora térmica de 80 mm, cancelamento com motivo, faturamento do dia, abrir/fechar a loja, cadastro do cardápio com fotos e adicionais, e configurações (taxa, pedido mínimo, formas de pagamento). |

Os preços são sempre recalculados no servidor: o cliente não consegue mudar o valor do pedido pelo navegador.

---

## O que você precisa (tudo tem plano gratuito para começar)

1. **Supabase** (banco de dados, login do painel e servidor) — https://supabase.com
2. **Mercado Pago** com conta da loja e **chave Pix cadastrada** — https://www.mercadopago.com.br/developers
3. **Netlify** (ou Vercel/Cloudflare Pages) para publicar o site — https://app.netlify.com
4. Um computador com **Node.js** instalado só para publicar as funções (passo 4).

---

## Passo a passo

### 1. Criar o banco de dados
1. No Supabase, crie um projeto (região: São Paulo).
2. Abra **SQL Editor → New query** e rode, nesta ordem: `supabase/schema.sql`, `supabase/migracao-01-pix-manual.sql` e `supabase/migracao-02-funcoes-anota.sql`.

### 2. Criar o login do painel
1. **Authentication → Users → Add user**: informe o e-mail e a senha de quem vai usar o painel (marque "Auto confirm").
2. No **SQL Editor**, rode (trocando o e-mail):
   ```sql
   insert into admins (user_id) select id from auth.users where email = 'dono@sualoja.com';
   ```
3. **Authentication → Sign In / Providers → Email**: desative **"Allow new users to sign up"**, para ninguém mais criar conta.

### 3. Configurar o Mercado Pago
1. Em **Suas integrações → Criar aplicação** (tipo: pagamentos online / Checkout API).
2. Copie o **Access Token** — primeiro o **de teste**, para os testes; depois o **de produção**.
3. Em **Webhooks** da aplicação: URL `https://SEU-PROJETO.supabase.co/functions/v1/webhook-mercadopago`, evento **Pagamentos**. Copie a **assinatura secreta**.

### 4. Publicar as funções do servidor
No computador, dentro da pasta do projeto:
```bash
npx supabase login
npx supabase link --project-ref SEU-PROJETO
npx supabase functions deploy criar-pedido --no-verify-jwt
npx supabase functions deploy webhook-mercadopago --no-verify-jwt
npx supabase secrets set \
  MP_ACCESS_TOKEN="seu-access-token" \
  MP_WEBHOOK_SECRET="sua-assinatura-secreta" \
  SITE_URL="https://seu-site.netlify.app" \
  EMAIL_PAGADOR_PADRAO="email-da-loja@exemplo.com"
```
(`SEU-PROJETO` é o código que aparece no endereço do projeto Supabase.)

### 5. Publicar o site
1. Edite `site/config.js` com a **Project URL** e a chave **anon public** (Supabase → Project Settings → API).
2. Em https://app.netlify.com/drop, arraste a pasta `site`. O Netlify gera o endereço (dá para trocar o nome ou usar domínio próprio).
3. Se o endereço for diferente do que você usou em `SITE_URL`, rode de novo o `secrets set` com o endereço certo.

### 6. Configurar a loja
1. Acesse `https://seu-site/painel.html` e entre.
2. Aba **Loja**: nome, WhatsApp que recebe pedidos (ex.: `5543999999999`), taxa de entrega, pedido mínimo, tempos e formas de pagamento.
3. Aba **Cardápio**: crie categorias e produtos, com fotos e grupos de adicionais (ex.: "Sabor" mín. 1 / máx. 1; "Extras" mín. 0 / máx. 5).

---

## Plano para os 7 dias

| Dia | O que fazer | Pronto quando |
|---|---|---|
| 1 | Criar contas (Supabase, Mercado Pago, Netlify). Passos 1, 2 e 5. | Painel abre e faz login; cardápio abre (vazio). |
| 2 | Cadastrar o cardápio inteiro, fotos e configurações da loja (passo 6). | Cardápio completo no celular. |
| 3 | Passos 3 e 4 com **credenciais de teste** do Mercado Pago. Testar Pix e cartão de teste. | Pedido Pix de teste cai no painel sozinho, com campainha. |
| 4 | Trocar para **credenciais de produção**. Fazer um pedido real de R$ 1 com Pix e estornar pelo Mercado Pago. | Dinheiro de verdade confirmado automaticamente. |
| 5 | Treino com a equipe: pedidos simulados, aceitar, imprimir, cancelar, WhatsApp, fechar/abrir loja. | Equipe usa sem ajuda. |
| 6 | Lançamento leve com clientes conhecidos; ajustar preços, textos e tempos. | 10+ pedidos reais sem problema. |
| 7 | Divulgar: link na bio do Instagram, no perfil e na mensagem automática do WhatsApp Business, QR Code no balcão. | Link no ar para todos. |

---

## No dia a dia
- Deixe o **painel aberto** num computador ou tablet da loja e clique em **"Ligar som"** toda vez que abrir o painel (o navegador exige um clique para liberar o som). Desative a suspensão de tela.
- Pedido Pix/cartão online só aparece em **Novos** depois de pago. Os que ainda não foram pagos ficam em "Aguardando pagamento online".
- Para cancelar um pedido que **já foi pago online**, faça também o estorno no painel do Mercado Pago.
- "Loja fechada" no topo do painel impede novos pedidos na hora.

## Funções da versão 2
- **Cardápio estilo app de delivery:** capa, logo, busca, categorias fixas no topo, carrossel de destaques, preço promocional riscado, sacola com quantidades, cupom e informações da loja (horários, bairros e taxas).
- **Taxa por bairro** (Entrega e horários). Sem bairros cadastrados, vale a taxa fixa.
- **Horário automático:** a loja abre e fecha sozinha; o botão do painel pausa quando precisar.
- **Cupons:** % de desconto, valor fixo ou frete grátis, com pedido mínimo, validade, limite de usos e "só na 1ª compra".
- **Pedido de balcão/telefone (PDV)** no painel.
- **Financeiro:** faturamento, ticket médio, taxas, descontos, Pix a confirmar, vendas por dia/hora, formas de pagamento, produtos mais vendidos, bairros, cupons e exportação para planilha.
- **Clientes:** histórico por WhatsApp, total gasto, quem voltou e quem sumiu.
- **Entregadores:** escolher quem leva cada pedido, mandar o endereço no WhatsApp do motoboy e ver entregas/taxas por entregador.

## O que ainda não tem (próximas versões)
- Robô que responde sozinho no WhatsApp (precisa da API oficial do WhatsApp Business, com aprovação da Meta e custo por conversa).
- Pedidos agendados, mesas/QR Code no salão, tela de cozinha separada e nota fiscal.

## Estrutura dos arquivos
```
supabase/schema.sql                     banco, regras de acesso e tempo real
supabase/functions/_shared/calculo.ts   cálculo e validação do pedido
supabase/functions/criar-pedido/        recebe o pedido e gera Pix/cartão
supabase/functions/webhook-mercadopago/ confirma o pagamento e libera o pedido
site/index.html                         cardápio do cliente
site/painel.html                        painel da loja
site/comum.js, estilo.css, config.js    código e visual compartilhados
```

## Versão 3 — pedidos dos apps de delivery (iFood, aiqfome, Keeta, 99Food)

1. No Supabase → SQL Editor, rode `supabase/migracao-03-apps-delivery.sql`.
2. Atualize a função `criar-pedido` (Edge Functions → criar-pedido → Code) com o arquivo de pacote único `criar-pedido-pacote-unico.ts` e clique em "Deploy updates".
3. Publique o site novo no Netlify (arraste o `site-netlify.zip`).

No painel, use **🧾 Lançar pedido** e escolha a origem (Balcão, iFood, aiqfome, Keeta ou 99Food).
Informe o nº do pedido no app (o sistema impede lançar o mesmo número duas vezes) e, se quiser, o valor cobrado no app.
Os pedidos aparecem no mesmo quadro, com selo colorido do app, e o Financeiro separa o faturamento por canal.

## Versão 4 — taxa por raio, bairros de Apucarana e novas funções

Publicar:
1. Supabase → SQL Editor: rode `supabase/migracao-04-raio-e-funcoes.sql` e depois `dados/bairros-apucarana.sql` (213 bairros; distritos e área rural entram desativados).
2. Atualize a função `criar-pedido` com `criar-pedido-pacote-unico.ts` → "Deploy updates".
3. Publique o `site-netlify.zip` no Netlify.
4. No painel → **Entrega e horários**: escolha "Por raio", confira as faixas, salve e clique em **📏 Calcular distâncias** (uns 4–5 min, com a tela aberta). Bairros que o mapa não achar ficam sem km: marque "só os sem km" e digite o km.

Novidades:
- **Taxa por bairro ou por raio**: faixas de km editáveis; bairro acima da última faixa aparece como "fora da área". No modo bairro, taxa própria vazia = usa a faixa.
- **Peça também**: marque "Sugerir na sacola" no produto.
- **Pedir de novo**: o cliente vê o último pedido no topo do cardápio e repete com um toque (endereço já salvo no celular).
- **Impressão automática**: botão 🖨 na tela de Pedidos (por aparelho): ao chegar ou ao aceitar.
  Para imprimir sem a janela de confirmação, crie um atalho do Chrome com `--kiosk-printing` no fim do destino.
- **Tempo de entrega**: botão ⏱ na tela de Pedidos muda o tempo mostrado no cardápio.
- **Avaliação**: depois de entregue, o cliente dá estrelas na página do pedido; veja em ⭐ Avaliações.
- **Pedido na mesa**: 🍽️ Mesas (QR Code) — ative, escolha quantas mesas e imprima os QR Codes.
- **Campanha cliente sumido**: em Clientes, ligue "mostrar só os sumidos", escolha os dias e envie a mensagem com cupom pelo WhatsApp.

## WhatsApp automático (Z-API)

1. Supabase → SQL Editor: rode `supabase/migracao-07-whatsapp-auto.sql` (e antes, se ainda não rodou, a `migracao-06-logo-impressao.sql`).
2. Supabase → Edge Functions → "Deploy a new function" → "Via editor" → nome **avisar-whatsapp** → cole `supabase/functions/avisar-whatsapp/index.ts` → Deploy.
3. Publique o site (`site-netlify.zip`) no Netlify.
4. Painel → 💬 WhatsApp automático: crie a instância na z-api.io, leia o QR Code com o WhatsApp da loja, cole ID, Token e Client-Token, salve, faça o teste e ligue o envio.
