#!/bin/bash

echo "╔════════════════════════════════════════════════╗"
echo "║    🎉 TERMICHAT 2.0 - INSTALLAZIONE RAPIDA    ║"
echo "╚════════════════════════════════════════════════╝"
echo ""

# Verifica Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Node.js non trovato!"
    echo ""
    echo "Installalo con:"
    echo "  Mac: brew install node"
    echo "  Linux: sudo apt install nodejs npm"
    echo "  Windows: https://nodejs.org"
    exit 1
fi

echo "✅ Node.js trovato: $(node --version)"
echo "✅ npm trovato: $(npm --version)"
echo ""

# Installa dipendenze
echo "📦 Installazione dipendenze..."
npm install

if [ $? -ne 0 ]; then
    echo "❌ Errore installazione dipendenze"
    exit 1
fi

echo ""
echo "✅ Installazione completata!"
echo ""
echo "╔════════════════════════════════════════════════╗"
echo "║              🚀 PROSSIMI PASSI                 ║"
echo "╚════════════════════════════════════════════════╝"
echo ""
echo "1️⃣  Avvia il server:"
echo "    npm start"
echo ""
echo "2️⃣  In un altro terminale, connettiti:"
echo "    npm run client"
echo ""
echo "3️⃣  Per connessioni remote con ngrok:"
echo "    brew install ngrok    # Mac"
echo "    ngrok http 3000"
echo ""
echo "📚 Leggi README.md per maggiori dettagli"
echo ""
echo "Buon chat! 🎉🔐"
