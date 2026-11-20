# PhotoView

Editor de imagens web no estilo Photoshop, feito com HTML, CSS e JavaScript puro (canvas). Não tem build nem dependências.

## Link
- Editor: https://evellengomes.github.io/photoview/
- Gerador de anúncio: https://evellengomes.github.io/photoview/anuncio/ (envie a sua foto de óculos com fundo branco)

## Como rodar
- Com o WAMP ligado: abra http://localhost/projetos/photoview/
- Ou qualquer servidor estático na pasta (ex.: `npx serve .`)

## O que já faz
- Bloqueio de camadas (botões no painel; Ctrl+/ bloqueia tudo): transparência (pinta só onde já há imagem), pixels (nenhuma ferramenta ou filtro altera), posição (não move nem transforma); vale para várias camadas selecionadas e entra no histórico e no projeto
- Formas vetoriais (U): retângulo (com canto arredondado), elipse, polígono, estrela e linha; arraste para desenhar (Shift = proporção ou 45°, Alt = a partir do centro); preenchimento e contorno editáveis depois (clique na forma com a ferramenta, duplo clique na miniatura ou Camada › Editar forma); mover e transformação livre mantêm a forma nítida
- Máscara de recorte (Ctrl+Alt+G ou Alt+clique na camada no painel): a camada só aparece onde a camada de baixo tem pixels (foto dentro de forma, texto ou logo); vale também para camadas de ajuste; a base com opacidade, modo e visibilidade comanda o conjunto
- Grupos de camadas (Ctrl+G agrupa; Ctrl/Shift+clique seleciona várias no painel; Ctrl+Shift+G desagrupa): pastas aninháveis que recolhem, com visibilidade e opacidade do grupo valendo para os filhos, arrastar para dentro/fora, mover, duplicar, excluir e mesclar o grupo
- Camadas: nova, duplicar, camada via cópia (Ctrl+J), excluir, mesclar abaixo, achatar, reordenar (arrastar), visibilidade, opacidade, 16 modos de mesclagem, renomear (duplo clique)
- Ferramentas: mover (camada ou seleção), letreiro retangular/elíptico, laço (L; mão livre ou poligonal, com os modos nova/adicionar/subtrair/interseção), seleção rápida (Shift+W; pinte dentro do objeto e a seleção cresce até as bordas), varinha mágica (tolerância, contígua, todas as camadas), pincel e borracha (tamanho, opacidade, dureza, pressão da caneta), carimbo (S; Alt+clique define a origem, alinhado, amostra da camada ou de todas), corretivo para manchas (J; só pintar sobre a mancha, a origem é escolhida sozinha), pincel corretivo (Shift+J; como o carimbo, mas ajusta a textura copiada à cor e luz do destino), lata de tinta (tolerância, contíguo), degradê linear/radial, conta-gotas, texto editável (clique num texto com a ferramenta Texto, duplo clique na miniatura ou Camada › Editar texto: conteúdo, fonte, tamanho, negrito e cor com prévia; mover e transformação livre mantêm o texto editável e nítido), mão, zoom
- Camadas de ajuste (não destrutivas, afetam tudo abaixo): curvas, níveis, brilho/contraste, matiz/saturação, preto e branco, inverter, sépia, limiar, posterizar; com máscara, opacidade e modo; duplo clique na miniatura reabre as opções; mesclar abaixo aplica o ajuste na camada de baixo
- Máscaras de camada: adicionar (revelar tudo, ocultar tudo ou a partir da seleção), pintar em preto/branco/cinza com pincel, borracha, degradê, lata de tinta e preencher; filtros e ajustes na máscara (ex.: desfoque para suavizar, Ctrl+I inverte); ativar/desativar (Shift+clique), carregar como seleção, aplicar, excluir; Ctrl+\ edita a máscara, Ctrl+2 o conteúdo
- Estilos de camada (não destrutivos, editáveis): sombra projetada, brilho externo, sombra interna, sobreposição de cor, sobreposição de degradê (linear, radial ou espelhado; ângulo, escala, inverter, duas cores e opacidade), cetim (sombreado suave e ondulado por dentro da forma: cor, opacidade, ângulo, distância, tamanho, inverter), chanfro e relevo (interno, externo ou relevo; suave ou cinzel; direção, profundidade, tamanho, ângulo da luz, cores e opacidades de realce e sombra) e traço (fora/centro/dentro); copiar/colar/limpar estilo; duplo clique na miniatura abre o diálogo
- Ajustes com pré-visualização: curvas (Ctrl+M; gráfico com histograma, canais RGB/R/G/B, predefinições), brilho/contraste, níveis, matiz/saturação, limiar, posterizar, inverter, dessaturar, sépia, tom automático
- Filtros: desfoque gaussiano, máscara de nitidez, ruído, pixelizar, relevo, detectar bordas
- Transformação livre (Editar › Transformação livre ou Ctrl+Alt+T): escalar pelos cantos mantendo a proporção (Shift solta, Alt a partir do centro), girar arrastando fora da caixa (Shift = 15°), mover, setas, espelhar, valores em % e graus; vale para a camada, a seleção ou a máscara; a máscara vinculada acompanha; imagens inseridas maiores que o documento entram reduzidas para caber
- Ferramenta Recortar (C): caixa com alças, regra dos terços, proporções (livre, original, 1:1, 4:5, 4:3, 3:2, 16:9, 9:16), girar caixa, endireitar (arrastar fora da caixa ou controle de ângulo; a caixa encolhe para não sobrar canto vazio), Enter aplica, Esc cancela
- Imagem: tamanho da imagem, tamanho da tela (com âncora), cortar na seleção, girar, espelhar
- Seleção: modos nova/adicionar (Shift)/subtrair (Alt)/interseção (Shift+Alt), inverter (Ctrl+Shift+I), refinar seleção (Ctrl+Alt+R: suavizar, expandir e contrair com prévia); pincel, filtros, preencher, mover e copiar respeitam a seleção
- Histórico com painel (até 40 passos), desfazer/refazer
- Abrir imagem, colar (Ctrl+V), arrastar arquivo, exportar PNG/JPEG/WebP, salvar/abrir projeto `.pview` com camadas

## Arquivos
- `index.html` – layout e menus
- `css/app.css` – tema escuro
- `js/app.js` – motor do editor (documento, camadas, ferramentas, histórico, UI)
- `js/filters.js` – filtros de pixel
