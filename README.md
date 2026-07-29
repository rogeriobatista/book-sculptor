# Book Sculptor

Aplicativo simples para transformar arquivos **PDF** ou **Word** em livros bem formatados.

Não valida se o conteúdo está correto — apenas organiza o texto em estrutura de livro (título, sumário, capítulos e parágrafos).

## O que ele faz

**Modo arquivo:** escolhe um PDF ou Word e detecta capítulos dentro do documento.

**Modo pasta:** escolhe uma pasta com vários arquivos — **cada arquivo vira um capítulo** e o resultado é um livro completo.

O arquivo gerado inclui:
- Página de título
- Sumário
- Capítulos com quebra de página
- Texto justificado, tipografia de livro (Georgia) e margens adequadas

## Requisitos

- Python 3.10 ou superior
- Windows ou macOS

## Instalação (primeira vez)

Abra o Terminal (macOS) ou o Prompt de Comando / PowerShell (Windows) na pasta do projeto e execute:

```bash
pip install -r requirements.txt
```

## Como usar

**Windows:** dê dois cliques em `iniciar.bat`  
**macOS:** dê dois cliques em `iniciar.command` (na primeira vez, clique com o botão direito → Abrir)

Ou pelo terminal:

```bash
python main.py
```

### Arquivo único
1. Clique em **Escolher arquivo**
2. Clique em **Formatar**
3. Confira a estrutura e clique em **Salvar livro**

### Pasta com capítulos (um arquivo = um capítulo)
1. Coloque os capítulos numa pasta, por exemplo:
   ```
   Meu Livro/
     01_O Despertar.docx
     02_As Cartas.pdf
     03_O Encontro.docx
   ```
2. Clique em **Escolher pasta de capítulos**
3. Clique em **Formatar**
4. Salve o livro completo

A ordem dos capítulos segue o nome dos arquivos (ordenação natural: `2` antes de `10`).  
O título do livro vem do nome da pasta.

## Dicas

- Preferência por `.docx` em vez de `.doc` antigo
- No modo pasta, nomeie como `01_titulo.docx`, `02_titulo.docx` para controlar a ordem e o título
- No modo arquivo, capítulos como `Capítulo 1`, `Chapter 2`, `1. Título` são detectados com mais precisão
- Se nenhum capítulo for encontrado num arquivo único, o conteúdo vira um capítulo chamado “Conteúdo”

## Estrutura do projeto

```
book-sculptor/
├── main.py                 # Inicia o aplicativo
├── requirements.txt
├── app/
│   ├── gui.py              # Interface
│   ├── models.py           # Modelo do livro
│   ├── structure.py        # Detecção de capítulos / pasta
│   ├── extractors/         # Leitura de PDF e Word
│   └── exporters/          # Exportação DOCX e EPUB
```
