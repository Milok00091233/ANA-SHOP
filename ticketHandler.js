const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} = require('discord.js');

const config = {
  realizatorRoleId: process.env.REALIZATOR_ROLE_ID,
  ticketCategoryId: process.env.TICKET_CATEGORY_ID,
  shopBannerUrl: process.env.SHOP_BANNER_URL,
};

// Przechowuje info o ticketach (w pamięci; można podmienić na bazę danych)
const ticketData = new Map();

module.exports = (client) => {

  // ─────────────────────────────────────────────
  // KOMENDA: !setup  → wysyła panel z przyciskiem
  // ─────────────────────────────────────────────
  client.on('messageCreate', async (message) => {
    if (message.content === '!setup' && message.member.permissions.has(PermissionFlagsBits.Administrator)) {
      const embed = new EmbedBuilder()
        .setColor(0x1a1a2e)
        .setTitle('🛒 MC SHOP — SKLEP')
        .setDescription(
          '>>> Witaj w naszym sklepie!\n\n' +
          'Aby złożyć zamówienie, kliknij przycisk poniżej.\n' +
          'Nasz realizator przejmie Twój ticket tak szybko jak to możliwe.\n\n' +
          '**Pamiętaj:**\n' +
          '🔴 Nie wysyłaj kodów Paysafecard ani paragonów dopóki realizator o to nie poprosi!\n' +
          '🔴 Nie odpisuj nikomu na PV — to SCAM!'
        )
        .setImage(config.shopBannerUrl)
        .setFooter({ text: 'MC SHOP • Najlepszy sklep' });

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('open_ticket')
          .setLabel('🎫 Otwórz Ticket')
          .setStyle(ButtonStyle.Primary)
      );

      await message.channel.send({ embeds: [embed], components: [row] });
      await message.delete().catch(() => {});
    }
  });

  // ─────────────────────────────────────────────
  // INTERAKCJE
  // ─────────────────────────────────────────────
  client.on('interactionCreate', async (interaction) => {

    // ── 1. Przycisk: Otwórz ticket ──────────────
    if (interaction.isButton() && interaction.customId === 'open_ticket') {
      await interaction.deferReply({ ephemeral: true });

      const guild = interaction.guild;
      const member = interaction.member;

      // Sprawdź czy użytkownik już ma otwarty ticket
      const existing = guild.channels.cache.find(
        (c) => c.name === `ticket-${member.user.username.toLowerCase().replace(/[^a-z0-9]/g, '')}` ||
               (ticketData.get(c.id)?.userId === member.id)
      );
      if (existing) {
        return interaction.editReply({
          content: `❌ Masz już otwarty ticket: ${existing}`,
        });
      }

      // Utwórz kanał ticketu
      const ticketChannel = await guild.channels.create({
        name: `ticket-${member.user.username.replace(/[^a-z0-9]/gi, '').toLowerCase()}`,
        type: ChannelType.GuildText,
        parent: config.ticketCategoryId,
        permissionOverwrites: [
          {
            id: guild.roles.everyone,
            deny: [PermissionFlagsBits.ViewChannel],
          },
          {
            id: member.id,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.SendMessages,
              PermissionFlagsBits.ReadMessageHistory,
            ],
          },
          {
            id: config.realizatorRoleId,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.SendMessages,
              PermissionFlagsBits.ReadMessageHistory,
              PermissionFlagsBits.ManageChannels,
            ],
          },
        ],
      });

      // Zapisz dane ticketu
      ticketData.set(ticketChannel.id, {
        userId: member.id,
        username: member.user.username,
        claimedBy: null,
        przedmiot: 'Nie podano',
        openedAt: new Date(),
      });

      // ── Embed: Info o sprzedaży (jak na zdjęciu) ──
      const infoEmbed = new EmbedBuilder()
        .setColor(0xff0000)
        .setTitle('🔴 MCSHOP × TICKET SPRZEDAZ')
        .addFields(
          {
            name: '>> INFORMACJE O UZYTKOWNIKU',
            value:
              `>>> **>> Ping:** ${member}\n` +
              `**>> Nazwa:** ${member.user.username}\n` +
              `**>> Id:** ${member.id}`,
          },
          {
            name: '>> INFORMACJE O SPRZEDAZY:',
            value: `>>> **>> Przedmiot:** *użytkownik poda poniżej*`,
          }
        )
        .setImage(config.shopBannerUrl)
        .setFooter({ text: 'MC SHOP • Najlepszy sklep' });

      // ── Embed: Powitanie (jak na zdjęciu) ──
      const welcomeEmbed = new EmbedBuilder()
        .setColor(0x2b2d31)
        .setDescription(
          '🎉 **Dziękujemy za skorzystanie z naszych usług!**\n\n' +
          '>>> Prosimy o oznaczenie roli **realizatorów**, jeżeli nikt od kilku minut nie przejął ticketa. ' +
          'Pamiętaj: Nie wysyłaj kodów **Paysafecard** ani paragonów dopóki ticket nie zostanie przejęty i realizator o to nie poprosi!\n' +
          '🚨 Nie dajemy zwrotu środków za **przedwczesnewysłanie kodów.**\n\n' +
          '**NIE ODPISUJ NIKOMU NA PV, TO SCAM!**'
        );

      // ── Przycisk: Przejmij ticket ──
      const claimRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('claim_ticket')
          .setLabel('✅ Przejmij ticket')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId('close_ticket')
          .setLabel('🔒 Zamknij ticket')
          .setStyle(ButtonStyle.Danger)
      );

      // Ping realizatora
      const realizatorRole = guild.roles.cache.get(config.realizatorRoleId);
      await ticketChannel.send({
        content: `${member} | <@&${config.realizatorRoleId}>`,
      });
      await ticketChannel.send({ embeds: [infoEmbed] });
      await ticketChannel.send({ embeds: [welcomeEmbed], components: [claimRow] });

      await interaction.editReply({
        content: `✅ Twój ticket został otwarty: ${ticketChannel}`,
      });
    }

    // ── 2. Przycisk: Przejmij ticket ────────────
    if (interaction.isButton() && interaction.customId === 'claim_ticket') {
      const member = interaction.member;
      const realizatorRole = interaction.guild.roles.cache.get(config.realizatorRoleId);

      // Sprawdź czy użytkownik ma rangę realizatora
      if (!member.roles.cache.has(config.realizatorRoleId)) {
        return interaction.reply({
          content: '❌ Tylko **Realizatorzy** mogą przejmować tickety!',
          ephemeral: true,
        });
      }

      const data = ticketData.get(interaction.channel.id);
      if (!data) return interaction.reply({ content: '❌ Błąd danych ticketu.', ephemeral: true });

      if (data.claimedBy) {
        return interaction.reply({
          content: `❌ Ten ticket został już przejęty przez <@${data.claimedBy}>!`,
          ephemeral: true,
        });
      }

      // Oznacz ticket jako przejęty
      data.claimedBy = member.id;
      ticketData.set(interaction.channel.id, data);

      // Zaktualizuj nazwę kanału
      await interaction.channel.setName(`claimed-${interaction.channel.name.replace('ticket-', '')}`).catch(() => {});

      const claimedEmbed = new EmbedBuilder()
        .setColor(0x57f287)
        .setDescription(`✅ Ticket przejęty przez ${member}!\n\nRealizator wkrótce się z Tobą skontaktuje.`);

      // Wyłącz przycisk Przejmij
      const disabledRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('claim_ticket')
          .setLabel(`✅ Przejęty przez ${member.user.username}`)
          .setStyle(ButtonStyle.Success)
          .setDisabled(true),
        new ButtonBuilder()
          .setCustomId('close_ticket')
          .setLabel('🔒 Zamknij ticket')
          .setStyle(ButtonStyle.Danger)
      );

      await interaction.update({ components: [disabledRow] });
      await interaction.channel.send({ embeds: [claimedEmbed] });
    }

    // ── 3. Przycisk: Zamknij ticket ─────────────
    if (interaction.isButton() && interaction.customId === 'close_ticket') {
      const member = interaction.member;

      if (!member.roles.cache.has(config.realizatorRoleId) && !member.permissions.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({
          content: '❌ Tylko **Realizatorzy** mogą zamykać tickety!',
          ephemeral: true,
        });
      }

      await interaction.reply({ content: '🔒 Zamykanie ticketu za 5 sekund...' });
      setTimeout(async () => {
        ticketData.delete(interaction.channel.id);
        await interaction.channel.delete().catch(() => {});
      }, 5000);
    }

  });
};
