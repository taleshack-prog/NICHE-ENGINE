# Fonte da capa

`Poppins-Bold.ttf` é usada por `src/lib/capa.ts` para escrever o `coverText` na
imagem.

Vai **versionada no repositório** de propósito. Depender das fontes instaladas no
sistema significaria capa diferente em cada máquina — e, numa máquina sem a
família pedida, texto renderizado em retângulos vazios **sem erro nenhum**. Falha
silenciosa em imagem é a pior espécie: só aparece depois de publicada.

Para usar outra tipografia, aponte `CAPA_FONTE` no `.env` para um `.ttf` ou
`.otf`. Prefira um peso Bold ou mais pesado: capa de Reel é lida em miniatura.

## Licença

Poppins — Copyright 2020 The Poppins Project Authors
(https://github.com/itfoundry/Poppins), licenciada sob a **SIL Open Font License
1.1**. Texto completo em https://openfontlicense.org.

A OFL permite redistribuição junto com software. As condições que valem aqui:
manter este aviso de copyright, não vender a fonte isoladamente e não usar os
nomes reservados da fonte para promover trabalhos derivados.
