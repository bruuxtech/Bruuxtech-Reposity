#!/usr/bin/env node

const io = require('socket.io-client');
const readline = require('readline');
const axios = require('axios');
const chalk = require('chalk');
const crypto = require('crypto');

// ═══════════════════════════════════════════════════════════
// 🔐 CRITTOGRAFIA END-TO-END AES-256-GCM
// ═══════════════════════════════════════════════════════════

class E2EEncryption {
  constructor(partyCode) {
    // Genera chiave di sessione dal party code
    this.key = crypto.scryptSync(partyCode, 'termichat-salt-v2', 32);
  }
  
  encrypt(text) {
    try {
      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipheriv('aes-256-gcm', this.key, iv);
      
      let encrypted = cipher.update(text, 'utf8', 'hex');
      encrypted += cipher.final('hex');
      
      const authTag = cipher.getAuthTag();
      
      return {
        encrypted,
        iv: iv.toString('hex'),
        authTag: authTag.toString('hex')
      };
    } catch (error) {
      console.error('Errore crittografia:', error);
      return null;
    }
  }
  
  decrypt(encryptedData) {
    try {
      const { encrypted, iv, authTag } = encryptedData;
      
      const decipher = crypto.createDecipheriv(
        'aes-256-gcm',
        this.key,
        Buffer.from(iv, 'hex')
      );
      
      decipher.setAuthTag(Buffer.from(authTag, 'hex'));
      
      let decrypted = decipher.update(encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      
      return decrypted;
    } catch (error) {
      return '[Messaggio corrotto o chiave errata]';
    }
  }
  
  encryptToString(text) {
    const encrypted = this.encrypt(text);
    if (!encrypted) return null;
    return JSON.stringify(encrypted);
  }
  
  decryptFromString(encryptedString) {
    try {
      const encryptedData = JSON.parse(encryptedString);
      return this.decrypt(encryptedData);
    } catch (error) {
      return '[Messaggio non valido]';
    }
  }
}

// ═══════════════════════════════════════════════════════════

const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3000';
let socket = null;
let sessionToken = null;
let username = null;
let partyCode = null;
let encryption = null;
let isHost = false;

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: ''
});

function printBanner() {
  console.clear();
  console.log(chalk.cyan('╔══════════════════════════════════════════════╗'));
  console.log(chalk.cyan('║       🎉 TERMICHAT 2.0 - PARTY CHAT         ║'));
  console.log(chalk.cyan('║       🔐 Crittografia E2E AES-256-GCM       ║'));
  console.log(chalk.cyan('╚══════════════════════════════════════════════╝'));
  console.log('');
}

function question(query) {
  return new Promise(resolve => {
    rl.question(query, resolve);
  });
}

async function showMainMenu() {
  printBanner();
  
  console.log(chalk.yellow('Cosa vuoi fare?\n'));
  console.log(chalk.green('1') + ' - Crea un nuovo party');
  console.log(chalk.blue('2') + ' - Unisciti a un party');
  console.log(chalk.red('3') + ' - Esci\n');
  
  const choice = await question(chalk.cyan('Scelta: '));
  return choice.trim();
}

async function createParty() {
  console.log('');
  console.log(chalk.yellow('═══ CREA NUOVO PARTY ═══\n'));
  
  partyCode = await question(chalk.cyan('🔑 Scegli un codice per il party (4-32 caratteri): '));
  
  if (!partyCode || partyCode.length < 4) {
    console.log(chalk.red('❌ Codice troppo corto (minimo 4 caratteri)'));
    return false;
  }
  
  username = await question(chalk.cyan('👤 Scegli il tuo username: '));
  
  if (!username || username.length < 3) {
    console.log(chalk.red('❌ Username troppo corto (minimo 3 caratteri)'));
    return false;
  }
  
  try {
    console.log(chalk.gray('\nCreazione party...'));
    
    const response = await axios.post(`${SERVER_URL}/api/party/create`, {
      partyCode,
      username
    });
    
    sessionToken = response.data.sessionToken;
    isHost = true;
    
    // Inizializza crittografia
    encryption = new E2EEncryption(partyCode);
    
    console.log(chalk.green('\n✅ Party creato con successo!'));
    console.log(chalk.yellow(`\n📋 Codice party: ${chalk.bold(partyCode)}`));
    console.log(chalk.gray('Condividi questo codice con i tuoi amici!\n'));
    
    return true;
    
  } catch (error) {
    if (error.response) {
      console.log(chalk.red(`\n❌ Errore: ${error.response.data.error}`));
    } else {
      console.log(chalk.red('\n❌ Impossibile connettersi al server'));
    }
    return false;
  }
}

async function joinParty() {
  console.log('');
  console.log(chalk.yellow('═══ UNISCITI A UN PARTY ═══\n'));
  
  partyCode = await question(chalk.cyan('🔑 Inserisci il codice del party: '));
  
  if (!partyCode) {
    console.log(chalk.red('❌ Codice richiesto'));
    return false;
  }
  
  username = await question(chalk.cyan('👤 Scegli il tuo username: '));
  
  if (!username || username.length < 3) {
    console.log(chalk.red('❌ Username troppo corto (minimo 3 caratteri)'));
    return false;
  }
  
  try {
    console.log(chalk.gray('\nAccesso al party...'));
    
    const response = await axios.post(`${SERVER_URL}/api/party/join`, {
      partyCode,
      username
    });
    
    sessionToken = response.data.sessionToken;
    isHost = false;
    
    // Inizializza crittografia
    encryption = new E2EEncryption(partyCode);
    
    console.log(chalk.green('\n✅ Accesso consentito!'));
    console.log(chalk.gray('Connessione al party...\n'));
    
    return true;
    
  } catch (error) {
    if (error.response) {
      console.log(chalk.red(`\n❌ Errore: ${error.response.data.error}`));
    } else {
      console.log(chalk.red('\n❌ Impossibile connettersi al server'));
    }
    return false;
  }
}

