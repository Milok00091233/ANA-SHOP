const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  StringSelectMenuBuilder,
  AttachmentBuilder,
} = require('discord.js');

const config = {
  realizatorRoleId: process.env.REALIZATOR_ROLE_ID,
  ticketCategoryId: process.env.TICKET_CATEGORY_ID,
  verifiedRoleId:   process.env.VERIFIED_ROLE_ID,
  lobbyChannelId:   process.env.LOBBY_CHANNEL_ID,
  legitChannelId:   process.env.LEGIT_CHANNEL_ID,
  wlascicielRoleId: process.env.WLASCICIEL_ROLE_ID,
  legitServerName:  process.env.LEGIT_SERVER_NAME || 'Anarchia LifeSteal',
  invitesChannelId: process.env.INVITES_CHANNEL_ID,
};

const ticketData  = new Map();
const inviteCache = new Map(); // code -> { uses, inviterId }
const joinedVia   = new Map(); // guildId -> Map(memberId -> inviterId)
const inviteStats = new Map(); // guildId -> Map(inviterId -> { joined: Set, left: Set })

// Min. wiek konta (ms) i min. dni na serwerze do "spełnienia kryteriów"
const MIN_ACCOUNT_AGE_MS = 4 * 30 * 24 * 60 * 60 * 1000; // 4 miesiące
const MIN_SERVER_DAYS    = 3;

function getStats(guildId, inviterId) {
  if (!inviteStats.has(guildId)) inviteStats.set(guildId, new Map());
  const gMap = inviteStats.get(guildId);
  if (!gMap.has(inviterId)) gMap.set(inviterId, { joined: new Map(), left: new Set() });
  return gMap.get(inviterId);
  // joined: Map(memberId -> joinedAt timestamp)
  // left:   Set(memberId)
}

let legitCount = parseInt(process.env.LEGIT_COUNT || '0', 10);

