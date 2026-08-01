#!/bin/bash
cd "$(dirname "$0")"
echo "Iniciando Book Sculptor..."
if ! python3 main.py; then
  echo ""
  echo "Se faltarem dependências, execute:"
  echo "  pip3 install -r requirements.txt"
  read -r -p "Pressione Enter para fechar..."
fi
