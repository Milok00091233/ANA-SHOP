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
} = require('discord.js');

const config = {
  realizatorRoleId: process.env.REALIZATOR_ROLE_ID,
  ticketCategoryId: process.env.TICKET_CATEGORY_ID,
  verifiedRoleId:   process.env.VERIFIED_ROLE_ID,
  lobbyChannelId:   process.env.LOBBY_CHANNEL_ID,
  legitChannelId:   process.env.LEGIT_CHANNEL_ID,
  wlascicielRoleId: process.env.WLASCICIEL_ROLE_ID,
  // Nazwa serwera wyświetlana na legit checkach
  legitServerName:  process.env.LEGIT_SERVER_NAME || 'Anarchia LifeSteal',
};

const ticketData = new Map();

// ─────────────────────────────────────────────
// SYSTEM ŚLEDZENIA ZAPROSZEŃ
// ─────────────────────────────────────────────
const inviteCache = new Map();
const joinedVia   = new Map();
const inviteStats = new Map();

function getStats(guildId, inviterId) {
  if (!inviteStats.has(guildId)) inviteStats.set(guildId, new Map());
  const gMap = inviteStats.get(guildId);
  if (!gMap.has(inviterId)) gMap.set(inviterId, { joined: new Set(), left: new Set() });
  return gMap.get(inviterId);
}

