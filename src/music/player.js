// Per-guild queue + audio player state machine.
const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  entersState,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  StreamType,
  NoSubscriberBehavior,
} = require('@discordjs/voice');
const youtube = require('./sources/youtube');
const generic = require('./sources/ytdlp-generic');
const spotify = require('./sources/spotify');
const { validateHttpUrl } = require('./sources/url-safety');
const embeds = require('../embeds');
const store = require('../store');
const queueOps = require('./queue-ops');
const { shouldRetryStream } = require('./playback');
const { selectSource, attachSource } = require('./source-registry');
const autoplayOps = require('./autoplay');
const historyOps = require('./history');
const sponsorBlock = require('./sponsorblock');
const { validateEnqueue } = require('./queue-policy');
const log = require('../log');
const queueStore = require('./queue-store').createQueueStore();
const { snapshotQueue } = require('./queue-persistence');
const { resolveSavedTrack } = require('./saved-track');
const { createLiveProgressUpdater } = require('./live-progress');
const { composeFilters, tempoFactor, describeEffects } = require('./effects');
const { describeSleep } = require('./sleep');
const { createVoiceStatusUpdater } = require('./voice-status');
const { DEFAULT_LOUDNESS_LEVEL } = require('./filters');
const { createUndoStack } = require('./undo-stack');
const { describeVoiceAccess, MUTED_MESSAGE } = require('./voice-access');
const listeningStats = require('./listening-stats');
const { jukebox } = require('./jukebox');
const { nextReconnect } = require('./stations');
const { dedupeAgainst, dedupeQueue } = require('./collection');
const { buildNowPlayingCard, buildNowPlayingEmbed, buildNowPlayingRows, buildFinishedEmbed } = require('./nowplaying-view');
const { createConcurrencyLimiter } = require('./rate-limit');
const { createYtdlpRefresher } = require('./ytdlp-refresh');
const { update: updateYtdlp } = require('../../scripts/update-ytdlp');
const refreshYtdlp = createYtdlpRefresher();

// Message edits/deletes are best-effort cosmetics: never let them throw into queue state changes.
const quietly = (action) => { try { Promise.resolve(action()).catch(() => {}); } catch { /* ignore */ } };
const limitResolve = createConcurrencyLimiter(2);

const EARLY_END_SECONDS = 10;
const sources = [spotify, youtube, generic]; // add new source modules here
const IDLE_MS = (parseInt(process.env.IDLE_LEAVE_MINUTES, 10) || 3) * 60 * 1000;
const queues = new Map();

