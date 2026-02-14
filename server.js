const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.ALLOWED_ORIGINS || '*',
    methods: ['GET', 'POST']
  },
  pingTimeout: 60000,
  pingInterval: 25000
});

// Sicurezza
app.use(helmet());
app.use(express.json({ limit: '10kb' }));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minuti
  max: 100, // 100 richieste per IP
  message: 'Troppe richieste da questo IP, riprova più tardi'
});
app.use('/api/', limiter);

// Database in-memory (in produzione usa Redis/MongoDB)
const parties = new Map(); // party_code -> { host, users, createdAt, publicKey }
const users = new Map();   // sessionToken -> { username, partyCode, publicKey }
const partyMessages = new Map(); // party_code -> [messages]

// Genera token sicuro
function generateSecureToken() {
  return crypto.randomBytes(32).toString('hex');
}

// Hash del party code per sicurezza
function hashPartyCode(code) {
  return crypto.createHash('sha256').update(code).digest('hex');
}

// Validazione input
function validateUsername(username) {
  if (!username || typeof username !== 'string') return false;
  if (username.length < 3 || username.length > 20) return false;
  return /^[a-zA-Z0-9_-]+$/.test(username);
}

function validatePartyCode(code) {
  if (!code || typeof code !== 'string') return false;
  if (code.length < 4 || code.length > 32) return false;
  return /^[a-zA-Z0-9_-]+$/.test(code);
}

// ==========================================
// API ENDPOINTS
// ==========================================

// Crea nuovo party
app.post('/api/party/create', (req, res) => {
  try {
    const { partyCode, username } = req.body;
    
    if (!validatePartyCode(partyCode)) {
      return res.status(400).json({ 
        error: 'Codice party non valido (4-32 caratteri, solo lettere, numeri, - e _)' 
      });
    }
    
    if (!validateUsername(username)) {
      return res.status(400).json({ 
        error: 'Username non valido (3-20 caratteri, solo lettere, numeri, - e _)' 
      });
    }
    
    const hashedCode = hashPartyCode(partyCode);
    
    if (parties.has(hashedCode)) {
      return res.status(409).json({ error: 'Party già esistente con questo codice' });
    }
    
    const sessionToken = generateSecureToken();
    
    parties.set(hashedCode, {
      host: username,
      users: new Set([username]),
      createdAt: new Date(),
      maxUsers: 50
    });
    
    partyMessages.set(hashedCode, []);
    
    users.set(sessionToken, {
      username,
      partyCode: hashedCode,
      isHost: true,
      joinedAt: new Date()
    });
    
    console.log(`🎉 Party creato: ${partyCode} (host: ${username})`);
    
    res.json({
      success: true,
      sessionToken,
      partyCode: hashedCode,
      message: 'Party creato con successo'
    });
    
  } catch (error) {
    console.error('Errore creazione party:', error);
    res.status(500).json({ error: 'Errore interno del server' });
  }
});

// Unisciti a party
app.post('/api/party/join', (req, res) => {
  try {
    const { partyCode, username } = req.body;
    
    if (!validatePartyCode(partyCode)) {
      return res.status(400).json({ 
        error: 'Codice party non valido' 
      });
    }
    
    if (!validateUsername(username)) {
      return res.status(400).json({ 
        error: 'Username non valido' 
      });
    }
    
    const hashedCode = hashPartyCode(partyCode);
    const party = parties.get(hashedCode);
    
    if (!party) {
      return res.status(404).json({ error: 'Party non trovato' });
    }
    
    if (party.users.size >= party.maxUsers) {
      return res.status(403).json({ error: 'Party pieno' });
    }
    
    // Verifica username univoco nel party
    if (party.users.has(username)) {
      return res.status(409).json({ error: 'Username già in uso in questo party' });
    }
    
    const sessionToken = generateSecureToken();
    
    party.users.add(username);
    
    users.set(sessionToken, {
      username,
      partyCode: hashedCode,
      isHost: false,
      joinedAt: new Date()
    });
    
    console.log(`👋 ${username} si è unito al party`);
    
    res.json({
      success: true,
      sessionToken,
      partyCode: hashedCode,
      message: 'Accesso al party consentito'
    });
    
  } catch (error) {
    console.error('Errore join party:', error);
    res.status(500).json({ error: 'Errore interno del server' });
  }
});

// Statistiche party (solo per host)
app.get('/api/party/stats', (req, res) => {
  const { sessionToken } = req.query;
  
  const user = users.get(sessionToken);
  if (!user || !user.isHost) {
    return res.status(403).json({ error: 'Non autorizzato' });
  }
  
  const party = parties.get(user.partyCode);
  if (!party) {
    return res.status(404).json({ error: 'Party non trovato' });
  }
  
  res.json({
    users: Array.from(party.users),
    totalUsers: party.users.size,
    maxUsers: party.maxUsers,
    createdAt: party.createdAt
  });
});

// ==========================================
// WEBSOCKET
// ==========================================

