const { Client, GatewayIntentBits, Partials } = require('discord.js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildInvites,
  ],
  partials: [Partials.Channel],
});

const ticketHandler = require('./ticketHandler');
ticketHandler(client);

client.once('ready', () => {
  console.log(`✅ Bot zalogowany jako ${client.user.tag}`);
});

client.login(process.env.TOKEN);