class GuildQueue {
  constructor(guildId, voiceChannel, textChannel) {
    this.guildId = guildId;
    this.textChannel = textChannel;
    this.voiceChannelId = voiceChannel.id;
    this.voiceChannel = voiceChannel;
    this.client = voiceChannel.client;
    this.reconnecting = false;
    this.tracks = [];
    this.current = null;
    this.history = [];
    this.skipVotes = new Set();
    this.voteTrack = null;
    this.loop = 'off'; // off | track | queue
    const settings = store.get(guildId);
    this.lastTrack = null;
    this.autoplayHistory = [];
    this.autoplayLoading = false;
    this.autoplay = Boolean(settings.autoplay);
    this.autoplaySuppressed = false;
    this.filterPresets = settings.filterPresets || [];
    this.autoNormalize = settings.levelingEnabled !== false;
    this.normalizeLevel = settings.loudnessLevel || DEFAULT_LOUDNESS_LEVEL;
    this.sponsorBlock = Boolean(settings.sponsorBlock);
    this.sponsorTimer = null;
    this.sponsorController = null;
    this.sponsorSegments = [];
    this.persistenceTimer = null;
    this.speed = settings.speed ?? 1;
    this.pitch = settings.pitch ?? 0;
    this.eqPreset = settings.eqPreset || 'flat';
    this.eqBands = { ...(settings.eqBands || {}) };
    this.fade = Boolean(settings.fade);
    this.voiceStatus = createVoiceStatusUpdater({ rest: voiceChannel.client?.rest });
    this.undoStack = createUndoStack();
    this.sleepTimer = null;
    this.sleepAt = null;
    this.sleepAfterTrack = false;
    this.opts = { volume: settings.volume / 100, filters: this.rebuildFilters() };
    this.playGeneration = 0;
    this.killStream = null;
    this.streamController = null;
    this.offset = 0;
    this.prefetchController = null;
    this.prefetchTarget = null;
    this.prefetchTimer = null;
    this.suppressIdle = false;
    this.idleTimer = null;
    this.lastAnnouncement = null;
    this.lastAnnouncementTrack = null;
    this.progressUpdater = createLiveProgressUpdater({
      isEligible: () => Boolean(this.current && this.lastAnnouncement && this.current.duration > 0 && !this.current.isLive),
      isPaused: () => this.player?.state.status === AudioPlayerStatus.Paused,
      getListeners: () => {
        const members = this.voiceChannel?.members;
        return members?.filter ? members.filter((member) => !member.user?.bot).size : 0;
      },
      onTick: () => this.updateAnnouncementProgress(),
      onError: (error) => log.warn('Stopping now-playing progress updates:', error.message),
    });

    this.connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId,
      adapterCreator: voiceChannel.guild.voiceAdapterCreator,
      selfDeaf: true,
    });
    this.player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Pause } });
    this.connection.subscribe(this.player);

    this.connection.on(VoiceConnectionStatus.Disconnected, async () => {
      if (this.reconnecting) return;
      this.reconnecting = true;
      try {
        await Promise.race([
          entersState(this.connection, VoiceConnectionStatus.Signalling, 5000),
          entersState(this.connection, VoiceConnectionStatus.Connecting, 5000),
        ]);
        this.reconnecting = false;
        return;
      } catch {}
      if (!queues.has(this.guildId) || this.connection.state.status === VoiceConnectionStatus.Destroyed) {
        this.reconnecting = false;
        return;
      }
      try {
        this.connection.rejoin({ channelId: this.voiceChannelId, selfDeaf: true, selfMute: false });
        await entersState(this.connection, VoiceConnectionStatus.Ready, 15_000);
      } catch {
        this.destroy();
      } finally {
        this.reconnecting = false;
      }
    });
    this.player.on(AudioPlayerStatus.Idle, () => this.onIdle());
    this.player.on('stateChange', (oldState, newState) => {
      // Remember how much of the stream was actually played (the resource is gone once the player is idle).
      if (newState.status === AudioPlayerStatus.Idle && oldState.resource) this.lastPlaybackMs = oldState.resource.playbackDuration || 0;
      if (newState.status === AudioPlayerStatus.Playing) {
        if (this.lastAnnouncement) this.progressUpdater.start();
        this.schedulePrefetch();
        this.scheduleSponsorBlock();
      } else if (newState.status === AudioPlayerStatus.Paused || newState.status === AudioPlayerStatus.Idle) {
        this.progressUpdater.stop();
      }
    });
    this.player.on('error', (e) => {
      if (this.suppressIdle || this.retryingStream) return;
      this.cancelSponsorBlock();
      this.textChannel?.send({ embeds: [embeds.error(`Playback error: ${e.message}`)] }).catch(() => {});
      this.cleanupStream();
      this.advance();
    });
  }

  persist() {
    if (!store.get(this.guildId).twentyFourSeven) { queueStore.delete(this.guildId); return; }
    queueStore.set(this.guildId, snapshotQueue(this));
  }

  // Queue snapshots for /undo: the track list as it was BEFORE a change that actually happened.
  remember(label, before) {
    this.undoStack.push(label, before);
  }

  // Restores the queue as it was before the last change. The playing track is never queued twice.
  undo() {
    const entry = this.undoStack.pop();
    if (!entry) return null;
    this.tracks = entry.tracks.filter((track) => track !== this.current);
    this.cancelPrefetch(true);
    this.persist();
    this.refreshAnnouncement();
    return { label: entry.label, count: this.tracks.length };
  }

  remove(position) {
    const before = [...this.tracks];
    const removed = queueOps.removeAt(this.tracks, position);
    if (removed) { this.remember('remove a track', before); this.cancelPrefetch(true); this.persist(); }
    return removed;
  }

  move(from, to) {
    const before = [...this.tracks];
    const moved = queueOps.moveTrack(this.tracks, from, to);
    if (moved) { this.remember('move a track', before); this.cancelPrefetch(true); this.persist(); }
    return moved;
  }

  shuffle(random) {
    if (this.tracks.length > 1) this.remember('shuffle', [...this.tracks]);
    queueOps.shuffleTracks(this.tracks, random);
    this.cancelPrefetch(true);
    this.persist();
  }

  clearQueue() {
    const count = this.tracks.length;
    if (count) this.remember('clear the queue', [...this.tracks]);
    this.tracks = [];
    this.cancelPrefetch(true);
    this.persist();
    return count;
  }

  skipTo(position) {
    const before = [...this.tracks];
    const result = queueOps.takeFromPosition(this.tracks, position);
    if (!result) return null;
    this.remember('skip ahead', before);
    this.tracks.splice(0, result.discarded);
    this.tracks.unshift(result.track);
    this.cancelPrefetch(true);
    this.persist();
    this.skip();
    return result.track;
  }

  playNext(tracks) {
    if (!Array.isArray(tracks) || tracks.length === 0) return false;
    tracks = this.withoutDuplicates(tracks);
    validateEnqueue({ queuedCount: this.tracks.length + (this.current ? 1 : 0), incoming: tracks, ...store.get(this.guildId) });
    this.autoplaySuppressed = false;
    this.remember(`play ${tracks.length === 1 ? 'a track' : `${tracks.length} tracks`} next`, [...this.tracks]);
    this.tracks.unshift(...tracks);
    this.cancelPrefetch(true);
    this.schedulePrefetch();
    this.persist();
    return true;
  }

  // Returns true if playback starts immediately (caller announces it), false if queued behind others.
  enqueue(tracks) {
    tracks = this.withoutDuplicates(tracks);
    validateEnqueue({ queuedCount: this.tracks.length + (this.current ? 1 : 0), incoming: tracks, ...store.get(this.guildId) });
    const startsNow = !this.current && this.player.state.status === AudioPlayerStatus.Idle;
    this.remember(`add ${tracks.length === 1 ? 'a track' : `${tracks.length} tracks`}`, [...this.tracks]);
    this.tracks.push(...tracks);
    this.autoplaySuppressed = false;
    this.cancelPrefetch(true);
    clearTimeout(this.idleTimer);
    if (startsNow) this.advance(true);
    this.persist();
    return startsNow;
  }

  scheduleIdleDestroy() {
    clearTimeout(this.idleTimer);
    if (store.get(this.guildId).twentyFourSeven) return;
    this.idleTimer = setTimeout(() => this.destroy(), IDLE_MS);
  }

  onIdle() {
    if (this.suppressIdle) {
      this.suppressIdle = false;
      return;
    }
    if (this.retryingStream) return;
    if (this.resumeIfEndedEarly()) return;
    if (this.current && !this.current.isLive) {
      listeningStats.recordListen(this.guildId, this.current.requestedById, this.skipping ? this.endedElapsed : this.current.duration);
    }
    this.cleanupStream();
    this.cancelPrefetch(false);
    this.cancelSponsorBlock();
    // A live station stream dropped (not skipped/stopped): reconnect a few times, keeping the card, before giving up.
    if (this.current?.station && !this.skipping && !this.sleepAfterTrack) {
      const track = this.current;
      const attempt = nextReconnect(track.reconnects);
      track.reconnects = attempt.history;
      if (attempt.allow) {
        setTimeout(() => { if (this.current === track && queues.get(this.guildId) === this) this.play(track, true); }, 2000).unref?.();
        return;
      }
      this.textChannel?.send({ embeds: [embeds.error(`The **${track.title}** stream keeps dropping, so I stopped it.`)] }).catch(() => {});
    }
    this.progressUpdater.stop();
    this.disableAnnouncement();
    if (this.sleepAfterTrack) { this.sleepNow(); return; }
    const skipped = this.skipping;
    this.skipping = false;
    if (this.current && this.loop === 'track' && !skipped) return this.play(this.current, true);
    if (this.current && this.loop === 'queue') this.tracks.push(this.current);
    this.advance();
  }

  advance(silent = false) {
    this.current = this.tracks.shift() || null;
    this.persist();
    this.skipVotes.clear();
    this.voteTrack = this.current;
    if (!this.current) {
      this.clearVoiceStatus();
      this.refreshController();
      clearTimeout(this.idleTimer);
      if (this.autoplay && !this.autoplaySuppressed && this.lastTrack) {
        this.loadAutoplay(this.lastTrack);
      } else {
        this.scheduleIdleDestroy();
      }
      return;
    }
    this.autoplayHistory = autoplayOps.rememberVideo(this.autoplayHistory, this.current);
    if (!this.current.autoplay) this.lastTrack = this.current;
    this.history = historyOps.addHistory(this.history, this.current);
    listeningStats.recordPlay(this.guildId, this.current);
    this.play(this.current, silent);
  }

  async loadAutoplay(previousTrack) {
    if (this.autoplayLoading || !this.autoplay || this.autoplaySuppressed || this.tracks.length || this.current) return;
    const videoId = autoplayOps.youtubeVideoId(previousTrack);
    if (!videoId) return;
    this.autoplayLoading = true;
    try {
      const tracks = await youtube.resolveMix(videoId, 50);
      if (!queues.has(this.guildId) || !this.autoplay || this.autoplaySuppressed || this.tracks.length || this.current) return;
      const track = autoplayOps.chooseUnplayed(tracks, this.autoplayHistory);
      if (!track) return;
      track.source = 'youtube';
      track.autoplay = true;
      this.current = track;
      this.autoplayHistory = autoplayOps.rememberVideo(this.autoplayHistory, track);
      this.play(track, false);
    } catch {
      // Autoplay is best-effort; a later track completion can retry.
    } finally {
      this.autoplayLoading = false;
      if (queues.has(this.guildId) && !this.current && !this.tracks.length) this.scheduleIdleDestroy();
    }
  }

  async play(track, silent = false, opts = {}) {
    if (this.killStream || this.streamController) this.cleanupStream();
    this.opts = {
      volume: opts.volume ?? this.opts.volume,
      filters: opts.filters ?? this.opts.filters,
    };
    const generation = ++this.playGeneration;
    this.offset = opts.seek ?? 0;
    this.persist();
    clearTimeout(this.persistenceTimer);
    const persistPosition = () => {
      if (!this.current) return;
      this.persist();
      this.persistenceTimer = setTimeout(persistPosition, 30_000);
      this.persistenceTimer.unref?.();
    };
    this.persistenceTimer = setTimeout(persistPosition, 30_000);
    this.persistenceTimer.unref?.();
    const controller = new AbortController();
    this.streamController = controller;
    const resolveStartedAt = Date.now();
    try {
      const src = sourceFor(track);
      if (src.resolveLazy && track.spotifyQuery) await src.resolveLazy(track);
      if (generation !== this.playGeneration || this.current !== track) return;
      let result;
      try {
        result = await sourceFor(track).stream(track, { ...this.opts, seek: opts.seek ?? 0, fade: this.fadeFor(track, opts.seek ?? 0), signal: controller.signal });
      } catch (error) {
        if (error.code !== 'UNKNOWN' || !src.name?.includes('youtube') || controller.signal.aborted) throw error;
        const refreshed = await refreshYtdlp(updateYtdlp);
        if (!refreshed || controller.signal.aborted || generation !== this.playGeneration) throw error;
        log.warn('yt-dlp extractor error; updated binary, retrying once', { guildId: this.guildId });
        result = await sourceFor(track).stream(track, { ...this.opts, seek: opts.seek ?? 0, fade: this.fadeFor(track, opts.seek ?? 0), signal: controller.signal });
      }
      if (generation !== this.playGeneration || this.current !== track) {
        result.kill();
        return;
      }
      log.info('play', JSON.stringify({ guildId: this.guildId, source: src.name, resolveMs: Date.now() - resolveStartedAt, title: track.title }));
      this.streamController = null;
      let retried = false;
      const retryStream = async (error) => {
        if (
          track.isLive
          || !shouldRetryStream({ error, outputBytes: result.outputBytes, alreadyRetried: retried })
          || generation !== this.playGeneration
          || this.current !== track
        ) return;
        retried = true;
        this.retryingStream = true;
        this.suppressIdle = true;
        result.kill();
        this.killStream = null;
        const resource = this.player.state.resource;
        if (resource) this.player.stop(true);
        try {
          let retryResult;
          if (error.code === 'UNKNOWN' && src.name === 'youtube' && await refreshYtdlp(updateYtdlp)) {
            log.warn('yt-dlp extractor stream error; updated binary, retrying once', { guildId: this.guildId });
            retryResult = await sourceFor(track).stream(track, { ...this.opts, seek: opts.seek ?? 0, fade: this.fadeFor(track, opts.seek ?? 0), signal: controller.signal });
          } else {
            retryResult = await sourceFor(track).stream(track, {
              ...this.opts, seek: opts.seek ?? 0, fade: this.fadeFor(track, opts.seek ?? 0), format: 'ba*', signal: controller.signal,
            });
          }
          if (generation !== this.playGeneration || this.current !== track) {
            retryResult.kill();
            return;
          }
          result = retryResult;
          this.retryingStream = false;
          this.suppressIdle = false;
          this.killStream = retryResult.kill;
          this.player.play(createAudioResource(retryResult.stream, { inputType: StreamType.OggOpus }));
        } catch (retryError) {
          if (generation !== this.playGeneration || this.current !== track) return;
          this.retryingStream = false;
          this.suppressIdle = false;
          this.textChannel?.send({ embeds: [embeds.error(`Failed to play **${track.title}**: ${retryError.message}`)] }).catch(() => {});
          this.cleanupStream();
          this.advance();
        }
      };
      result.stream.once('error', retryStream);
      this.killStream = result.kill;
      const resource = createAudioResource(result.stream, { inputType: StreamType.OggOpus });
      this.player.play(resource);
      this.afterTrackStart();
      if (!silent) this.announce(track);
      this.schedulePrefetch();
    } catch (e) {
      if (this.streamController === controller) this.streamController = null;
      if (generation !== this.playGeneration || this.current !== track) return;
      this.textChannel?.send({ embeds: [embeds.error(`Failed to play **${track.title}**: ${e.message}`)] }).catch(() => {});
      this.advance();
    }
  }

  // Badges for the Now Playing card: only settings that are actually active.
  getBadges() {
    const badges = [];
    if (this.loop !== 'off') badges.push(`${this.loop === 'track' ? '🔂' : '🔁'} Loop: ${this.loop}`);
    const volume = Math.round((this.opts.volume ?? 1) * 100);
    if (volume !== 100) badges.push(`🔊 ${volume}%`);
    const names = [...(this.filterPresets || [])];
    if (names.length) {
      const label = (name) => name.charAt(0).toUpperCase() + name.slice(1);
      badges.push(`🎚 ${names.slice(0, 3).map(label).join(', ')}${names.length > 3 ? ` +${names.length - 3}` : ''}`);
    }
    // Leveling being off is a plain setting (/normalize), not worth a badge; only mention a non-default level.
    if (this.autoNormalize && this.normalizeLevel !== DEFAULT_LOUDNESS_LEVEL) badges.push(`📏 ${this.normalizeLevel} loudness`);
    if (this.autoplay) badges.push('📻 Autoplay');
    const sleep = describeSleep({ sleepAt: this.sleepAt, afterTrack: this.sleepAfterTrack });
    if (sleep) badges.push(sleep);
    badges.push(...describeEffects({ speed: this.speed, pitch: this.pitch, eqPreset: this.eqPreset, eqBands: this.eqBands, fade: this.fade }));
    return badges;
  }

  // Plain data for buildNowPlayingCard (pure view code never touches the queue directly).
  getNowPlayingSnapshot(track = this.current, footer) {
    return {
      track,
      elapsed: this.getElapsedSeconds(),
      paused: this.player.state.status === AudioPlayerStatus.Paused,
      loop: this.loop,
      canPrevious: this.history.length > 1,
      badges: this.getBadges(),
      next: this.tracks[0] || null,
      queuedCount: this.tracks.length,
      remainingSeconds: this.tracks.reduce((sum, item) => sum + (item.duration > 0 ? item.duration : 0), 0),
      footer,
    };
  }

  // The card (embed + controls) for the current track, e.g. for a command reply that should stay interactive.
  getNowPlayingCard(track = this.current, footer) {
    return buildNowPlayingCard(this.getNowPlayingSnapshot(track, footer));
  }

  async announce(track) {
    this.progressUpdater.stop();
    this.disableAnnouncement();
    if (this.isJukeboxChannel(this.textChannel)) return;
    try {
      const { embed, rows } = this.getNowPlayingCard(track);
      const message = await this.textChannel?.send({ embeds: [embed], components: rows });
      if (message && this.current === track) this.adoptAnnouncement(message, track);
      else if (message) message.edit({ embeds: [buildFinishedEmbed(track)], components: [] }).catch(() => {});
    } catch (error) {
      log.error('Failed to send now-playing controls:', error);
    }
  }

  // Makes an existing bot message (e.g. a command reply) the live, editable Now Playing card.
  adoptAnnouncement(message, track = this.current) {
    this.progressUpdater.stop();
    this.disableAnnouncement();
    this.lastAnnouncement = message;
    this.lastAnnouncementTrack = track;
    if (this.player.state.status === AudioPlayerStatus.Playing) this.progressUpdater.start();
  }

  async updateAnnouncementProgress() {
    const message = this.lastAnnouncement;
    const track = this.current;
    if (!message || !track || this.player.state.status !== AudioPlayerStatus.Playing) return false;
    await message.edit({ embeds: [buildNowPlayingEmbed(this.getNowPlayingSnapshot(track))] });
    return true;
  }

  // Track ended / stopped: collapse the card (default), delete it, or just disable its buttons.
  disableAnnouncement() {
    this.progressUpdater.stop();
    const message = this.lastAnnouncement;
    const track = this.lastAnnouncementTrack;
    this.lastAnnouncement = null;
    this.lastAnnouncementTrack = null;
    if (!message) return;
    const mode = store.get(this.guildId).cleanupNowPlaying || 'edit';
    if (mode === 'delete') quietly(() => message.delete());
    else if (mode === 'keep') quietly(() => message.edit({ components: buildNowPlayingRows({ loop: this.loop, disabled: true }) }));
    else quietly(() => message.edit({ embeds: [buildFinishedEmbed(track)], components: [] }));
  }

  // Re-render the WHOLE card (embed + rows) after a state change: pause, loop, volume, filters, shuffle...
  refreshAnnouncement() {
    this.refreshController();
    if (!this.lastAnnouncement || !this.current) return Promise.resolve();
    const { embed, rows } = this.getNowPlayingCard(this.current);
    return Promise.resolve().then(() => this.lastAnnouncement?.edit({ embeds: [embed], components: rows })).catch(() => {});
  }

  updateAnnouncementControls() {
    return this.refreshAnnouncement();
  }

  // Elapsed SOURCE time: output time is scaled by the tempo of speed/nightcore/vaporwave filters.
  // Milliseconds of OUTPUT audio played so far for the current stream (overridable in tests).
  playbackMs() {
    return this.player.state.resource?.playbackDuration || 0;
  }

  getElapsedSeconds() {
    return this.offset + (this.playbackMs() / 1000) * this.tempoFactor();
  }

  tempoFactor() {
    return tempoFactor({ presets: this.filterPresets, speed: this.speed });
  }

  // Full ffmpeg filter chain from every per-guild effect (EQ, speed/pitch, presets, normalisation).
  rebuildFilters() {
    try {
      return composeFilters({
        eqPreset: this.eqPreset, eqBands: this.eqBands, speed: this.speed, pitch: this.pitch,
        filterPresets: this.filterPresets, autoNormalize: this.autoNormalize, normalizeLevel: this.normalizeLevel,
      });
    } catch (error) {
      log.warn('Ignoring invalid saved audio effects:', error.message);
      return [];
    }
  }

  // Recompute the chain and restart the current track at its position so the change is heard now.
  applyFilters() {
    this.opts.filters = this.rebuildFilters();
    if (this.current) this.restartCurrent({ volume: this.opts.volume, filters: this.opts.filters, seek: this.seekPositionForRestart() });
    else this.refreshAnnouncement();
    return this.opts.filters;
  }

  // Fade settings for one track (re-encode path only; undefined when fades are off or the track is live).
  fadeFor(track, seek = 0) {
    if (!this.fade || !track?.duration || track.isLive) return undefined;
    return { duration: track.duration, seek, tempo: this.tempoFactor() };
  }

  cancelSponsorBlock() {
    clearTimeout(this.sponsorTimer);
    this.sponsorTimer = null;
    this.sponsorController?.abort();
    this.sponsorController = null;
    this.sponsorSegments = [];
  }

  scheduleSponsorBlock() {
    this.cancelSponsorBlock();
    if (!this.sponsorBlock || !this.current || this.current.isLive || !this.current.duration) return;
    const track = this.current;
    const generation = this.playGeneration;
    const controller = new AbortController();
    this.sponsorController = controller;
    sponsorBlock.getSegments(track).then((segments) => {
      if (controller.signal.aborted || generation !== this.playGeneration || this.current !== track) return;
      this.sponsorSegments = segments;
      this.scheduleNextSponsorSegment(track, generation);
    }).catch(() => {}).finally(() => {
      if (this.sponsorController === controller) this.sponsorController = null;
    });
  }

  scheduleNextSponsorSegment(track = this.current, generation = this.playGeneration) {
    clearTimeout(this.sponsorTimer);
    this.sponsorTimer = null;
    if (!this.sponsorBlock || !track || this.current !== track || generation !== this.playGeneration) return;
    const elapsed = this.getElapsedSeconds();
    const segment = sponsorBlock.nextSegment(this.sponsorSegments, elapsed);
    if (!segment) return;
    if (elapsed >= segment.start) {
      this.restartCurrent({ seek: Math.ceil(segment.end), volume: this.opts.volume, filters: this.opts.filters });
      return;
    }
    this.sponsorTimer = setTimeout(() => {
      this.sponsorTimer = null;
      if (this.current !== track || generation !== this.playGeneration || !this.sponsorBlock) return;
      if (this.player.state.status === AudioPlayerStatus.Paused) {
        this.sponsorTimer = setTimeout(() => this.scheduleNextSponsorSegment(track, generation), 1000);
        this.sponsorTimer.unref?.();
        return;
      }
      this.scheduleNextSponsorSegment(track, generation);
    }, Math.max(100, (segment.start - elapsed) * 1000));
    this.sponsorTimer.unref?.();
  }

  schedulePrefetch() {
    clearTimeout(this.prefetchTimer);
    this.prefetchTimer = null;
    if (!this.current || this.tracks.length === 0) return;
    const next = this.tracks[0];
    // Queued tracks already carry a direct URL from /play; only re-fetch when it has expired.
    if (!next.duration || youtube.isAudioUrlFresh(next) || this.prefetchTarget === next) return;

    const remaining = Math.max(0, this.current.duration - this.getElapsedSeconds());
    const delay = Math.min(5000, Math.max(0, (remaining - 20) * 1000));
    this.prefetchTimer = setTimeout(() => {
      this.prefetchTimer = null;
      this.prefetchNext(next);
    }, delay);
    this.prefetchTimer.unref?.();
  }

  async prefetchNext(track) {
    if (this.tracks[0] !== track || !track.duration) return;
    this.cancelPrefetch(false);
    const controller = new AbortController();
    this.prefetchController = controller;
    this.prefetchTarget = track;
    try {
      let src = sourceFor(track);
      if (src.resolveLazy && track.spotifyQuery) {
        await src.resolveLazy(track);
        src = sourceFor(track);
      }
      if (src.prefetch) await src.prefetch(track, { signal: controller.signal });
    } catch {
      // Prefetch is best-effort; regular stream startup remains the fallback.
    } finally {
      if (this.prefetchController === controller) this.prefetchController = null;
    }
  }

  cancelPrefetch(clearCached = false) {
    clearTimeout(this.prefetchTimer);
    this.prefetchTimer = null;
    this.prefetchController?.abort();
    this.prefetchController = null;
    if (clearCached && this.prefetchTarget) delete this.prefetchTarget.prefetchedAudioUrl;
    this.prefetchTarget = null;
  }

  restartCurrent(opts = {}) {
    if (!this.current) return;
    const wasActive = this.player.state.status !== AudioPlayerStatus.Idle;
    if (wasActive) {
      this.suppressIdle = true;
      this.player.stop(true);
    }
    this.playGeneration++;
    this.cleanupStream();
    const started = this.play(this.current, true, opts); // sets this.opts synchronously
    this.refreshAnnouncement(); // badges (volume/filters/...) changed
    return started;
  }

  // Request-channel player message follows the queue (idle <-> now playing).
  refreshController() {
    quietly(() => jukebox.update(this.client, this.guildId, this.current ? this.getNowPlayingSnapshot() : null));
  }

  afterTrackStart() {
    this.syncVoiceStatus();
    this.refreshController();
  }

  // Inside the request channel the persistent player message replaces per-track announcements.
  isJukeboxChannel(channel) {
    const config = store.get(this.guildId).jukebox;
    return Boolean(config && channel && config.channelId === channel.id);
  }

  // Voice channel status = current track title (opt-in per server; best effort).
  syncVoiceStatus() {
    if (!store.get(this.guildId).voiceStatus || !this.current) return;
    quietly(() => this.voiceStatus.set(this.voiceChannelId, this.current));
  }

  clearVoiceStatus() {
    quietly(() => this.voiceStatus.clear(this.voiceChannelId));
  }

  // Sleep timer: stop and leave after N minutes, or when the current track ends.
  setSleep({ minutes = 0, afterTrack = false } = {}) {
    this.clearSleep();
    if (afterTrack) this.sleepAfterTrack = true;
    else if (minutes > 0) {
      this.sleepAt = Date.now() + minutes * 60_000;
      this.sleepTimer = setTimeout(() => this.sleepNow(), minutes * 60_000);
      this.sleepTimer.unref?.();
    }
    this.refreshAnnouncement();
  }

  clearSleep() {
    clearTimeout(this.sleepTimer);
    this.sleepTimer = null;
    this.sleepAt = null;
    this.sleepAfterTrack = false;
  }

  sleepNow() {
    this.textChannel?.send({ embeds: [embeds.info('😴 Sleep timer finished. Goodnight!')] }).catch(() => {});
    this.destroy();
  }

  // Skip tracks already queued/playing when the server enabled "skip duplicates".
  withoutDuplicates(tracks) {
    if (!store.get(this.guildId).skipDuplicates) return tracks;
    const kept = dedupeAgainst(tracks, [this.current, ...this.tracks]);
    if (!kept.length) throw new Error('That is already in the queue (duplicate skipping is on).');
    return kept;
  }

  // Removes duplicate videos from the upcoming queue; returns how many were removed.
  dedupe() {
    const { kept, removed } = dedupeQueue(this.tracks, this.current);
    if (removed) { this.remember('remove duplicates', [...this.tracks]); this.tracks = kept; this.cancelPrefetch(true); this.persist(); this.refreshAnnouncement(); }
    return removed;
  }

  // A finite song whose stream ended >10 s before its length (dropped connection, expired URL, ...) is resumed
  // from where it stopped, at most twice per song. Skips, stops and restarts never reach here.
  resumeIfEndedEarly() {
    const track = this.current;
    if (!track || track.isLive || !(track.duration > 0) || this.skipping || this.sleepAfterTrack) return false;
    const heard = this.offset + ((this.lastPlaybackMs || 0) / 1000) * this.tempoFactor();
    if (track.duration - heard <= EARLY_END_SECONDS || (track.earlyEndRetries || 0) >= 2) return false;
    track.earlyEndRetries = (track.earlyEndRetries || 0) + 1;
    log.warn('Song ended early; resuming', JSON.stringify({ guildId: this.guildId, title: track.title, heard: Math.round(heard), duration: track.duration, attempt: track.earlyEndRetries }));
    this.cleanupStream();
    this.play(track, true, { seek: Math.floor(heard) });
    return true;
  }

  // Position (whole seconds) to resume from when the current stream is restarted for a setting change.
  seekPositionForRestart() {
    return this.current?.duration > 0 && !this.current.isLive ? Math.floor(this.getElapsedSeconds()) : 0;
  }

  applyVolume(percent) {
    const level = Math.max(1, Math.min(200, Math.round(percent)));
    store.set(this.guildId, { volume: level });
    if (this.current) this.restartCurrent({ volume: level / 100, filters: this.opts.filters, seek: this.seekPositionForRestart() });
    else this.opts.volume = level / 100;
    return level;
  }

  // Replays the previously played track now; the track that was playing goes next. history[0] is the current track.
  previous() {
    const prev = this.history[1];
    if (!prev || !this.current) return null;
    const replay = historyOps.cloneReplay(prev);
    const resume = historyOps.cloneReplay(this.current);
    replay.requestedBy = prev.requestedBy;
    this.history = this.history.slice(2); // both are re-added by advance() when they actually play
    this.tracks.unshift(replay, resume);
    this.cancelPrefetch(true);
    this.persist();
    this.skip();
    return replay;
  }

  cleanupStream() {
    this.streamController?.abort();
    this.streamController = null;
    if (this.killStream) {
      this.killStream();
      this.killStream = null;
    }
  }

  skip() {
    this.endedElapsed = this.getElapsedSeconds(); // how much of the skipped track was actually heard
    this.progressUpdater.stop();
    this.cancelSponsorBlock();
    this.cancelPrefetch(true);
    const waitingForStream = Boolean(this.streamController && !this.killStream);
    this.playGeneration++;
    this.cleanupStream();
    this.skipping = true;
    if (waitingForStream) {
      this.skipping = false;
      this.advance();
      return;
    }
    this.player.stop(true); // triggers Idle -> onIdle -> advance
  }

  stop() {
    this.undoStack.clear(); // stopping empties the queue on purpose: nothing to go back to
    this.clearVoiceStatus();
    this.progressUpdater.stop();
    this.playGeneration++;
    this.skipVotes.clear();
    this.autoplaySuppressed = true;
    this.cancelSponsorBlock();
    this.cancelPrefetch(true);
    this.disableAnnouncement();
    this.tracks = [];
    this.current = null;
    this.persist();
    this.refreshController();
    this.player.stop(true);
    this.cleanupStream();
    this.scheduleIdleDestroy();
  }

  follow(channel) {
    if (!channel || channel.guild.id !== this.guildId) return false;
    this.voiceChannelId = channel.id;
    this.voiceChannel = channel;
    return this.connection.rejoin({ channelId: channel.id, selfDeaf: true, selfMute: false });
  }

  destroy({ preserve = false } = {}) {
    this.undoStack.clear();
    this.clearSleep();
    this.clearVoiceStatus();
    this.progressUpdater.stop();
    clearTimeout(this.persistenceTimer);
    if (!preserve) queueStore.delete(this.guildId);
    this.playGeneration++;
    this.cancelSponsorBlock();
    this.cancelPrefetch(true);
    this.disableAnnouncement();
    clearTimeout(this.idleTimer);
    this.cleanupStream();
    this.suppressIdle = true;
    this.player.stop(true);
    try { this.connection.destroy(); } catch {}
    queues.delete(this.guildId);
    quietly(() => jukebox.update(this.client, this.guildId, null));
  }
}

