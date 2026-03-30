const { Client, GatewayIntentBits, Partials } = require('discord.js');
const { token } = require('./config.json');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel],
});

// Ładowanie handlerów
const ticketHandler = require('./handlers/ticketHandler');
ticketHandler(client);

client.once('ready', () => {
  console.log(`✅ Bot zalogowany jako ${client.user.tag}`);
});

client.login(token);
