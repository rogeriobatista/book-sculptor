# Book Sculptor

Aplicativo **desktop local** de diagramação de livros para Windows e macOS.  
Abre em uma janela própria — sem precisar usar o navegador.

## Instalação (primeira vez)

```bash
pip install -r requirements.txt
```

No Windows 10/11, o app usa o WebView2 (já costuma vir instalado).  
No macOS, usa a WebKit nativa do sistema.

## Como usar

**Windows:** dois cliques em `iniciar.bat`  
**macOS:** dois cliques em `iniciar.command` (na primeira vez: botão direito → Abrir)

Ou no terminal:

```bash
python main.py
```

Isso abre a janela do Book Sculptor. Feche a janela para encerrar.

Se quiser abrir no navegador (opcional):

```bash
python main.py --browser
```

## O que faz

- Envia manuscritos **PDF** ou **Word (.docx)**
- Detecta capítulos automaticamente
- Ajusta formato, fonte, tamanho, margens, numeração e sumário
- Mostra **prévia tipográfica** página a página
- Exporta **Word**, **PDF** ou **EPUB** diagramados

### Modos

- **Livro inteiro** — um ou vários arquivos viram livro com título, sumário e capítulos
- **Capítulo** — um arquivo isolado é tratado só como conteúdo de capítulo

## Opções de diagramação

| Opção | Valores |
|-------|---------|
| Formato | Médio 14×21 · Padrão 15,5×23 · Bolso 11×18 · Técnico 21×29,7 |
| Fonte | Georgia · Literata · Garamond · Baskerville |
| Tamanho | 10–14 |
| Densidade | Compacto · Padrão · Espaçoso |
| Número de página | Externo · Centro · Sem |
| Sumário | Com / Sem |

## Dicas

- Vários arquivos na ordem = um capítulo por arquivo
- Nomeie como `01_titulo.docx`, `02_titulo.docx` para controlar a ordem
- Capítulos no texto como `Capítulo 1` / `Chapter 2` também são detectados

## Estrutura

```
book-sculptor/
├── main.py              # App desktop
├── iniciar.bat          # Atalho Windows
├── iniciar.command      # Atalho macOS
├── web/                 # Interface
├── app/
│   ├── server.py        # Motor interno
│   ├── layout.py
│   ├── preview.py
│   ├── project.py
│   ├── structure.py
│   ├── extractors/
│   └── exporters/
```