module.exports = (client) => {

  // ── Cache zaproszeń przy starcie ──
  client.once('ready', async () => {
    for (const guild of client.guilds.cache.values()) {
      try {
        const invites = await guild.invites.fetch();
        const map = new Map();
        for (const inv of invites.values()) {
          map.set(inv.code, { uses: inv.uses ?? 0, inviterId: inv.inviter?.id ?? null });
        }
        inviteCache.set(guild.id, map);
      } catch (e) {}
    }
    console.log('✅ Bot gotowy, cache zaproszeń załadowany');
  });

  client.on('inviteCreate', (invite) => {
    const map = inviteCache.get(invite.guild.id) ?? new Map();
    map.set(invite.code, { uses: invite.uses ?? 0, inviterId: invite.inviter?.id ?? null });
    inviteCache.set(invite.guild.id, map);
  });

  client.on('inviteDelete', (invite) => {
    inviteCache.get(invite.guild.id)?.delete(invite.code);
  });

  // ── Powitanie na #lobby ──
  client.on('guildMemberAdd', async (member) => {
    const lobbyChannel = member.guild.channels.cache.get(config.lobbyChannelId);
    if (!lobbyChannel) return;

    let inviterText = 'Nieznany';
    let inviterId = null;
    try {
      const newInvites = await member.guild.invites.fetch();
      const oldMap = inviteCache.get(member.guild.id) ?? new Map();
      for (const inv of newInvites.values()) {
        const old = oldMap.get(inv.code);
        if (old && inv.uses > old.uses && inv.inviter) {
          inviterId = inv.inviter.id;
          inviterText = `<@${inviterId}>`;
          oldMap.set(inv.code, { uses: inv.uses, inviterId: inviterId });
          break;
        }
      }
      inviteCache.set(member.guild.id, oldMap);
    } catch (e) {}

    if (inviterId) {
      if (!joinedVia.has(member.guild.id)) joinedVia.set(member.guild.id, new Map());
      joinedVia.get(member.guild.id).set(member.id, inviterId);
      const stats = getStats(member.guild.id, inviterId);
      stats.joined.set(member.id, Date.now());
      stats.left.delete(member.id);
    }

    const stats = inviterId ? getStats(member.guild.id, inviterId) : null;
    const joinedCount = stats ? stats.joined.size : '?';
    const leftCount   = stats ? stats.left.size   : '?';

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle('👋 Nowy członek dołączył!')
      .setThumbnail(member.user.displayAvatarURL({ dynamic: true, size: 256 }))
      .addFields(
        { name: '👤 Użytkownik', value: `${member} (${member.user.username})`, inline: true },
        { name: '🆔 ID', value: member.id, inline: true },
        { name: '📨 Zaproszony przez', value: `${inviterText} • ✅ **${joinedCount}** na serwerze / 🚪 **${leftCount}** wyszło`, inline: false },
        { name: '📅 Konto założone', value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`, inline: true },
        { name: '👥 Członków na serwerze', value: `${member.guild.memberCount}`, inline: true },
      )
      .setFooter({ text: 'ANA SHOP • Najlepszy sklep' })
      .setTimestamp();

    await lobbyChannel.send({ embeds: [embed] });
  });

  // ── Śledzenie wyjść ──
  client.on('guildMemberRemove', (member) => {
    const guildJoinedVia = joinedVia.get(member.guild.id);
    if (!guildJoinedVia) return;
    const originalInviterId = guildJoinedVia.get(member.id);
    if (!originalInviterId) return;
    const stats = getStats(member.guild.id, originalInviterId);
    stats.joined.delete(member.id);
    stats.left.add(member.id);
  });

  // ── Legit Check ──
  client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.guild) return;
    if (!config.legitChannelId) return;
    if (message.channel.id !== config.legitChannelId) return;

    const isWlasciciel = message.member.roles.cache.has(config.wlascicielRoleId);
    const isRealizator = message.member.roles.cache.has(config.realizatorRoleId);
    const isAdmin      = message.member.permissions.has(PermissionFlagsBits.Administrator);

    if (!isWlasciciel && !isRealizator && !isAdmin) {
      await message.delete().catch(() => {});
      return;
    }

    const image = message.attachments.find(a => a.contentType?.startsWith('image/'));
    if (!image) { await message.delete().catch(() => {}); return; }

    const imageUrl  = image.url;
    const imageName = image.name || 'legit.png';

    const imageBuffer = await new Promise((resolve) => {
      const https = require('https');
      const http  = require('http');
      const lib   = imageUrl.startsWith('https') ? https : http;
      lib.get(imageUrl, (res) => {
        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => resolve(Buffer.concat(chunks)));
        res.on('error', () => resolve(null));
      }).on('error', () => resolve(null));
    });

    await message.delete().catch(() => {});
    legitCount++;

    const embed = new EmbedBuilder()
      .setColor(0x57f287)
      .setTitle(`✅ LEGIT CHECK → ${legitCount}`)
      .addFields(
        { name: 'Kupno itemów', value: `>>> **${config.legitServerName}**`, inline: false },
        { name: 'Klient potwierdził transakcję', value: '\u200b', inline: false },
        { name: '🛡️ ANA SHOP — Bezpieczne zakupy', value: '\u200b', inline: false },
      )
      .setFooter({ text: 'ANA SHOP • Najlepszy sklep' })
      .setTimestamp();

    if (imageBuffer) {
      const attachment = new AttachmentBuilder(imageBuffer, { name: imageName });
      embed.setImage(`attachment://${imageName}`);
      await message.channel.send({ embeds: [embed], files: [attachment] });
    } else {
      embed.setImage(imageUrl);
      await message.channel.send({ embeds: [embed] });
    }
  });

  // ── Komendy admina ──
  client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.member) return;
    if (message.channel.id === config.legitChannelId) return;

    // ── Auto-usuń wiadomości na kanale zaproszeń ──
    if (config.invitesChannelId && message.channel.id === config.invitesChannelId) {
      if (message.author.bot) return;
      // Komendy slash (interakcje) są obsługiwane osobno — tu trafiają tylko zwykłe wiadomości
      // Wiadomości zaczynające się od "/" traktujemy jak próbę komendy → usuń po 10s
      if (message.content.startsWith('/')) {
        setTimeout(() => message.delete().catch(() => {}), 10000);
      } else {
        // Wszystkie inne wiadomości → usuń od razu
        await message.delete().catch(() => {});
      }
      return;
    }

    const isAdmin = message.member.permissions.has(PermissionFlagsBits.Administrator);

    // !setup
    if (message.content === '!setup' && isAdmin) {
      const embed = new EmbedBuilder()
        .setColor(0x1a1a2e).setTitle('🛒 ANA SHOP — SKLEP')
        .setDescription('>>> Witaj w naszym sklepie!\n\nAby złożyć zamówienie, kliknij przycisk poniżej.\nNasz realizator przejmie Twój ticket tak szybko jak to możliwe.\n\n**Pamiętaj:**\n🔴 Nie wysyłaj kodów Paysafecard ani paragonów dopóki realizator o to nie poprosi!\n🔴 Nie odpisuj nikomu na PV — to SCAM!')
        .setFooter({ text: 'ANA SHOP • Najlepszy sklep' });
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('open_ticket').setLabel('🎫 Otwórz Ticket').setStyle(ButtonStyle.Primary)
      );
      await message.channel.send({ embeds: [embed], components: [row] });
      await message.delete().catch(() => {});
    }

    // !pomoc
    if (message.content === '!pomoc' && isAdmin) {
      const embed = new EmbedBuilder()
        .setColor(0x1a1a2e).setTitle('❓ ANA SHOP — POMOC')
        .setDescription('>>> Potrzebujesz pomocy?\n\nKliknij przycisk poniżej aby otworzyć ticket pomocy.\nWłaściciel odpowie tak szybko jak to możliwe.\n\n**NIE ODPISUJ NIKOMU NA PV — TO SCAM!**')
        .setFooter({ text: 'ANA SHOP • Najlepszy sklep' });
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('open_pomoc').setLabel('❓ Otwórz Pomoc').setStyle(ButtonStyle.Secondary)
      );
      await message.channel.send({ embeds: [embed], components: [row] });
      await message.delete().catch(() => {});
    }

    // !weryfikacja
    if (message.content === '!weryfikacja' && isAdmin) {
      const embed = new EmbedBuilder()
        .setColor(0x57f287).setTitle('✅ ANA SHOP — WERYFIKACJA')
        .setDescription('**Aby zweryfikować konto:**\n\n>>> **1.** Kliknij przycisk **Zweryfikuj** poniżej.\n**2.** Wpisz **TAK** aby potwierdzić, że nie jesteś robotem.\n**3.** Po poprawnej odpowiedzi otrzymasz rangę **zweryfikowany**.')
        .setFooter({ text: 'ANA SHOP • Najlepszy sklep' });
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('verify_btn').setLabel('🔒 Zweryfikuj').setStyle(ButtonStyle.Success)
      );
      await message.channel.send({ embeds: [embed], components: [row] });
      await message.delete().catch(() => {});
    }

    // !zaproszenia → panel z przyciskiem
    if (message.content === '!zaproszenia' && isAdmin) {
      const embed = new EmbedBuilder()
        .setColor(0x2b2d31)
        .setTitle('📬 ANA SHOP × ZAPROSZENIA')
        .setDescription('Kliknij przycisk poniżej, aby sprawdzić swoje statystyki zaproszeń!')
        .addFields(
          { name: '👤 × Ile osób zaprosiłeś na serwer', value: '\u200b', inline: false },
          { name: '⏳ × Ile z nich zostało wymaganą liczbę dni', value: '\u200b', inline: false },
          { name: '✅ × Ile spełnia kryteria konta', value: '\u200b', inline: false },
          { name: '🎁 × Ile masz dodatkowych zaproszeń', value: '\u200b', inline: false },
        )
        .setFooter({ text: 'ANA SHOP • Najlepszy sklep' });
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('check_invites').setLabel('❤️ Sprawdź moje zaproszenia').setStyle(ButtonStyle.Danger)
      );
      await message.channel.send({ embeds: [embed], components: [row] });
      await message.delete().catch(() => {});
    }

    // !resetinvites @user
    if (message.content.startsWith('!resetinvites') && message.member.roles.cache.has(config.wlascicielRoleId)) {
      const target = message.mentions.users.first();
      if (!target) {
        await message.reply('❌ Podaj użytkownika! Użycie: `!resetinvites @nick`').then(m => setTimeout(() => m.delete().catch(() => {}), 5000));
        await message.delete().catch(() => {});
        return;
      }
      const guildId = message.guild.id;
      if (!inviteStats.has(guildId)) inviteStats.set(guildId, new Map());
      inviteStats.get(guildId).set(target.id, { joined: new Map(), left: new Set() });
      const embed = new EmbedBuilder()
        .setColor(0xff0000).setTitle('🔄 Zaproszenia zresetowane')
        .setDescription(`Zaproszenia użytkownika ${target} zostały zresetowane do **0**.`)
        .setFooter({ text: 'ANA SHOP • Najlepszy sklep' }).setTimestamp();
      await message.delete().catch(() => {});
      const reply = await message.channel.send({ embeds: [embed] });
      setTimeout(() => reply.delete().catch(() => {}), 10000);
    }

    // !say #kanał treść
    if (message.content.startsWith('!say ') && isAdmin) {
      const args = message.content.slice(5).trim();
      const channelMention = args.match(/^<#(\d+)>/);
      if (!channelMention) { await message.reply('❌ Użycie: `!say #kanał treść`').catch(() => {}); return; }
      const targetChannel = message.guild.channels.cache.get(channelMention[1]);
      if (!targetChannel) { await message.reply('❌ Nie znaleziono kanału.').catch(() => {}); return; }
      const tekst = args.slice(channelMention[0].length).trim();
      if (!tekst) { await message.reply('❌ Podaj treść!').catch(() => {}); return; }
      await targetChannel.send(tekst);
      await message.delete().catch(() => {});
    }

    // !kalkulator
    if (message.content === '!kalkulator' && isAdmin) {
      const embed = new EmbedBuilder()
        .setColor(0x1a1a2e).setTitle('🧮 ANA SHOP — KALKULATOR')
        .setDescription('**Aby w szybki i prosty sposób obliczyć:**\n\n› ile otrzymasz waluty za określoną ilość PLN\n› ile musisz dać PLN, aby otrzymać określoną ilość waluty\n\nKliknij odpowiedni przycisk poniżej.')
        .addFields({ name: '💰 Prowizje wg metody płatności', value: '💳 PSC z paragonem — **15%**\n💳 PSC bez paragonu — **25%**\n📱 BLIK (przelew) — **0%**\n📱 Kod BLIK — **10%**\n🅿️ PayPal — **10%**\n🪙 Kryptowaluty (LTC, SOL, BTC) — **0%**' })
        .setFooter({ text: 'ANA SHOP • Najlepszy sklep • kurs: 1 PLN = 7 000' });
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('calc_ile_otrzymam').setLabel('Ile otrzymam?').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('calc_ile_musze_dac').setLabel('Ile muszę dać?').setStyle(ButtonStyle.Secondary),
      );
      await message.channel.send({ embeds: [embed], components: [row] });
      await message.delete().catch(() => {});
    }

    // !giveaway <czas> <nagroda>
    if (message.content.startsWith('!giveaway ') && isAdmin) {
      const args = message.content.slice('!giveaway '.length).trim().split(/\s+/);
      if (args.length < 2) {
        return message.reply('❌ Użycie: `!giveaway <czas> <nagroda>`\nPrzykład: `!giveaway 1d 500k`').then(m => setTimeout(() => m.delete().catch(() => {}), 8000));
      }
      const durationMs = parseDuration(args[0]);
      if (!durationMs) {
        return message.reply('❌ Nieprawidłowy czas! Użyj: `30s`, `10m`, `2h`, `1d`').then(m => setTimeout(() => m.delete().catch(() => {}), 8000));
      }
      const prize = args.slice(1).join(' ');
      const endsAt = Date.now() + durationMs;
      const giveawayId = `${message.guild.id}_${Date.now()}`;
      const giveaway = {
        id: giveawayId, prize, creatorId: message.author.id,
        channelId: message.channel.id, messageId: null,
        participants: new Set(), winners: [], winnersCount: 1,
        endsAt, createdAt: Date.now(), ended: false,
      };
      giveawayData.set(giveawayId, giveaway);
      await message.delete().catch(() => {});
      const embed = buildGiveawayEmbed(giveaway);
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`giveaway_join_${giveawayId}`).setLabel('🎉 Weź udział (0)').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`giveaway_end_${giveawayId}`).setLabel('🔴 Zakończ').setStyle(ButtonStyle.Danger)
      );
      const msg = await message.channel.send({ embeds: [embed], components: [row] });
      giveaway.messageId = msg.id;
      const timer = setTimeout(() => endGiveaway(giveawayId, message.client), durationMs);
      giveawayTimers.set(giveawayId, timer);
    }
  });

  // ── INTERAKCJE ──────────────────────────────────────────────────────────────
  client.on('interactionCreate', async (interaction) => {
    const { member, guild, channel } = interaction;
    const wlascicielRoleId = config.wlascicielRoleId;

    // ── Auto-usuń odpowiedzi slash na kanale zaproszeń po 10s ──
    if (config.invitesChannelId && interaction.channelId === config.invitesChannelId) {
      if (interaction.isChatInputCommand()) {
        // Poczekaj aż bot odpowie, potem usuń po 10s
        interaction.client.once('interactionCreate', () => {});
        setTimeout(async () => {
          try {
            await interaction.deleteReply().catch(() => {});
          } catch (e) {}
        }, 10000);
      }
    }

    // ── Sprawdź zaproszenia (przycisk) ──
    if (interaction.isButton() && interaction.customId === 'check_invites') {
      const userId  = member.id;
      const guildId = guild.id;
      const stats   = getStats(guildId, userId);

      const now = Date.now();
      let totalInvited = stats.joined.size + stats.left.size;
      let onServer     = stats.joined.size;
      let leftServer   = stats.left.size;

      // Ile zostało min. MIN_SERVER_DAYS dni
      let stayedDays = 0;
      for (const [memberId, joinedAt] of stats.joined.entries()) {
        const daysOnServer = (now - joinedAt) / (1000 * 60 * 60 * 24);
        if (daysOnServer >= MIN_SERVER_DAYS) stayedDays++;
      }

      // Ile spełnia kryterium wieku konta (min. 4 miesiące)
      let meetsAccountAge = 0;
      let notMeetsAccountAge = 0;
      for (const memberId of stats.joined.keys()) {
        try {
          const guildMember = await guild.members.fetch(memberId).catch(() => null);
          if (guildMember) {
            const accountAge = now - guildMember.user.createdTimestamp;
            if (accountAge >= MIN_ACCOUNT_AGE_MS) meetsAccountAge++;
            else notMeetsAccountAge++;
          }
        } catch (e) {}
      }

      const embed = new EmbedBuilder()
        .setColor(0x2b2d31)
        .setTitle('📬 ANA SHOP × ZAPROSZENIA')
        .setDescription(`${member} posiada **${totalInvited}** zaproszeń!`)
        .addFields(
          { name: '👤 × Osoby, które dołączyły na serwer:', value: `**${onServer}**`, inline: false },
          { name: '🚪 × Osoby, które opuściły serwer:', value: `**${leftServer}**`, inline: false },
          { name: '⏳ × Osoby, które są min. 3 dni:', value: `**${stayedDays}**`, inline: false },
          { name: '✅ × Konto założone min. 4 mies.:', value: `**${meetsAccountAge}**`, inline: false },
          { name: '⚠️ × Niespełniające kryteriów (< konto 4 mies.):', value: `**${notMeetsAccountAge}**`, inline: false },
          { name: '🎁 × Dodatkowe zaproszenia:', value: `**0**`, inline: false },
        )
        .setFooter({ text: 'ANA SHOP • Najlepszy sklep' })
        .setTimestamp();

      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }

    // ── Kalkulator ──
    if (interaction.isButton() && (interaction.customId === 'calc_ile_otrzymam' || interaction.customId === 'calc_ile_musze_dac')) {
      const tryb = interaction.customId === 'calc_ile_otrzymam' ? 'otrzymam' : 'musze_dac';
      const select = new StringSelectMenuBuilder()
        .setCustomId(`calc_select_metoda_${tryb}`)
        .setPlaceholder('Wybierz metodę płatności...')
        .addOptions([
          { label: 'PSC z paragonem',           description: 'Prowizja: 15%', value: 'psc_paragon',  emoji: '💳' },
          { label: 'PSC bez paragonu',           description: 'Prowizja: 25%', value: 'psc_bez',      emoji: '💳' },
          { label: 'BLIK (przelew)',             description: 'Prowizja: 0%',  value: 'blik_przelew', emoji: '📱' },
          { label: 'Kod BLIK',                   description: 'Prowizja: 10%', value: 'blik_kod',     emoji: '📱' },
          { label: 'PayPal',                     description: 'Prowizja: 10%', value: 'paypal',       emoji: '🅿️' },
          { label: 'Kryptowaluty (LTC/SOL/BTC)', description: 'Prowizja: 0%',  value: 'krypto',       emoji: '🪙' },
        ]);
      await interaction.reply({ content: '**Wybierz metodę płatności:**', components: [new ActionRowBuilder().addComponents(select)], ephemeral: true });
      return;
    }

    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('calc_select_metoda_')) {
      const tryb   = interaction.customId.replace('calc_select_metoda_', '');
      const metoda = interaction.values[0];
      const modal  = new ModalBuilder().setCustomId(`calc_modal_${tryb}__${metoda}`).setTitle('Obliczanie...');
      const kwotaLabel       = tryb === 'otrzymam' ? 'Kwota (w PLN):' : 'Kwota waluty (np. 125K):';
      const kwotaPlaceholder = tryb === 'otrzymam' ? 'Przykład: 150' : 'Przykład: 125K lub 125000';
      modal.addComponents(new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('calc_kwota').setLabel(kwotaLabel).setStyle(TextInputStyle.Short).setPlaceholder(kwotaPlaceholder).setRequired(true)
      ));
      await interaction.showModal(modal);
      return;
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith('calc_modal_')) {
      const KURS = 7000;
      const PROWIZJE = {
        'psc_paragon':  { nazwa: '💳 PSC z paragonem',           procent: 15 },
        'psc_bez':      { nazwa: '💳 PSC bez paragonu',           procent: 25 },
        'blik_przelew': { nazwa: '📱 BLIK (przelew)',             procent: 0  },
        'blik_kod':     { nazwa: '📱 Kod BLIK',                   procent: 10 },
        'paypal':       { nazwa: '🅿️ PayPal',                    procent: 10 },
        'krypto':       { nazwa: '🪙 Kryptowaluty (LTC/SOL/BTC)', procent: 0  },
      };
      const parts  = interaction.customId.replace('calc_modal_', '').split('__');
      const tryb   = parts[0];
      const metoda = PROWIZJE[parts[1]];
      if (!metoda) { await interaction.reply({ content: '❌ Błąd danych.', ephemeral: true }); return; }
      const rawKwota = interaction.fields.getTextInputValue('calc_kwota').trim().replace(/,/g, '.').replace(/[kK]$/, '000');
      const kwota = parseFloat(rawKwota.replace(/[^0-9.]/g, ''));
      if (isNaN(kwota) || kwota <= 0) { await interaction.reply({ content: '❌ Nieprawidłowa kwota!', ephemeral: true }); return; }
      const prowizjaUlamek = metoda.procent / 100;
      let wynikText = '';
      if (tryb === 'otrzymam') {
        const netPLN = kwota * (1 - prowizjaUlamek);
        const waluta = Math.floor(netPLN * KURS);
        wynikText = `💵 Wpłacasz: **${kwota.toFixed(2)} PLN**\n💸 Prowizja (${metoda.procent}%): **${(kwota * prowizjaUlamek).toFixed(2)} PLN**\n🎮 Otrzymasz: **${waluta.toLocaleString('pl-PL')} waluty**`;
      } else {
        const brutoPLN = prowizjaUlamek < 1 ? (kwota / KURS) / (1 - prowizjaUlamek) : kwota / KURS;
        wynikText = `🎮 Chcesz: **${kwota.toLocaleString('pl-PL')} waluty**\n💸 Prowizja (${metoda.procent}%): **${(brutoPLN * prowizjaUlamek).toFixed(2)} PLN**\n💵 Musisz zapłacić: **${brutoPLN.toFixed(2)} PLN**`;
      }
      const embed = new EmbedBuilder().setColor(0x5865f2).setTitle('🧮 ANA SHOP — Wynik kalkulatora')
        .addFields({ name: '💳 Metoda płatności', value: metoda.nazwa }, { name: '📊 Obliczenia', value: wynikText })
        .setFooter({ text: 'ANA SHOP • kurs: 1 PLN = 7 000' }).setTimestamp();
      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }

    // ── Weryfikacja ──
    if (interaction.isButton() && interaction.customId === 'verify_btn') {
      const modal = new ModalBuilder().setCustomId('verify_modal').setTitle('Weryfikacja');
      modal.addComponents(new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('verify_answer').setLabel('Czy NIE jesteś robotem? Wpisz TAK.').setStyle(TextInputStyle.Short).setPlaceholder('TAK').setRequired(true)
      ));
      await interaction.showModal(modal);
      return;
    }

    if (interaction.isModalSubmit() && interaction.customId === 'verify_modal') {
      const answer = interaction.fields.getTextInputValue('verify_answer').trim().toUpperCase();
      if (answer === 'TAK') {
        const role = guild.roles.cache.get(config.verifiedRoleId);
        if (role) {
          await member.roles.add(role).catch(() => {});
          await interaction.reply({ content: '✅ Zostałeś zweryfikowany i otrzymałeś rangę **zweryfikowany**!', ephemeral: true });
        } else {
          await interaction.reply({ content: '❌ Błąd: Nie znaleziono roli.', ephemeral: true });
        }
      } else {
        await interaction.reply({ content: '❌ Niepoprawna odpowiedź! Wpisz **TAK**.', ephemeral: true });
      }
      return;
    }

    if (!interaction.isButton()) return;
    const customId = interaction.customId;

    // ── Giveaway: dołącz ──
    if (customId.startsWith('giveaway_join_')) {
      const giveawayId = customId.replace('giveaway_join_', '');
      const giveaway = giveawayData.get(giveawayId);
      if (!giveaway) return interaction.reply({ content: '❌ Ten konkurs już nie istnieje.', ephemeral: true });
      if (giveaway.ended) return interaction.reply({ content: '❌ Ten konkurs już się zakończył!', ephemeral: true });
      if (giveaway.participants.has(member.id)) return interaction.reply({ content: '✅ Już bierzesz udział!', ephemeral: true });
      giveaway.participants.add(member.id);
      await interaction.reply({ content: `🎉 Dołączyłeś! Uczestniczy **${giveaway.participants.size}** osób.`, ephemeral: true });
      const updatedRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`giveaway_join_${giveawayId}`).setLabel(`🎉 Weź udział (${giveaway.participants.size})`).setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`giveaway_end_${giveawayId}`).setLabel('🔴 Zakończ').setStyle(ButtonStyle.Danger)
      );
      await interaction.message.edit({ embeds: [buildGiveawayEmbed(giveaway)], components: [updatedRow] }).catch(() => {});
      return;
    }

    // ── Giveaway: zakończ wcześniej ──
    if (customId.startsWith('giveaway_end_')) {
      if (!member.permissions.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({ content: '❌ Tylko admin może zakończyć konkurs!', ephemeral: true });
      }
      const giveawayId = customId.replace('giveaway_end_', '');
      await endGiveaway(giveawayId, client);
      await interaction.reply({ content: '✅ Konkurs zakończony!', ephemeral: true });
      return;
    }

    // ── Ticket sklepu: otwórz ──
    if (customId === 'open_ticket') {
      await interaction.deferReply({ ephemeral: true });
      const existing = guild.channels.cache.find(c => ticketData.get(c.id)?.userId === member.id && ticketData.get(c.id)?.type === 'sklep');
      if (existing) return interaction.editReply({ content: `❌ Masz już otwarty ticket: ${existing}` });
      const ticketChannel = await guild.channels.create({
        name: `ticket-${member.user.username.replace(/[^a-z0-9]/gi, '').toLowerCase()}`,
        type: ChannelType.GuildText, parent: config.ticketCategoryId,
        permissionOverwrites: [
          { id: guild.roles.everyone, deny: [PermissionFlagsBits.ViewChannel] },
          { id: member.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
          { id: config.realizatorRoleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels] },
        ],
      });
      ticketData.set(ticketChannel.id, { userId: member.id, username: member.user.username, claimedBy: null, type: 'sklep', openedAt: new Date() });
      const infoEmbed = new EmbedBuilder().setColor(0xff0000).setTitle('🔴 ANA SHOP × TICKET SPRZEDAZ')
        .addFields(
          { name: '>> INFORMACJE O UZYTKOWNIKU', value: `>>> **>> Ping:** ${member}\n**>> Nazwa:** ${member.user.username}\n**>> Id:** ${member.id}` },
          { name: '>> INFORMACJE O SPRZEDAZY:', value: `>>> **>> Przedmiot:** *użytkownik poda poniżej*` }
        ).setFooter({ text: 'ANA SHOP • Najlepszy sklep' });
      const welcomeEmbed = new EmbedBuilder().setColor(0x2b2d31).setDescription(
        '🎉 **Dziękujemy za skorzystanie z naszych usług!**\n\n>>> Prosimy o oznaczenie roli **realizatorów**, jeżeli nikt od kilku minut nie przejął ticketa. Pamiętaj: Nie wysyłaj kodów **Paysafecard** ani paragonów dopóki ticket nie zostanie przejęty!\n🚨 Nie dajemy zwrotu środków za **przedwczesne wysłanie kodów.**\n\n**NIE ODPISUJ NIKOMU NA PV, TO SCAM!**'
      );
      const claimRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('claim_ticket').setLabel('✅ Przejmij ticket').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('close_ticket').setLabel('🔒 Zamknij ticket').setStyle(ButtonStyle.Danger)
      );
      await ticketChannel.send({ content: `${member} | <@&${config.realizatorRoleId}>` });
      await ticketChannel.send({ embeds: [infoEmbed] });
      await ticketChannel.send({ embeds: [welcomeEmbed], components: [claimRow] });
      await interaction.editReply({ content: `✅ Twój ticket został otwarty: ${ticketChannel}` });
    }

    // ── Ticket sklepu: przejmij ──
    if (customId === 'claim_ticket') {
      if (!member.roles.cache.has(config.realizatorRoleId)) return interaction.reply({ content: '❌ Tylko **Realizatorzy** mogą przejmować tickety!', ephemeral: true });
      const data = ticketData.get(channel.id);
      if (!data) return interaction.reply({ content: '❌ Błąd danych ticketu.', ephemeral: true });
      if (data.claimedBy) return interaction.reply({ content: `❌ Ticket już przejęty przez <@${data.claimedBy}>!`, ephemeral: true });
      data.claimedBy = member.id;
      await channel.setName(`claimed-${channel.name.replace('ticket-', '')}`).catch(() => {});
      const disabledRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('claim_ticket').setLabel(`✅ Przejęty przez ${member.user.username}`).setStyle(ButtonStyle.Success).setDisabled(true),
        new ButtonBuilder().setCustomId('close_ticket').setLabel('🔒 Zamknij ticket').setStyle(ButtonStyle.Danger)
      );
      await interaction.update({ components: [disabledRow] });
      await channel.send({ embeds: [new EmbedBuilder().setColor(0x57f287).setDescription(`✅ Ticket przejęty przez ${member}!\n\nRealizator wkrótce się z Tobą skontaktuje.`)] });
    }

    // ── Ticket sklepu: zamknij ──
    if (customId === 'close_ticket') {
      if (!member.roles.cache.has(config.realizatorRoleId) && !member.permissions.has(PermissionFlagsBits.Administrator)) return interaction.reply({ content: '❌ Tylko **Realizatorzy** mogą zamykać tickety!', ephemeral: true });
      await interaction.reply({ content: '🔒 Zamykanie ticketu za 5 sekund...' });
      setTimeout(async () => { ticketData.delete(channel.id); await channel.delete().catch(() => {}); }, 5000);
    }

    // ── Ticket pomocy: otwórz ──
    if (customId === 'open_pomoc') {
      try {
        await interaction.deferReply({ ephemeral: true });
        const existing = guild.channels.cache.find(c => ticketData.get(c.id)?.userId === member.id && ticketData.get(c.id)?.type === 'pomoc');
        if (existing) return interaction.editReply({ content: `❌ Masz już otwarty ticket pomocy: ${existing}` });
        const pomocChannel = await guild.channels.create({
          name: `pomoc-${member.user.username.replace(/[^a-z0-9]/gi, '').toLowerCase()}`,
          type: ChannelType.GuildText, parent: config.ticketCategoryId,
          permissionOverwrites: [
            { id: guild.roles.everyone, deny: [PermissionFlagsBits.ViewChannel] },
            { id: member.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
            { id: wlascicielRoleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels] },
          ],
        });
        ticketData.set(pomocChannel.id, { userId: member.id, username: member.user.username, claimedBy: null, type: 'pomoc', openedAt: new Date() });
        const infoEmbed = new EmbedBuilder().setColor(0xff0000).setTitle('🔴 ANA SHOP × TICKET POMOC')
          .addFields(
            { name: '>> INFORMACJE O UZYTKOWNIKU', value: `>>> **>> Ping:** ${member}\n**>> Nazwa:** ${member.user.username}\n**>> Id:** ${member.id}` },
            { name: '>> TEMAT POMOCY:', value: `>>> **>> Opis:** *użytkownik poda poniżej*` }
          ).setFooter({ text: 'ANA SHOP • Najlepszy sklep' });
        const welcomeEmbed = new EmbedBuilder().setColor(0x2b2d31).setDescription('👋 **Witaj! Opisz swój problem poniżej.**\n\n>>> Właściciel odpowie tak szybko jak to możliwe.\n**NIE ODPISUJ NIKOMU NA PV — TO SCAM!**');
        const claimRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('claim_pomoc').setLabel('✅ Przejmij ticket').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId('close_pomoc').setLabel('🔒 Zamknij ticket').setStyle(ButtonStyle.Danger)
        );
        await pomocChannel.send({ content: `${member} | <@&${wlascicielRoleId}>` });
        await pomocChannel.send({ embeds: [infoEmbed] });
        await pomocChannel.send({ embeds: [welcomeEmbed], components: [claimRow] });
        await interaction.editReply({ content: `✅ Twój ticket pomocy został otwarty: ${pomocChannel}` });
      } catch (err) {
        console.error('Błąd ticket pomocy:', err);
        if (interaction.deferred) await interaction.editReply({ content: '❌ Błąd. Spróbuj ponownie.' }).catch(() => {});
      }
    }

    // ── Ticket pomocy: przejmij ──
    if (customId === 'claim_pomoc') {
      if (!member.roles.cache.has(wlascicielRoleId) && !member.permissions.has(PermissionFlagsBits.Administrator)) return interaction.reply({ content: '❌ Tylko **Właściciel** może przejmować te tickety!', ephemeral: true });
      const data = ticketData.get(channel.id);
      if (data?.claimedBy) return interaction.reply({ content: `❌ Ticket już przejęty przez <@${data.claimedBy}>!`, ephemeral: true });
      if (data) data.claimedBy = member.id;
      ticketData.set(channel.id, data || { claimedBy: member.id });
      await channel.setName(`claimed-${channel.name.replace('pomoc-', '')}`).catch(() => {});
      const disabledRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('claim_pomoc').setLabel(`✅ Przejęty przez ${member.user.username}`).setStyle(ButtonStyle.Success).setDisabled(true),
        new ButtonBuilder().setCustomId('close_pomoc').setLabel('🔒 Zamknij ticket').setStyle(ButtonStyle.Danger)
      );
      await interaction.update({ components: [disabledRow] });
      await channel.send({ embeds: [new EmbedBuilder().setColor(0x57f287).setDescription(`✅ Ticket przejęty przez ${member}!`)] });
    }

    // ── Ticket pomocy: zamknij ──
    if (customId === 'close_pomoc') {
      if (!member.roles.cache.has(wlascicielRoleId) && !member.permissions.has(PermissionFlagsBits.Administrator)) return interaction.reply({ content: '❌ Tylko **Właściciel** może zamykać te tickety!', ephemeral: true });
      await interaction.reply({ content: '🔒 Zamykanie ticketu za 5 sekund...' });
      setTimeout(async () => { ticketData.delete(channel.id); await channel.delete().catch(() => {}); }, 5000);
    }
  });

  // ── GIVEAWAY HELPERS ─────────────────────────────────────────────────────────
  const giveawayData   = new Map();
  const giveawayTimers = new Map();

  function parseDuration(str) {
    const match = str.match(/^(\d+)(s|m|h|d)$/i);
    if (!match) return null;
    const val = parseInt(match[1]);
    const multipliers = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
    return val * multipliers[match[2].toLowerCase()];
  }

  function formatTimeLeft(ms) {
    if (ms <= 0) return 'Zakończony';
    const d = Math.floor(ms / 86400000);
    const h = Math.floor((ms % 86400000) / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    if (d > 0) return `${d} dni ${h}h`;
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  }

  function buildGiveawayEmbed(giveaway) {
    const count = giveaway.participants?.size || 0;
    return new EmbedBuilder()
      .setColor(giveaway.ended ? 0x99aab5 : 0xf1c40f)
      .setTitle('🎁 Konkurs')
      .addFields(
        { name: '🎁 Konkurs zakończy się:', value: `<t:${Math.floor(giveaway.endsAt / 1000)}:R>`, inline: true },
        { name: '🔧 Utworzony przez:', value: `<@${giveaway.creatorId}>`, inline: true },
        { name: '📅 Utworzony dnia:', value: `<t:${Math.floor(giveaway.createdAt / 1000)}:D>`, inline: true },
        { name: '🎁 Nagroda:', value: giveaway.prize, inline: true },
        {
          name: giveaway.ended ? '🏆 Zwycięzcy:' : '⏳ Czas do końca:',
          value: giveaway.ended
            ? (giveaway.winners?.length > 0 ? giveaway.winners.map(w => `<@${w}>`).join(', ') : 'Brak uczestników')
            : formatTimeLeft(giveaway.endsAt - Date.now()),
          inline: true,
        },
      )
      .setFooter({ text: `ANA SHOP • ${giveaway.ended ? `Konkurs zakończony (${count} osób wzięło udział)` : `${count} uczestników`}` })
      .setTimestamp();
  }

  async function endGiveaway(giveawayId, client) {
    const giveaway = giveawayData.get(giveawayId);
    if (!giveaway || giveaway.ended) return;
    giveaway.ended = true;
    const pool = [...giveaway.participants];
    const winners = [];
    for (let i = 0; i < Math.min(giveaway.winnersCount, pool.length); i++) {
      const idx = Math.floor(Math.random() * pool.length);
      winners.push(pool.splice(idx, 1)[0]);
    }
    giveaway.winners = winners;
    const ch = await client.channels.fetch(giveaway.channelId).catch(() => null);
    if (ch) {
      const msg = await ch.messages.fetch(giveaway.messageId).catch(() => null);
      if (msg) {
        const disabledRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`giveaway_join_${giveawayId}`).setLabel(`🎉 Zakończony (${giveaway.participants.size})`).setStyle(ButtonStyle.Secondary).setDisabled(true)
        );
        await msg.edit({ embeds: [buildGiveawayEmbed(giveaway)], components: [disabledRow] }).catch(() => {});
      }
      if (winners.length > 0) {
        await ch.send({ content: `🎉 **Konkurs zakończony!**\nGratulacje ${winners.map(w => `<@${w}>`).join(', ')}! Wygrałeś **${giveaway.prize}**! Skontaktuj się z <@${giveaway.creatorId}>.` });
      } else {
        await ch.send({ content: `😔 Konkurs na **${giveaway.prize}** zakończył się bez zwycięzcy.` });
      }
    }
    clearTimeout(giveawayTimers.get(giveawayId));
    giveawayTimers.delete(giveawayId);
  }
};