function sourceFor(track) {
  return sources.find((source) => source.name === track?.source) || youtube;
}

async function resolve(query) {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(query) && !sources.some((source) => source.canHandle?.(query))) {
    validateHttpUrl(query);
    throw new Error('No source can handle that URL.');
  }
  const source = selectSource(query, sources, youtube);
  return attachSource(await limitResolve(() => source.resolve(query)), source);
}

async function resolveMany(query, count = 5) {
  const source = /^scsearch\d*:/i.test(query) ? generic : selectSource(query, sources, youtube);
  const tracks = await limitResolve(() => source.resolveMany
    ? source.resolveMany(query, count)
    : source.resolve(query));
  return attachSource(tracks, source);
}

function destroyAll({ preserve = false } = {}) {
  for (const queue of [...queues.values()]) {
    if (preserve) queue.persist();
    queue.destroy({ preserve });
  }
}

function getQueue(guildId) {
  return queues.get(guildId);
}

function activeConnections() { return queues.size; }
function getQueues() { return [...queues.values()]; }

function clearCaches() {
  for (const queue of queues.values()) queue.cancelPrefetch(true);
  require('./autocomplete').clearCache();
  youtube.resolveCache.clear();
  sponsorBlock.clearCache();
}

function getOrCreate(guildId, voiceChannel, textChannel) {
  let q = queues.get(guildId);
  if (!q) {
    // Fail early with a clear reason instead of joining silently (missing Connect/Speak, full channel, ...).
    const problem = describeVoiceAccess(voiceChannel);
    if (problem) throw new Error(problem);
    q = new GuildQueue(guildId, voiceChannel, textChannel);
    queues.set(guildId, q);
  } else {
    q.textChannel = textChannel;
  }
  return q;
}

