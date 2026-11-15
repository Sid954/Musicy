const { parseSeekTime, isSeekableTrack } = require('../music/time');
const { needQueue, reply, authorize } = require('./_util');
const embeds = require('../embeds');

async function seekTo(i, restart = false) {
  if (!await authorize(i)) return;
  const q = await needQueue(i);
  if (!q) return;
  if (!q.current) return i.reply({ embeds: [embeds.error('Nothing is playing.')], ephemeral: true });
  if (!isSeekableTrack(q.current)) {
    return i.reply({ embeds: [embeds.error('Seeking is not available for live streams.')], ephemeral: true });
  }

  let target;
  if (restart) {
    target = 0;
  } else {
    const parsed = parseSeekTime(i.options.getString('time'));
    if (!parsed) {
      return i.reply({ embeds: [embeds.error('Use seconds, M:SS, H:MM:SS, or a relative offset like +30 or -15.')], ephemeral: true });
    }
    target = parsed.relative ? q.getElapsedSeconds() + parsed.seconds : parsed.seconds;
  }
  target = Math.max(0, Math.min(Math.floor(target), Math.floor(q.current.duration)));
  q.restartCurrent({ seek: target });
  await reply(i, restart ? 'Restarting the current track.' : `Seeking to **${Math.floor(target / 60)}:${String(target % 60).padStart(2, '0')}**.`);
}

module.exports = { seekTo };
