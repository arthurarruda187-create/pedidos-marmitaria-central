#!/bin/sh
# Descobre o endereço público do túnel e avisa o painel: sempre que muda e a cada 5 minutos (sinal de vida).
ultimo=""; ultimo_ok=0
while true; do
  host=$(curl -s -m 5 http://tunel:2000/quicktunnel | sed -n 's/.*"hostname":"\([^"]*\)".*/\1/p')
  if [ -n "$host" ]; then
    agora=$(date +%s)
    if [ "$host" != "$ultimo" ] || [ $((agora - ultimo_ok)) -ge 300 ]; then
      cod=$(curl -s -m 20 -o /dev/null -w "%{http_code}" "https://$host/")
      if [ "$cod" = "200" ]; then
        r=$(curl -s -m 20 -X POST "$FUNCAO" -H "Content-Type: application/json" -H "apikey: $ANON" -H "Authorization: Bearer $ANON" \
          -d "{\"evo\":\"registrar\",\"url\":\"https://$host\",\"chave\":\"$CHAVE\"}")
        case "$r" in
          *'"ok":true'*) [ "$host" != "$ultimo" ] && echo "$(date '+%d/%m %H:%M') painel avisado: https://$host"; ultimo="$host"; ultimo_ok=$agora ;;
          *) echo "$(date '+%d/%m %H:%M') o painel recusou: $r" ;;
        esac
      else echo "$(date '+%d/%m %H:%M') esperando a Evolution responder pelo túnel ($cod)"; fi
    fi
  else echo "$(date '+%d/%m %H:%M') esperando o túnel"; fi
  sleep 30
done
