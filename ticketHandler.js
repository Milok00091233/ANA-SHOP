const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
} = require('discord.js');

const config = {
  realizatorRoleId: process.env.REALIZATOR_ROLE_ID || null,
  ticketCategoryId: process.env.TICKET_CATEGORY_ID || null,
};

const ticketData = new Map();

module.exports = (client) => {

  client.on('messageCreate', async (message) => {
    if (!message.member) return;

    // SETUP SKLEP
    if (message.content === '!setup' && message.member.permissions.has(PermissionFlagsBits.Administrator)) {

      const embed = new EmbedBuilder()
        .setColor(0x1a1a2e)
        .setTitle('🛒 MC SHOP — SKLEP')
        .setDescription(
          'Kliknij przycisk poniżej, aby otworzyć ticket.\n\n' +
          '⚠️ Nie wysyłaj kodów dopóki realizator nie poprosi!\n' +
          '⚠️ Nie pisz na PV — to scam!'
        );

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

  client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton()) return;

    const { customId, member, guild, channel } = interaction;
    if (!guild) return;

    // OTWIERANIE TICKETA
    if (customId === 'open_ticket') {
      await interaction.deferReply({ ephemeral: true });

      // sprawdź czy ma już ticket
      const existing = [...ticketData.entries()].find(
        ([, data]) => data.userId === member.id && data.type === 'sklep'
      );

      if (existing) {
        const ch = guild.channels.cache.get(existing[0]);
        return interaction.editReply({ content: `❌ Masz już ticket: ${ch}` });
      }

      // bezpieczna nazwa kanału
      const safeName = member.user.username
        .replace(/[^a-z0-9]/gi, '')
        .toLowerCase()
        .slice(0, 10);

      const ticketChannel = await guild.channels.create({
        name: `ticket-${safeName}`,
        type: ChannelType.GuildText,
        parent: config.ticketCategoryId || null,
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
            ],
          },
          ...(config.realizatorRoleId ? [{
            id: config.realizatorRoleId,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.SendMessages,
            ],
          }] : [])
        ],
      });

      ticketData.set(ticketChannel.id, {
        userId: member.id,
        claimedBy: null,
        type: 'sklep',
      });

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('claim_ticket')
          .setLabel('✅ Przejmij')
          .setStyle(ButtonStyle.Success),

        new ButtonBuilder()
          .setCustomId('close_ticket')
          .setLabel('🔒 Zamknij')
          .setStyle(ButtonStyle.Danger)
      );

      await ticketChannel.send({
        content: `${member}`,
        embeds: [
          new EmbedBuilder()
            .setDescription('Opisz co chcesz kupić.')
        ],
        components: [row],
      });

      await interaction.editReply({
        content: `✅ Ticket: ${ticketChannel}`,
      });
    }

    // PRZEJMOWANIE
    if (customId === 'claim_ticket') {
      const data = ticketData.get(channel?.id);
      if (!data) {
        return interaction.reply({ content: '❌ To nie jest ticket', ephemeral: true });
      }

      if (data.claimedBy) {
        return interaction.reply({
          content: `❌ Już przejęty`,
          ephemeral: true
        });
      }

      data.claimedBy = member.id;
      ticketData.set(channel.id, data);

      await interaction.update({
        components: []
      });

      await channel.send(`✅ Przejęty przez ${member}`);
    }

    // ZAMYKANIE
    if (customId === 'close_ticket') {
      if (!channel) return;

      await interaction.reply('Zamykam za 3s...');

      setTimeout(async () => {
        ticketData.delete(channel.id);
        await channel.delete().catch(() => {});
      }, 3000);
    }
  });
};