// Leave if the bot is alone in its channel.
function handleVoiceUpdate(oldState, newState) {
  const q = queues.get(oldState.guild.id);
  if (!q) return;
  const me = oldState.guild.members.me;
  // The bot was server-muted: it keeps "playing" but nobody can hear it. Say so once.
  if (newState.id === me?.id) {
    if (newState.serverMute && !oldState.serverMute && !q.mutedWarned) {
      q.mutedWarned = true;
      q.textChannel?.send({ embeds: [embeds.error(MUTED_MESSAGE)] }).catch(() => {});
    } else if (!newState.serverMute) {
      q.mutedWarned = false;
    }
  }
  if (newState.id === me?.id && newState.channelId && newState.channelId !== oldState.channelId) {
    const movedTo = newState.guild.channels.cache.get(newState.channelId);
    if (movedTo?.isVoiceBased()) q.follow(movedTo);
    return;
  }
  const ch = me?.voice?.channel;
  if (ch && ch.members.filter((m) => !m.user.bot).size === 0 && !store.get(q.guildId).twentyFourSeven) {
    clearTimeout(q.aloneTimer);
    q.aloneTimer = setTimeout(() => {
      const c = q.connection && oldState.guild.members.me?.voice?.channel;
      if (c && c.members.filter((m) => !m.user.bot).size === 0 && !store.get(q.guildId).twentyFourSeven) q.destroy();
    }, 60_000);
  }
}

