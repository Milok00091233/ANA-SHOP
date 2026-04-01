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
  legitChannelId: process.env.LEGIT_CHANNEL_ID,
};

const ticketData = new Map();

// ── Licznik z Railway Variables (przez process.env) ──
// Przechowujemy w pamięci, startujemy od wartości z env LEGIT_COUNT
let legitCount = parseInt(process.env.LEGIT_COUNT || '0', 10);

module.exports = (client) => {

  // ─────────────────────────────────────────────
  // LEGIT CHECK
  // ─────────────────────────────────────────────
  client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    if (!message.member) return;

    if (message.channel.id === config.legitChannelId) {
      // Usuń wszystko co nie jest od admina
      if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
        await message.delete().catch(() => {});
        return;
      }

      // Admin wysłał zdjęcie
      const hasImage = message.attachments.some(a =>
        a.contentType && a.contentType.startsWith('image/')
      );

      if (hasImage) {
        const attachment = message.attachments.find(a =>
          a.contentType && a.contentType.startsWith('image/')
        );

        const opisTransakcji = message.content?.trim() || 'Anarchia LifeSteal';
        legitCount++;

        await message.delete().catch(() => {});

        const embed = new EmbedBuilder()
          .setColor(0x2b2d31)
          .setDescription(
            `:wymiensianoksa: **${opisTransakcji}**\n\n` +
            `>>> **» ✅ LEGIT CHECK → ${legitCount}**\n` +
            `**» ✅ Klient potwierdził udaną transakcję**\n` +
            `**» 🏪 ANA SHOP - Bezpieczne zakupy**`
          )
          .setImage(attachment.url)
          .setFooter({ text: `ANA SHOP • Legit Check #${legitCount} • Dziś` })
          .setTimestamp();

        await message.channel.send({ embeds: [embed] });
      }
      return;
    }

    // ─────────────────────────────────────────────
    // KOMENDY ADMINA
    // ─────────────────────────────────────────────
    if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) return;

    if (message.content === '!setup') {
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

    if (message.content === '!pomoc') {
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

    if (message.content === '!weryfikacja') {
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
  });

  // ─────────────────────────────────────────────
  // POWITANIE NA #lobby
  // ─────────────────────────────────────────────
  client.on('guildMemberAdd', async (member) => {
    const lobbyChannel = member.guild.channels.cache.get(config.lobbyChannelId);
    if (!lobbyChannel) return;

    let inviterText = 'Nieznany';
    try {
      const invites = await member.guild.invites.fetch();
      // Porównaj z poprzednimi zaproszeniami
      const usedInvite = invites.find(i => i.uses > (client.inviteCache?.get(i.code) || 0));
      if (usedInvite) inviterText = `<@${usedInvite.inviter.id}>`;
      // Zaktualizuj cache
      if (!client.inviteCache) client.inviteCache = new Map();
      invites.forEach(i => client.inviteCache.set(i.code, i.uses));
    } catch (e) {}

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle('👋 Nowy członek dołączył!')
      .setThumbnail(member.user.displayAvatarURL({ dynamic: true, size: 256 }))
      .addFields(
        { name: '👤 Użytkownik', value: `${member} (${member.user.username})`, inline: true },
        { name: '🆔 ID', value: member.id, inline: true },
        { name: '📨 Zaproszony przez', value: inviterText, inline: false },
        { name: '📅 Konto założone', value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`, inline: true },
        { name: '👥 Członków na serwerze', value: `${member.guild.memberCount}`, inline: true },
      )
      .setFooter({ text: 'ANA SHOP • Najlepszy sklep' })
      .setTimestamp();

    await lobbyChannel.send({ embeds: [embed] });
  });

  // Cache zaproszeń przy starcie bota
  client.once('ready', async () => {
    client.inviteCache = new Map();
    for (const guild of client.guilds.cache.values()) {
      try {
        const invites = await guild.invites.fetch();
        invites.forEach(i => client.inviteCache.set(i.code, i.uses));
      } catch (e) {}
    }
    console.log('✅ Cache zaproszeń załadowany');
  });

  // ─────────────────────────────────────────────
  // INTERAKCJE
  // ─────────────────────────────────────────────
  client.on('interactionCreate', async (interaction) => {
    const { member, guild, channel } = interaction;
    const wlascicielRoleId = process.env.WLASCICIEL_ROLE_ID;

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

    if (customId === 'close_ticket') {
      if (!member.roles.cache.has(config.realizatorRoleId) && !member.permissions.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({ content: '❌ Tylko **Realizatorzy** mogą zamykać tickety!', ephemeral: true });
      }
      await interaction.reply({ content: '🔒 Zamykanie ticketu za 5 sekund...' });
      setTimeout(async () => { ticketData.delete(channel.id); await channel.delete().catch(() => {}); }, 5000);
    }

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

    if (customId === 'close_pomoc') {
      if (!member.roles.cache.has(wlascicielRoleId) && !member.permissions.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({ content: '❌ Tylko **Właściciel** może zamykać te tickety!', ephemeral: true });
      }
      await interaction.reply({ content: '🔒 Zamykanie ticketu za 5 sekund...' });
      setTimeout(async () => { ticketData.delete(channel.id); await channel.delete().catch(() => {}); }, 5000);
    }

  });
};
