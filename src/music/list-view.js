const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { pageSlice, pageCount, clampPage, pageFromAction, clip } = require('./pager');
const log = require('../log');

const PER_PAGE = 10;

function buildListEmbed({ title, items, page = 0, perPage = PER_PAGE, formatItem = (item) => item, numbered = true, emptyText = 'No items to show.' }) {
  const view = pageSlice(items, page, perPage);
  const lines = view.items.map((item, offset) => {
    const text = String(formatItem(item, view.start + offset));
    return numbered ? `\`${view.start + offset + 1}.\` ${text}` : text;
  });
  const description = lines.join('\n') || emptyText;
  const pageTitle = view.pages > 1 ? `${clip(title, 220)} · page ${view.page + 1}/${view.pages}` : clip(title, 256);
  return new EmbedBuilder().setColor(0x5865f2).setTitle(pageTitle).setDescription(clip(description, 4096));
}

function buildListRows({ prefix, page, pages, disabled = false }) {
  if (pages <= 1) return [];
  const button = (action, label, inactive) => new ButtonBuilder()
    .setCustomId(`${prefix}:${action}`).setLabel(label).setStyle(ButtonStyle.Secondary)
    .setDisabled(disabled || inactive);
  return [new ActionRowBuilder().addComponents(
    button('first', '⏮ First', page <= 0),
    button('prev', '◀ Prev', page <= 0),
    button('page', `${page + 1} / ${pages}`, true),
    button('next', 'Next ▶', page >= pages - 1),
    button('last', 'Last ⏭', page >= pages - 1),
  )];
}

async function showPaginatedList(interaction, {
  title, items, prefix, perPage = PER_PAGE, formatItem, numbered = true, emptyText,
  ephemeral = true, time = 120_000, editInitial = false,
}) {
  let page = 0;
  const render = (disabled = false) => {
    page = clampPage(page, items.length, perPage);
    const pages = pageCount(items.length, perPage);
    return {
      embeds: [buildListEmbed({ title, items, page, perPage, formatItem, numbered, emptyText })],
      components: buildListRows({ prefix, page, pages, disabled }),
    };
  };
  const first = render();
  if (editInitial) await interaction.editReply(first);
  else await interaction.reply({ ...first, ephemeral });
  if (!first.components.length) return;
  const message = await interaction.fetchReply();
  const collector = message.createMessageComponentCollector({
    time,
    filter: (component) => component.customId.startsWith(`${prefix}:`),
  });
  collector.on('collect', async (component) => {
    try {
      if (component.user.id !== interaction.user.id) {
        await component.reply({ content: 'This list belongs to someone else.', ephemeral: true });
        return;
      }
      page = pageFromAction(component.customId.slice(prefix.length + 1), page, pageCount(items.length, perPage));
      await component.update(render());
    } catch (error) {
      log.error(`Paginated list (${prefix}) failed:`, error);
      if (!component.deferred && !component.replied) {
        await component.reply({ content: 'Could not update this list. Please try again.', ephemeral: true }).catch(() => {});
      } else if (!component.replied) {
        await component.followUp({ content: 'Could not update this list. Please try again.', ephemeral: true }).catch(() => {});
      }
    }
  });
  collector.on('end', () => { interaction.editReply(render(true)).catch(() => {}); });
}

module.exports = { PER_PAGE, buildListEmbed, buildListRows, showPaginatedList };
