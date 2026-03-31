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
} = require('discord.js');

const config = {
  realizatorRoleId: process.env.REALIZATOR_ROLE_ID,
  ticketCategoryId: process.env.TICKET_CATEGORY_ID,
  verifiedRoleId: process.env.VERIFIED_ROLE_ID,
  lobbyChannelId: process.env.LOBBY_CHANNEL_ID,
};

const ticketData = new Map();

// ─────────────────────────────────────────────
// SYSTEM ŚLEDZENIA ZAPROSZEŃ
// ─────────────────────────────────────────────
// inviteCache : guildId → Map(code → { uses, inviterId })
const inviteCache = new Map();

// joinedVia   : guildId → Map(memberId → inviterId)
//   kto kogo zaprosił (potrzebne gdy ktoś wychodzi)
const joinedVia = new Map();

// inviteStats : guildId → Map(inviterId → { joined: Set, left: Set })
//   joined = Set ID osób, które są teraz na serwerze
//   left   = Set ID osób, które wyszły
const inviteStats = new Map();

function getStats(guildId, inviterId) {
  if (!inviteStats.has(guildId)) inviteStats.set(guildId, new Map());
  const gMap = inviteStats.get(guildId);
  if (!gMap.has(inviterId)) gMap.set(inviterId, { joined: new Set(), left: new Set() });
  return gMap.get(inviterId);
}

module.exports = (client) => {

  // Załaduj zaproszenia po uruchomieniu bota
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

  // Aktualizuj cache gdy ktoś tworzy zaproszenie
  client.on('inviteCreate', (invite) => {
    const map = inviteCache.get(invite.guild.id) ?? new Map();
    map.set(invite.code, { uses: invite.uses ?? 0, inviterId: invite.inviter?.id ?? null });
    inviteCache.set(invite.guild.id, map);
  });

  // Usuń z cache gdy zaproszenie zostaje usunięte
  client.on('inviteDelete', (invite) => {
    inviteCache.get(invite.guild.id)?.delete(invite.code);
  });

  // ─────────────────────────────────────────────
  // POWITANIE NA #lobby + KTO ZAPROSIŁ
  // ─────────────────────────────────────────────
  client.on('guildMemberAdd', async (member) => {
    const lobbyChannel = member.guild.channels.cache.get(config.lobbyChannelId);
    if (!lobbyChannel) return;

    // Pobierz zaproszenia i porównaj z cache — znajdź który link użyto
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

    // Zapisz kto kogo zaprosił
    if (inviterId) {
      if (!joinedVia.has(member.guild.id)) joinedVia.set(member.guild.id, new Map());
      joinedVia.get(member.guild.id).set(member.id, inviterId);

      const stats = getStats(member.guild.id, inviterId);
      stats.joined.add(member.id);
      stats.left.delete(member.id); // na wypadek gdyby wrócił
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
  // KOMENDY: !setup, !pomoc, !weryfikacja
  // ─────────────────────────────────────────────
  client.on('messageCreate', async (message) => {
    if (!message.member) return;

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

    // !zaproszenia → statystyki zaproszeń (na serwerze / wyszło)
    if (message.content === '!zaproszenia') {
      const userId = message.author.id;
      const guildId = message.guild.id;

      const stats = getStats(guildId, userId);
      const onServer = stats.joined.size;
      const left     = stats.left.size;
      const total    = onServer + left;

      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle('📨 Twoje zaproszenia')
        .setThumbnail(message.author.displayAvatarURL({ dynamic: true, size: 128 }))
        .setDescription(`Statystyki zaproszeń dla ${message.author}`)
        .addFields(
          { name: '✅ Na serwerze',  value: `**${onServer}**`, inline: true },
          { name: '🚪 Wyszło',       value: `**${left}**`,     inline: true },
          { name: '🔢 Łącznie',      value: `**${total}**`,    inline: true },
        )
        .setFooter({ text: 'ANA SHOP • Najlepszy sklep • dane od ostatniego restartu bota' })
        .setTimestamp();

      // Usuń komendę — wyślij embed, auto-kasowanie po 20s
      await message.delete().catch(() => {});
      const reply = await message.channel.send({ content: `<@${userId}>`, embeds: [embed] });
      setTimeout(() => reply.delete().catch(() => {}), 20000);
    }
  });

  // ─────────────────────────────────────────────
  // WSZYSTKIE INTERAKCJE
  // ─────────────────────────────────────────────
  client.on('interactionCreate', async (interaction) => {
    const { member, guild, channel } = interaction;
    const wlascicielRoleId = process.env.WLASCICIEL_ROLE_ID;

    // ── Przycisk weryfikacji → otwórz modal ──
    if (interaction.isButton() && interaction.customId === 'verify_btn') {
      const modal = new ModalBuilder()
        .setCustomId('verify_modal')
        .setTitle('Weryfikacja');

      const input = new TextInputBuilder()
        .setCustomId('verify_answer')
        .setLabel('Czy NIE jesteś robotem? Wpisz TAK.')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('TAK')
        .setRequired(true);

      modal.addComponents(new ActionRowBuilder().addComponents(input));
      await interaction.showModal(modal);
      return;
    }

    // ── Odpowiedź z modala weryfikacji ──
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
          '🚨 Nie dajemy zwrotu środków za **przedwczesnewysłanie kodów.**\n\n' +
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
