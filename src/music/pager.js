// Pure pagination helpers shared by every paginated Discord view (queue, history, playlists, ...).
function pageCount(total, perPage) {
  return Math.max(1, Math.ceil(Math.max(0, total) / perPage));
}

function clampPage(page, total, perPage) {
  const wanted = Number.isFinite(page) ? Math.floor(page) : 0;
  return Math.min(Math.max(0, wanted), pageCount(total, perPage) - 1);
}

function pageSlice(items, page, perPage) {
  const current = clampPage(page, items.length, perPage);
  const start = current * perPage;
  return { page: current, pages: pageCount(items.length, perPage), start, items: items.slice(start, start + perPage) };
}

// Maps a nav action ("first" | "prev" | "next" | "last") to the new page index.
function pageFromAction(action, page, pages) {
  const last = Math.max(0, pages - 1);
  const target = { first: 0, prev: page - 1, next: page + 1, last }[action];
  return Math.min(Math.max(0, target ?? page), last);
}

function clip(text, max) {
  const value = String(text ?? '');
  return value.length > max ? `${value.slice(0, Math.max(0, max - 1))}…` : value;
}

// Text that is safe inside a markdown link label.
function linkText(text, max) {
  return clip(text, max).replace(/\[/g, '(').replace(/\]/g, ')');
}

module.exports = { pageCount, clampPage, pageSlice, pageFromAction, clip, linkText };
