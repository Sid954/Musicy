// Turns a Discord message into something playable (used by the right-click "Play this" command).
// Priority: audio attachment > music link > any other link > link preview / embed title > the message text.
const { clip } = require('./pager');

const AUDIO_EXTENSION = /\.(?:mp3|ogg|oga|opus|wav|flac|m4a|aac|weba)(?:$|[?#])/i;
const MUSIC_HOST = /(?:^|\.)(?:youtube\.com|youtu\.be|music\.youtube\.com|open\.spotify\.com|soundcloud\.com|bandcamp\.com)$/i;
const URL_PATTERN = /https?:\/\/[^\s<>"'`]+/gi;
const MAX_QUERY = 200;
const MAX_URL = 500;

const entries = (collection) => (collection?.values ? [...collection.values()] : Array.isArray(collection) ? collection : []);

function hostOf(url) {
  try { return new URL(url).hostname.toLowerCase(); } catch { return ''; }
}

// "https://x.test/a)," -> "https://x.test/a": links in sentences carry trailing punctuation.
function cleanUrl(url) {
  return url.replace(/[)\]}>.,;:!?*_~|]+$/g, '').slice(0, MAX_URL);
}

function urlsIn(text) {
  return [...String(text || '').matchAll(URL_PATTERN)].map((match) => cleanUrl(match[0])).filter((url) => hostOf(url));
}

// Plain text -> a search query: no mentions, emoji, markdown or links; null when nothing meaningful is left.
function textToQuery(text) {
  const cleaned = String(text || '')
    .replace(URL_PATTERN, ' ')
    .replace(/<a?:\w+:\d+>/g, ' ') // custom emoji
    .replace(/<[@#&!]+\d+>/g, ' ') // mentions
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[*_~`|>#]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // Needs something searchable: at least two characters, one of them a letter or number (a lone emoji is not a song).
  return cleaned.length >= 2 && /[\p{L}\p{N}]/u.test(cleaned) ? clip(cleaned, MAX_QUERY) : null;
}

// Returns { query, source } or null.
function extractPlayQuery(message) {
  if (!message) return null;

  const audio = entries(message.attachments).find((a) => String(a.contentType || '').startsWith('audio/') || AUDIO_EXTENSION.test(String(a.url || a.name || '')));
  if (audio?.url) return { query: String(audio.url).slice(0, MAX_URL), source: 'attachment' };

  const links = urlsIn(message.content);
  const music = links.find((url) => MUSIC_HOST.test(hostOf(url)));
  if (music) return { query: music, source: 'link' };
  if (links.length) return { query: links[0], source: 'link' };

  // Link previews and bot messages ("Now playing: ...") keep the useful part in the embed.
  for (const embed of entries(message.embeds)) {
    if (/^https?:\/\//i.test(String(embed.url || ''))) return { query: cleanUrl(embed.url), source: 'embed' };
  }
  for (const embed of entries(message.embeds)) {
    const title = textToQuery(embed.title);
    if (title) return { query: title, source: 'embed' };
  }

  const text = textToQuery(message.content);
  return text ? { query: text, source: 'text' } : null;
}

module.exports = { AUDIO_EXTENSION, MUSIC_HOST, extractPlayQuery, textToQuery, urlsIn, cleanUrl };
