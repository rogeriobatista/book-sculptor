# Book Sculptor

Aplicativo simples para transformar arquivos **PDF** ou **Word** em livros bem formatados.

Não valida se o conteúdo está correto — apenas organiza o texto em estrutura de livro (título, sumário, capítulos e parágrafos).

## O que ele faz

Escolha o modo na tela:

**Capítulo** — um arquivo isolado é tratado só como conteúdo de capítulo (sem página de título nem sumário).

**Livro inteiro** — monta o livro completo:
- pasta com um arquivo por capítulo, ou
- um único arquivo que já contém vários capítulos

O livro gerado inclui página de título, sumário e capítulos formatados.
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

### Capítulo isolado
1. Selecione **Capítulo**
2. Clique em **Escolher arquivo do capítulo**
3. **Formatar** → **Salvar capítulo**

O resultado é só o capítulo formatado (título + texto), sem estrutura de livro.

### Livro inteiro (pasta)
1. Selecione **Livro inteiro**
2. Organize os capítulos numa pasta:
   ```
   Meu Livro/
     01_O Despertar.docx
     02_As Cartas.pdf
     03_O Encontro.docx
   ```
3. Clique em **Escolher pasta de capítulos**
4. **Formatar** → **Salvar livro**

### Livro inteiro (um arquivo)
1. Selecione **Livro inteiro**
2. Clique em **Ou um arquivo do livro**
3. **Formatar** → **Salvar livro**

A ordem dos capítulos na pasta segue o nome dos arquivos (ordenação natural: `2` antes de `10`).  
O título do livro vem do nome da pasta.

## Dicas

- Preferência por `.docx` em vez de `.doc` antigo
- No modo **Capítulo**, o arquivo inteiro vira conteúdo daquele capítulo
- No modo **Livro** com pasta, nomeie como `01_titulo.docx`, `02_titulo.docx` para ordem e título
- No modo **Livro** com um arquivo, capítulos como `Capítulo 1`, `Chapter 2`, `1. Título` são detectados com mais precisão

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