function formatTime(timestamp) {
  const date = new Date(timestamp);
  return date.toLocaleTimeString('it-IT', { 
    hour: '2-digit', 
    minute: '2-digit',
    second: '2-digit'
  });
}

function displayMessage(message) {
  if (message.type === 'system') {
    console.log(chalk.gray(`[${formatTime(message.timestamp)}] `) + 
                chalk.yellow(`ℹ ${message.content}`));
  } else {
    const isMe = message.username === username;
    const color = isMe ? chalk.green : chalk.blue;
    const prefix = isMe ? 'Tu' : message.username;
    
    // Decripta messaggio
    let content = message.encryptedContent;
    if (encryption && content) {
      content = encryption.decryptFromString(content);
    }
    
    console.log(chalk.gray(`[${formatTime(message.timestamp)}] `) + 
                color(`${prefix}: `) + 
                content);
  }
}

function connectToChat() {
  socket = io(SERVER_URL, {
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    reconnectionAttempts: 5
  });
  
  socket.on('connect', () => {
    socket.emit('authenticate', { sessionToken });
  });
  
  socket.on('auth-success', (data) => {
    console.log(chalk.green(`✅ Connesso come ${data.username}`));
    console.log(chalk.green(`🔐 Crittografia AES-256-GCM attiva`));
    console.log(chalk.yellow(`🎉 Party: ${partyCode}`));
    if (data.isHost) {
      console.log(chalk.magenta('👑 Sei l\'host del party'));
    }
    console.log(chalk.gray('\nComandi:'));
    console.log(chalk.gray('  Scrivi e premi INVIO per inviare'));
    console.log(chalk.gray('  /quit - Esci dal party'));
    console.log(chalk.gray('  /users - Vedi utenti online\n'));
    
    rl.setPrompt(chalk.green('> '));
    rl.prompt();
  });
  
  socket.on('auth-error', (data) => {
    console.log(chalk.red(`\n❌ Errore autenticazione: ${data.message}`));
    process.exit(1);
  });
  
  socket.on('message-history', (messages) => {
    if (messages.length > 0) {
      console.log(chalk.gray('\n─── Messaggi recenti ───'));
      messages.forEach(displayMessage);
      console.log(chalk.gray('─── Fine ───\n'));
    }
  });
  
  socket.on('message', (message) => {
    readline.clearLine(process.stdout, 0);
    readline.cursorTo(process.stdout, 0);
    
    displayMessage(message);
    rl.prompt();
  });
  
  socket.on('users-update', (data) => {
    // Notifica silenziosa - disponibile con comando /users
  });
  
  socket.on('disconnect', () => {
    console.log(chalk.red('\n❌ Disconnesso dal server'));
    console.log(chalk.yellow('Tentativo di riconnessione...'));
  });
  
  socket.on('reconnect', () => {
    console.log(chalk.green('✅ Riconnesso!'));
    socket.emit('authenticate', { sessionToken });
  });
  
  socket.on('error', (data) => {
    console.log(chalk.red(`❌ Errore: ${data.message}`));
  });
}

rl.on('line', async (line) => {
  const input = line.trim();
  
  if (!input) {
    rl.prompt();
    return;
  }
  
  // Comandi
  if (input.startsWith('/')) {
    const command = input.toLowerCase();
    
    if (command === '/quit' || command === '/exit') {
      console.log(chalk.yellow('\n👋 Arrivederci!'));
      process.exit(0);
    }
    
    if (command === '/users') {
      socket.emit('request-users');
      rl.prompt();
      return;
    }
    
    console.log(chalk.red('Comando non riconosciuto'));
    rl.prompt();
    return;
  }
  
  // Invia messaggio criptato
  if (socket && socket.connected && encryption) {
    const encrypted = encryption.encryptToString(input);
    
    if (encrypted) {
      socket.emit('send-message', { encryptedContent: encrypted });
    } else {
      console.log(chalk.red('❌ Errore crittografia messaggio'));
    }
  }
  
  rl.prompt();
});

async function main() {
  try {
    const choice = await showMainMenu();
    
    if (choice === '1') {
      const success = await createParty();
      if (!success) {
        setTimeout(() => main(), 2000);
        return;
      }
    } else if (choice === '2') {
      const success = await joinParty();
      if (!success) {
        setTimeout(() => main(), 2000);
        return;
      }
    } else if (choice === '3') {
      console.log(chalk.yellow('\n👋 Arrivederci!'));
      process.exit(0);
    } else {
      console.log(chalk.red('\n❌ Scelta non valida'));
      setTimeout(() => main(), 2000);
      return;
    }
    
    // Connetti alla chat
    connectToChat();
    
  } catch (error) {
    console.log(chalk.red(`\n❌ Errore: ${error.message}`));
    process.exit(1);
  }
}

process.on('SIGINT', () => {
  console.log(chalk.yellow('\n\n👋 Arrivederci!'));
  process.exit(0);
});

process.on('uncaughtException', (error) => {
  console.error(chalk.red('\n❌ Errore critico:'), error.message);
  process.exit(1);
});

main();