module.exports = (client) => {

  // ─────────────────────────────────────────────
  // ZAPROSZENIA — ładowanie przy starcie
  // ─────────────────────────────────────────────
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
  });

  client.on('inviteCreate', (invite) => {
    const map = inviteCache.get(invite.guild.id) ?? new Map();
    map.set(invite.code, { uses: invite.uses ?? 0, inviterId: invite.inviter?.id ?? null });
    inviteCache.set(invite.guild.id, map);
  });

  client.on('inviteDelete', (invite) => {
    inviteCache.get(invite.guild.id)?.delete(invite.code);
  });

  // ─────────────────────────────────────────────
  // POWITANIE NA #lobby + KTO ZAPROSIŁ
  // ─────────────────────────────────────────────
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
      stats.joined.add(member.id);
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

  // ─────────────────────────────────────────────
  // ŚLEDZENIE WYJŚĆ
  // ─────────────────────────────────────────────
  client.on('guildMemberRemove', (member) => {
    const guildJoinedVia = joinedVia.get(member.guild.id);
    if (!guildJoinedVia) return;
    const originalInviterId = guildJoinedVia.get(member.id);
    if (!originalInviterId) return;
    const stats = getStats(member.guild.id, originalInviterId);
    stats.joined.delete(member.id);
    stats.left.add(member.id);
  });

  // ─────────────────────────────────────────────
  // LEGIT CHECK — zdjęcie na kanale legit
  // ─────────────────────────────────────────────
  client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    if (!message.guild) return;
    if (!config.legitChannelId) return;
    if (message.channel.id !== config.legitChannelId) return;

    // Tylko właściciel i realizatorzy mogą wysyłać
    const isWlasciciel  = message.member.roles.cache.has(config.wlascicielRoleId);
    const isRealizator  = message.member.roles.cache.has(config.realizatorRoleId);
    const isAdmin       = message.member.permissions.has(PermissionFlagsBits.Administrator);
    if (!isWlasciciel && !isRealizator && !isAdmin) {
      await message.delete().catch(() => {});
      return;
    }

    // Musi zawierać zdjęcie
    const image = message.attachments.find(a => a.contentType?.startsWith('image/'));
    if (!image) {
      await message.delete().catch(() => {});
      return;
    }

    // Zapisz URL i pobierz dane zdjęcia PRZED usunięciem wiadomości
    const imageUrl  = image.url;
    const imageName = image.name || 'legit.png';

    // Odczytaj numer z nazwy kanału, np. "legit-rep-0" → 0
    const channelName   = message.channel.name;
    const match         = channelName.match(/(\d+)$/);
    const currentNumber = match ? parseInt(match[1]) : null;
    const nextNumber    = currentNumber !== null ? currentNumber + 1 : null;
    const legitNumber   = currentNumber !== null ? currentNumber + 1 : '?';

    // Pobierz zdjęcie jako bufor przed usunięciem wiadomości
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

    // Usuń wiadomość właściciela/realizatora
    await message.delete().catch(() => {});

    // Wyślij embed + zdjęcie
    const embed = new EmbedBuilder()
      .setColor(0x57f287)
      .setTitle(`✅ LEGIT CHECK → ${legitNumber}`)
      .addFields(
        { name: 'Kupno itemów',                  value: `>>> **${config.legitServerName}**`, inline: false },
        { name: 'Klient potwierdził transakcję – dziękujemy za zaufanie.', value: '\u200b', inline: false },
        { name: '💰 ANA SHOP — Bezpieczne zakupy', value: '\u200b', inline: false },
      )
      .setFooter({ text: 'ANA SHOP • Najlepszy sklep' })
      .setTimestamp();

    if (imageBuffer) {
      // Wyślij zdjęcie jako załącznik i użyj go w embedzie
      const { AttachmentBuilder } = require('discord.js');
      const attachment = new AttachmentBuilder(imageBuffer, { name: imageName });
      embed.setImage(`attachment://${imageName}`);
      await message.channel.send({ embeds: [embed], files: [attachment] });
    } else {
      // Fallback: użyj oryginalnego URL (może nie działać jeśli wiadomość usunięta)
      embed.setImage(imageUrl);
      await message.channel.send({ embeds: [embed] });
    }

    // Zmień nazwę kanału na następny numer
    if (nextNumber !== null) {
      const newName = channelName.replace(/\d+$/, String(nextNumber));
      await message.channel.setName(newName).catch(() => {});
    }
  });

  // ─────────────────────────────────────────────
  // KOMENDY: !setup, !pomoc, !weryfikacja, !zaproszenia, !kalkulator
  // ─────────────────────────────────────────────
  client.on('messageCreate', async (message) => {
    if (!message.member) return;
    if (message.author.bot) return;
    // Pomiń kanał legit (obsługiwany wyżej)
    if (message.channel.id === config.legitChannelId) return;

    // !setup → panel sklepu
    if (message.content === '!setup' && message.member.permissions.has(PermissionFlagsBits.Administrator)) {
      const embed = new EmbedBuilder()
        .setColor(0x1a1a2e)
        .setTitle('🛒 ANA SHOP — SKLEP')
        .setDescription(
          '>>> Witaj w naszym sklepie!\n\n' +
          'Aby złożyć zamówienie, kliknij przycisk poniżej.\n' +
          'Nasz realizator przejmie Twój ticket tak szybko jak to możliwe.\n\n' +
          '**Pamiętaj:**\n' +
          '🔴 Nie wysyłaj kodów Paysafecard ani paragonów dopóki realizator o to nie poprosi!\n' +
          '🔴 Nie odpisuj nikomu na PV — to SCAM!'
        )
        .setFooter({ text: 'ANA SHOP • Najlepszy sklep' });

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('open_ticket').setLabel('🎫 Otwórz Ticket').setStyle(ButtonStyle.Primary)
      );

      await message.channel.send({ embeds: [embed], components: [row] });
      await message.delete().catch(() => {});
    }

    // !pomoc → panel pomocy
    if (message.content === '!pomoc' && message.member.permissions.has(PermissionFlagsBits.Administrator)) {
      const embed = new EmbedBuilder()
        .setColor(0x1a1a2e)
        .setTitle('❓ ANA SHOP — POMOC')
        .setDescription(
          '>>> Potrzebujesz pomocy?\n\n' +
          'Kliknij przycisk poniżej aby otworzyć ticket pomocy.\n' +
          'Właściciel odpowie tak szybko jak to możliwe.\n\n' +
          '**NIE ODPISUJ NIKOMU NA PV — TO SCAM!**'
        )
        .setFooter({ text: 'ANA SHOP • Najlepszy sklep' });

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('open_pomoc').setLabel('❓ Otwórz Pomoc').setStyle(ButtonStyle.Secondary)
      );

      await message.channel.send({ embeds: [embed], components: [row] });
      await message.delete().catch(() => {});
    }

    // !weryfikacja → panel weryfikacji
    if (message.content === '!weryfikacja' && message.member.permissions.has(PermissionFlagsBits.Administrator)) {
      const embed = new EmbedBuilder()
        .setColor(0x57f287)
        .setTitle('✅ ANA SHOP — WERYFIKACJA')
        .setDescription(
          '**Aby zweryfikować konto:**\n\n' +
          '>>> **1.** Kliknij przycisk **Zweryfikuj** poniżej.\n' +
          '**2.** Wpisz **TAK** aby potwierdzić, że nie jesteś robotem.\n' +
          '**3.** Po poprawnej odpowiedzi otrzymasz rangę **zweryfikowany**.'
        )
        .setFooter({ text: 'ANA SHOP • Najlepszy sklep' });

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('verify_btn').setLabel('🔒 Zweryfikuj').setStyle(ButtonStyle.Success)
      );

      await message.channel.send({ embeds: [embed], components: [row] });
      await message.delete().catch(() => {});
    }

    // !zaproszenia → statystyki zaproszeń
    if (message.content === '!zaproszenia') {
      const userId  = message.author.id;
      const guildId = message.guild.id;
      const stats   = getStats(guildId, userId);

      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle('📨 Twoje zaproszenia')
        .setThumbnail(message.author.displayAvatarURL({ dynamic: true, size: 128 }))
        .setDescription(`Statystyki zaproszeń dla ${message.author}`)
        .addFields(
          { name: '✅ Na serwerze', value: `**${stats.joined.size}**`, inline: true },
          { name: '🚪 Wyszło',      value: `**${stats.left.size}**`,   inline: true },
          { name: '🔢 Łącznie',     value: `**${stats.joined.size + stats.left.size}**`, inline: true },
        )
        .setFooter({ text: 'ANA SHOP • Najlepszy sklep • dane od ostatniego restartu bota' })
        .setTimestamp();

      await message.delete().catch(() => {});
      const reply = await message.channel.send({ content: `<@${userId}>`, embeds: [embed] });
      setTimeout(() => reply.delete().catch(() => {}), 20000);
    }

    // !kalkulator → panel kalkulatora prowizji
    if (message.content === '!kalkulator' && message.member.permissions.has(PermissionFlagsBits.Administrator)) {
      const embed = new EmbedBuilder()
        .setColor(0x1a1a2e)
        .setTitle('🧮 ANA SHOP — KALKULATOR')
        .setDescription(
          '**Aby w szybki i prosty sposób obliczyć:**\n\n' +
          '› ile otrzymasz waluty za określoną ilość PLN\n' +
          '› ile musisz dać PLN, aby otrzymać określoną ilość waluty\n\n' +
          'Kliknij odpowiedni przycisk poniżej.'
        )
        .addFields({
          name: '💰 Prowizje wg metody płatności',
          value:
            '💳 PSC z paragonem — **15%**\n' +
            '💳 PSC bez paragonu — **25%**\n' +
            '📱 BLIK (przelew) — **0%**\n' +
            '📱 Kod BLIK — **10%**\n' +
            '🅿️ PayPal — **10%**\n' +
            '🪙 Kryptowaluty (LTC, SOL, BTC) — **0%**',
        })
        .setFooter({ text: 'ANA SHOP • Najlepszy sklep • kurs: 1 PLN = 7 000' });

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('calc_ile_otrzymam').setLabel('Ile otrzymam?').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('calc_ile_musze_dac').setLabel('Ile muszę dać?').setStyle(ButtonStyle.Secondary),
      );

      await message.channel.send({ embeds: [embed], components: [row] });
      await message.delete().catch(() => {});
    }
  });

  // ─────────────────────────────────────────────
  // WSZYSTKIE INTERAKCJE
  // ─────────────────────────────────────────────
  client.on('interactionCreate', async (interaction) => {
    const { member, guild, channel } = interaction;
    const wlascicielRoleId = config.wlascicielRoleId;

    // ── Kalkulator: przyciski → select menu metody ──
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

      await interaction.reply({
        content: '**Wybierz metodę płatności:**',
        components: [new ActionRowBuilder().addComponents(select)],
        ephemeral: true,
      });
      return;
    }

    // ── Kalkulator: wybrano metodę → modal z kwotą ──
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('calc_select_metoda_')) {
      const tryb   = interaction.customId.replace('calc_select_metoda_', '');
      const metoda = interaction.values[0];

      const modal = new ModalBuilder()
        .setCustomId(`calc_modal_${tryb}__${metoda}`)
        .setTitle('Obliczanie...');

      const kwotaLabel       = tryb === 'otrzymam' ? 'Kwota (w PLN):' : 'Kwota waluty (np. 125K):';
      const kwotaPlaceholder = tryb === 'otrzymam' ? 'Przykład: 150 (w PLN)' : 'Przykład: 125K lub 125000';

      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('calc_kwota')
            .setLabel(kwotaLabel)
            .setStyle(TextInputStyle.Short)
            .setPlaceholder(kwotaPlaceholder)
            .setRequired(true)
        )
      );

      await interaction.showModal(modal);
      return;
    }

    // ── Kalkulator: wynik ──
    if (interaction.isModalSubmit() && interaction.customId.startsWith('calc_modal_')) {
      const KURS = 7000;
      const PROWIZJE = {
        'psc_paragon':  { nazwa: '💳 PSC z paragonem',            procent: 15 },
        'psc_bez':      { nazwa: '💳 PSC bez paragonu',            procent: 25 },
        'blik_przelew': { nazwa: '📱 BLIK (przelew)',              procent: 0  },
        'blik_kod':     { nazwa: '📱 Kod BLIK',                    procent: 10 },
        'paypal':       { nazwa: '🅿️ PayPal',                     procent: 10 },
        'krypto':       { nazwa: '🪙 Kryptowaluty (LTC/SOL/BTC)',  procent: 0  },
      };

      const parts  = interaction.customId.replace('calc_modal_', '').split('__');
      const tryb   = parts[0];
      const metoda = PROWIZJE[parts[1]];

      if (!metoda) {
        await interaction.reply({ content: '❌ Błąd danych. Spróbuj ponownie.', ephemeral: true });
        return;
      }

      const rawKwota = interaction.fields.getTextInputValue('calc_kwota')
        .trim().replace(/,/g, '.').replace(/[kK]$/, '000');
      const kwota = parseFloat(rawKwota.replace(/[^0-9.]/g, ''));

      if (isNaN(kwota) || kwota <= 0) {
        await interaction.reply({ content: '❌ Nieprawidłowa kwota! Wpisz liczbę np. `150` lub `125K`.', ephemeral: true });
        return;
      }

      const prowizjaUlamek = metoda.procent / 100;
      let wynikText = '';

      if (tryb === 'otrzymam') {
        const netPLN      = kwota * (1 - prowizjaUlamek);
        const waluta      = Math.floor(netPLN * KURS);
        const prowizjaPLN = (kwota * prowizjaUlamek).toFixed(2);
        wynikText =
          `💵 Wpłacasz: **${kwota.toFixed(2)} PLN**\n` +
          `💸 Prowizja (${metoda.procent}%): **${prowizjaPLN} PLN**\n` +
          `🎮 Otrzymasz: **${waluta.toLocaleString('pl-PL')} waluty**`;
      } else {
        const brutoPLN    = prowizjaUlamek < 1 ? (kwota / KURS) / (1 - prowizjaUlamek) : kwota / KURS;
        const prowizjaPLN = (brutoPLN * prowizjaUlamek).toFixed(2);
        wynikText =
          `🎮 Chcesz: **${kwota.toLocaleString('pl-PL')} waluty**\n` +
          `💸 Prowizja (${metoda.procent}%): **${prowizjaPLN} PLN**\n` +
          `💵 Musisz zapłacić: **${brutoPLN.toFixed(2)} PLN**`;
      }

      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle('🧮 ANA SHOP — Wynik kalkulatora')
        .addFields(
          { name: '💳 Metoda płatności', value: metoda.nazwa, inline: false },
          { name: '📊 Obliczenia',       value: wynikText,    inline: false },
        )
        .setFooter({ text: 'ANA SHOP • kurs: 1 PLN = 7 000' })
        .setTimestamp();

      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }

    // ── Weryfikacja: przycisk → modal ──
    if (interaction.isButton() && interaction.customId === 'verify_btn') {
      const modal = new ModalBuilder()
        .setCustomId('verify_modal')
        .setTitle('Weryfikacja');

      modal.addComponents(new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('verify_answer')
          .setLabel('Czy NIE jesteś robotem? Wpisz TAK.')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('TAK')
          .setRequired(true)
      ));

      await interaction.showModal(modal);
      return;
    }

    // ── Weryfikacja: odpowiedź ──
    if (interaction.isModalSubmit() && interaction.customId === 'verify_modal') {
      const answer = interaction.fields.getTextInputValue('verify_answer').trim().toUpperCase();
      if (answer === 'TAK') {
        const role = guild.roles.cache.get(config.verifiedRoleId);
        if (role) {
          await member.roles.add(role).catch(() => {});
          await interaction.reply({ content: '✅ Zostałeś zweryfikowany i otrzymałeś rangę **zweryfikowany**!', ephemeral: true });
        } else {
          await interaction.reply({ content: '❌ Błąd: Nie znaleziono roli. Skontaktuj się z adminem.', ephemeral: true });
        }
      } else {
        await interaction.reply({ content: '❌ Niepoprawna odpowiedź! Wpisz **TAK** aby się zweryfikować.', ephemeral: true });
      }
      return;
    }

    if (!interaction.isButton()) return;
    const customId = interaction.customId;

    // ── Otwórz ticket sklepu ──
    if (customId === 'open_ticket') {
      await interaction.deferReply({ ephemeral: true });

      const existing = guild.channels.cache.find(
        (c) => ticketData.get(c.id)?.userId === member.id && ticketData.get(c.id)?.type === 'sklep'
      );
      if (existing) return interaction.editReply({ content: `❌ Masz już otwarty ticket: ${existing}` });

      const ticketChannel = await guild.channels.create({
        name: `ticket-${member.user.username.replace(/[^a-z0-9]/gi, '').toLowerCase()}`,
        type: ChannelType.GuildText,
        parent: config.ticketCategoryId,
        permissionOverwrites: [
          { id: guild.roles.everyone, deny: [PermissionFlagsBits.ViewChannel] },
          { id: member.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
          { id: config.realizatorRoleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels] },
        ],
      });

      ticketData.set(ticketChannel.id, { userId: member.id, username: member.user.username, claimedBy: null, type: 'sklep', openedAt: new Date() });

      const infoEmbed = new EmbedBuilder()
        .setColor(0xff0000)
        .setTitle('🔴 ANA SHOP × TICKET SPRZEDAZ')
        .addFields(
          { name: '>> INFORMACJE O UZYTKOWNIKU', value: `>>> **>> Ping:** ${member}\n**>> Nazwa:** ${member.user.username}\n**>> Id:** ${member.id}` },
          { name: '>> INFORMACJE O SPRZEDAZY:', value: `>>> **>> Przedmiot:** *użytkownik poda poniżej*` }
        )
        .setFooter({ text: 'ANA SHOP • Najlepszy sklep' });

      const welcomeEmbed = new EmbedBuilder()
        .setColor(0x2b2d31)
        .setDescription(
          '🎉 **Dziękujemy za skorzystanie z naszych usług!**\n\n' +
          '>>> Prosimy o oznaczenie roli **realizatorów**, jeżeli nikt od kilku minut nie przejął ticketa. ' +
          'Pamiętaj: Nie wysyłaj kodów **Paysafecard** ani paragonów dopóki ticket nie zostanie przejęty i realizator o to nie poprosi!\n' +
          '🚨 Nie dajemy zwrotu środków za **przedwczesne wysłanie kodów.**\n\n' +
          '**NIE ODPISUJ NIKOMU NA PV, TO SCAM!**'
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

    // ── Przejmij ticket sklepu ──
    if (customId === 'claim_ticket') {
      if (!member.roles.cache.has(config.realizatorRoleId)) {
        return interaction.reply({ content: '❌ Tylko **Realizatorzy** mogą przejmować tickety!', ephemeral: true });
      }
      const data = ticketData.get(channel.id);
      if (!data) return interaction.reply({ content: '❌ Błąd danych ticketu.', ephemeral: true });
      if (data.claimedBy) return interaction.reply({ content: `❌ Ticket już przejęty przez <@${data.claimedBy}>!`, ephemeral: true });

      data.claimedBy = member.id;
      ticketData.set(channel.id, data);
      await channel.setName(`claimed-${channel.name.replace('ticket-', '')}`).catch(() => {});

      const disabledRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('claim_ticket').setLabel(`✅ Przejęty przez ${member.user.username}`).setStyle(ButtonStyle.Success).setDisabled(true),
        new ButtonBuilder().setCustomId('close_ticket').setLabel('🔒 Zamknij ticket').setStyle(ButtonStyle.Danger)
      );

      await interaction.update({ components: [disabledRow] });
      await channel.send({ embeds: [new EmbedBuilder().setColor(0x57f287).setDescription(`✅ Ticket przejęty przez ${member}!\n\nRealizator wkrótce się z Tobą skontaktuje.`)] });
    }

    // ── Zamknij ticket sklepu ──
    if (customId === 'close_ticket') {
      if (!member.roles.cache.has(config.realizatorRoleId) && !member.permissions.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({ content: '❌ Tylko **Realizatorzy** mogą zamykać tickety!', ephemeral: true });
      }
      await interaction.reply({ content: '🔒 Zamykanie ticketu za 5 sekund...' });
      setTimeout(async () => { ticketData.delete(channel.id); await channel.delete().catch(() => {}); }, 5000);
    }

    // ── Otwórz ticket pomocy ──
    if (customId === 'open_pomoc') {
      try {
        await interaction.deferReply({ ephemeral: true });

        const existing = guild.channels.cache.find(
          (c) => ticketData.get(c.id)?.userId === member.id && ticketData.get(c.id)?.type === 'pomoc'
        );
        if (existing) return interaction.editReply({ content: `❌ Masz już otwarty ticket pomocy: ${existing}` });

        const pomocChannel = await guild.channels.create({
          name: `pomoc-${member.user.username.replace(/[^a-z0-9]/gi, '').toLowerCase()}`,
          type: ChannelType.GuildText,
          parent: config.ticketCategoryId,
          permissionOverwrites: [
            { id: guild.roles.everyone, deny: [PermissionFlagsBits.ViewChannel] },
            { id: member.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
            { id: wlascicielRoleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels] },
          ],
        });

        ticketData.set(pomocChannel.id, { userId: member.id, username: member.user.username, claimedBy: null, type: 'pomoc', openedAt: new Date() });

        const infoEmbed = new EmbedBuilder()
          .setColor(0xff0000)
          .setTitle('🔴 ANA SHOP × TICKET POMOC')
          .addFields(
            { name: '>> INFORMACJE O UZYTKOWNIKU', value: `>>> **>> Ping:** ${member}\n**>> Nazwa:** ${member.user.username}\n**>> Id:** ${member.id}` },
            { name: '>> TEMAT POMOCY:', value: `>>> **>> Opis:** *użytkownik poda poniżej*` }
          )
          .setFooter({ text: 'ANA SHOP • Najlepszy sklep' });

        const welcomeEmbed = new EmbedBuilder()
          .setColor(0x2b2d31)
          .setDescription('👋 **Witaj! Opisz swój problem poniżej.**\n\n>>> Właściciel odpowie tak szybko jak to możliwe.\n**NIE ODPISUJ NIKOMU NA PV — TO SCAM!**');

        const claimRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('claim_pomoc').setLabel('✅ Przejmij ticket').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId('close_pomoc').setLabel('🔒 Zamknij ticket').setStyle(ButtonStyle.Danger)
        );

        await pomocChannel.send({ content: `${member} | <@&${wlascicielRoleId}>` });
        await pomocChannel.send({ embeds: [infoEmbed] });
        await pomocChannel.send({ embeds: [welcomeEmbed], components: [claimRow] });
        await interaction.editReply({ content: `✅ Twój ticket pomocy został otwarty: ${pomocChannel}` });

      } catch (err) {
        console.error('Błąd przy otwieraniu ticketu pomocy:', err);
        if (interaction.deferred) await interaction.editReply({ content: '❌ Wystąpił błąd. Spróbuj ponownie.' }).catch(() => {});
      }
    }

    // ── Przejmij ticket pomocy ──
    if (customId === 'claim_pomoc') {
      if (!member.roles.cache.has(wlascicielRoleId) && !member.permissions.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({ content: '❌ Tylko **Właściciel** może przejmować te tickety!', ephemeral: true });
      }
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

    // ── Zamknij ticket pomocy ──
    if (customId === 'close_pomoc') {
      if (!member.roles.cache.has(wlascicielRoleId) && !member.permissions.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({ content: '❌ Tylko **Właściciel** może zamykać te tickety!', ephemeral: true });
      }
      await interaction.reply({ content: '🔒 Zamykanie ticketu za 5 sekund...' });
      setTimeout(async () => { ticketData.delete(channel.id); await channel.delete().catch(() => {}); }, 5000);
    }
  });
};