async function restoreQueues(client) {
  for (const [guildId, saved] of queueStore.entries()) {
    if (!store.get(guildId).twentyFourSeven) { queueStore.delete(guildId); continue; }
    const guild = client.guilds.cache.get(guildId);
    const voiceChannel = guild?.channels.cache.get(saved.voiceChannelId);
    const textChannel = saved.textChannelId ? guild?.channels.cache.get(saved.textChannelId) : null;
    if (!voiceChannel?.isVoiceBased()) { queueStore.delete(guildId); continue; }
    const candidates = [...(saved.current ? [saved.current] : []), ...saved.tracks].slice(0, 100);
    const resolved = [];
    for (const item of candidates) {
      try {
        const tracks = await resolveSavedTrack(item, {
          resolve,
          resolveSpotifyQuery: (query) => youtube.resolve(query),
        });
        if (tracks[0]) resolved.push({ ...tracks[0], requestedBy: 'Restored queue' });
      } catch (error) { log.warn(`Skipping unavailable restored track in guild ${guildId}:`, error.message); }
    }
    const q = getOrCreate(guildId, voiceChannel, textChannel);
    q.loop = saved.loop;
    if (resolved.length) {
      q.current = resolved[0];
      q.tracks = resolved.slice(1);
      q.play(q.current, false, { seek: Math.min(saved.position, Math.max(0, (q.current.duration || 1) - 1)) });
    } else q.persist();
  }
}

async function flushQueues() { await queueStore.flush(); }
async function loadQueues() { return queueStore.load(); }

module.exports = { resolve, resolveMany, getQueue, getOrCreate, handleVoiceUpdate, destroyAll, restoreQueues, flushQueues, loadQueues, activeConnections, getQueues, clearCaches, GuildQueue };
