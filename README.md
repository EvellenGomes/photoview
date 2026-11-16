# PhotoView

Editor de imagens web no estilo Photoshop, feito com HTML, CSS e JavaScript puro (canvas). Não tem build nem dependências.

## Link
- Editor: https://evellengomes.github.io/photoview/
- Gerador de anúncio: https://evellengomes.github.io/photoview/anuncio/ (envie a sua foto de óculos com fundo branco)

## Como rodar
- Com o WAMP ligado: abra http://localhost/projetos/photoview/
- Ou qualquer servidor estático na pasta (ex.: `npx serve .`)

## O que já faz
- Camadas: nova, duplicar, camada via cópia (Ctrl+J), excluir, mesclar abaixo, achatar, reordenar (arrastar), visibilidade, opacidade, 16 modos de mesclagem, renomear (duplo clique)
- Ferramentas: mover (camada ou seleção), letreiro retangular/elíptico, varinha mágica (tolerância, contígua, todas as camadas), pincel e borracha (tamanho, opacidade, dureza, pressão da caneta), carimbo (S; Alt+clique define a origem, alinhado, amostra da camada ou de todas), corretivo para manchas (J; só pintar sobre a mancha, a origem é escolhida sozinha), pincel corretivo (Shift+J; como o carimbo, mas ajusta a textura copiada à cor e luz do destino), lata de tinta (tolerância, contíguo), degradê linear/radial, conta-gotas, texto, mão, zoom
- Camadas de ajuste (não destrutivas, afetam tudo abaixo): curvas, níveis, brilho/contraste, matiz/saturação, preto e branco, inverter, sépia, limiar, posterizar; com máscara, opacidade e modo; duplo clique na miniatura reabre as opções; mesclar abaixo aplica o ajuste na camada de baixo
- Máscaras de camada: adicionar (revelar tudo, ocultar tudo ou a partir da seleção), pintar em preto/branco/cinza com pincel, borracha, degradê, lata de tinta e preencher; filtros e ajustes na máscara (ex.: desfoque para suavizar, Ctrl+I inverte); ativar/desativar (Shift+clique), carregar como seleção, aplicar, excluir; Ctrl+\ edita a máscara, Ctrl+2 o conteúdo
- Estilos de camada (não destrutivos, editáveis): sombra projetada, brilho externo, sombra interna, sobreposição de cor e traço (fora/centro/dentro); copiar/colar/limpar estilo; duplo clique na miniatura abre o diálogo
- Ajustes com pré-visualização: curvas (Ctrl+M; gráfico com histograma, canais RGB/R/G/B, predefinições), brilho/contraste, níveis, matiz/saturação, limiar, posterizar, inverter, dessaturar, sépia, tom automático
- Filtros: desfoque gaussiano, máscara de nitidez, ruído, pixelizar, relevo, detectar bordas
- Transformação livre (Editar › Transformação livre ou Ctrl+Alt+T): escalar pelos cantos mantendo a proporção (Shift solta, Alt a partir do centro), girar arrastando fora da caixa (Shift = 15°), mover, setas, espelhar, valores em % e graus; vale para a camada, a seleção ou a máscara; a máscara vinculada acompanha; imagens inseridas maiores que o documento entram reduzidas para caber
- Ferramenta Recortar (C): caixa com alças, regra dos terços, proporções (livre, original, 1:1, 4:5, 4:3, 3:2, 16:9, 9:16), girar caixa, endireitar (arrastar fora da caixa ou controle de ângulo; a caixa encolhe para não sobrar canto vazio), Enter aplica, Esc cancela
- Imagem: tamanho da imagem, tamanho da tela (com âncora), cortar na seleção, girar, espelhar
- Seleção: modos nova/adicionar (Shift)/subtrair (Alt)/interseção (Shift+Alt), inverter (Ctrl+Shift+I); pincel, filtros, preencher, mover e copiar respeitam a seleção
- Histórico com painel (até 40 passos), desfazer/refazer
- Abrir imagem, colar (Ctrl+V), arrastar arquivo, exportar PNG/JPEG/WebP, salvar/abrir projeto `.pview` com camadas

## Arquivos
- `index.html` – layout e menus
- `css/app.css` – tema escuro
- `js/app.js` – motor do editor (documento, camadas, ferramentas, histórico, UI)
- `js/filters.js` – filtros de pixel