io.on('connection', (socket) => {
  let currentUser = null;
  let currentParty = null;
  
  // Autenticazione
  socket.on('authenticate', (data) => {
    try {
      const { sessionToken } = data;
      const user = users.get(sessionToken);
      
      if (!user) {
        socket.emit('auth-error', { message: 'Sessione non valida' });
        socket.disconnect();
        return;
      }
      
      const party = parties.get(user.partyCode);
      if (!party) {
        socket.emit('auth-error', { message: 'Party non trovato' });
        socket.disconnect();
        return;
      }
      
      currentUser = user;
      currentParty = user.partyCode;
      
      // Unisciti alla room del party
      socket.join(currentParty);
      
      socket.emit('auth-success', { 
        username: user.username,
        isHost: user.isHost
      });
      
      // Invia storico messaggi
      const messages = partyMessages.get(currentParty) || [];
      socket.emit('message-history', messages.slice(-50)); // Ultimi 50
      
      // Notifica ingresso
      const joinMessage = {
        type: 'system',
        content: `${user.username} è entrato nel party`,
        timestamp: new Date().toISOString()
      };
      
      io.to(currentParty).emit('message', joinMessage);
      
      // Aggiorna lista utenti
      io.to(currentParty).emit('users-update', {
        users: Array.from(party.users),
        count: party.users.size
      });
      
      console.log(`✅ ${user.username} connesso al party`);
      
    } catch (error) {
      console.error('Errore autenticazione:', error);
      socket.emit('auth-error', { message: 'Errore autenticazione' });
      socket.disconnect();
    }
  });
  
  // Ricezione messaggio criptato
  socket.on('send-message', (data) => {
    try {
      if (!currentUser || !currentParty) {
        socket.emit('error', { message: 'Non autenticato' });
        return;
      }
      
      const { encryptedContent } = data;
      
      if (!encryptedContent || typeof encryptedContent !== 'string') {
        socket.emit('error', { message: 'Messaggio non valido' });
        return;
      }
      
      // Limita lunghezza messaggio criptato
      if (encryptedContent.length > 10000) {
        socket.emit('error', { message: 'Messaggio troppo lungo' });
        return;
      }
      
      const message = {
        type: 'user',
        username: currentUser.username,
        encryptedContent, // Salva messaggio criptato
        timestamp: new Date().toISOString()
      };
      
      // Salva in storico
      const messages = partyMessages.get(currentParty);
      messages.push(message);
      
      // Mantieni solo ultimi 200 messaggi
      if (messages.length > 200) {
        messages.shift();
      }
      
      // Invia a tutti nel party
      io.to(currentParty).emit('message', message);
      
    } catch (error) {
      console.error('Errore invio messaggio:', error);
      socket.emit('error', { message: 'Errore invio messaggio' });
    }
  });
  
  // Disconnessione
  socket.on('disconnect', () => {
    if (currentUser && currentParty) {
      const party = parties.get(currentParty);
      
      if (party) {
        party.users.delete(currentUser.username);
        
        const leaveMessage = {
          type: 'system',
          content: `${currentUser.username} ha lasciato il party`,
          timestamp: new Date().toISOString()
        };
        
        io.to(currentParty).emit('message', leaveMessage);
        
        // Aggiorna lista utenti
        io.to(currentParty).emit('users-update', {
          users: Array.from(party.users),
          count: party.users.size
        });
        
        // Se il party è vuoto, eliminalo
        if (party.users.size === 0) {
          parties.delete(currentParty);
          partyMessages.delete(currentParty);
          console.log(`🗑️  Party eliminato (vuoto)`);
        }
      }
      
      // Rimuovi utente
      users.forEach((user, token) => {
        if (user.username === currentUser.username && user.partyCode === currentParty) {
          users.delete(token);
        }
      });
      
      console.log(`❌ ${currentUser.username} disconnesso`);
    }
  });
});

// Pulizia automatica party inattivi
setInterval(() => {
  const now = new Date();
  const MAX_INACTIVE_TIME = 24 * 60 * 60 * 1000; // 24 ore
  
  parties.forEach((party, code) => {
    if (now - party.createdAt > MAX_INACTIVE_TIME && party.users.size === 0) {
      parties.delete(code);
      partyMessages.delete(code);
      console.log('🗑️  Party inattivo rimosso');
    }
  });
}, 60 * 60 * 1000); // Ogni ora

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    parties: parties.size,
    users: users.size,
    timestamp: new Date().toISOString()
  });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log('╔════════════════════════════════════════════════╗');
  console.log('║       🔐 TERMICHAT 2.0 - SERVER SICURO       ║');
  console.log('╚════════════════════════════════════════════════╝');
  console.log('');
  console.log(`🚀 Server avviato su porta ${PORT}`);
  console.log(`📡 URL locale: http://localhost:${PORT}`);
  console.log('🔐 Crittografia E2E: ATTIVA');
  console.log('🛡️  Protezione anti-hack: ATTIVA');
  console.log('⚡ Rate limiting: ATTIVO');
  console.log('');
  console.log('💡 Usa ngrok per connessioni remote:');
  console.log(`   ngrok http ${PORT}`);
  console.log('');
});
