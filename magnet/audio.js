import recordings from "./voice-data.js?v=2";

export const voices = Object.freeze({
  bian: Object.freeze(recordings.bian),
  zhang: Object.freeze(recordings.zhang),
  cui: Object.freeze(recordings.cui),
});
export const intro = Object.freeze(recordings.intro);

let activePlayback = null;
let openingPlayer = null;

export function stopRole() {
  const previous = activePlayback;
  activePlayback = null;
  previous?.stop();
}

export function playOpening() {
  if (typeof Audio !== "function") return Promise.resolve(false);
  openingPlayer?.pause();
  openingPlayer = new Audio(new URL("./assets/audio/opening.wav", import.meta.url));
  openingPlayer.volume = 0.7;
  return openingPlayer.play().then(() => true, () => false);
}

export async function playRole(id, callbacks = {}) {
  const script = id === "intro" ? intro : voices[id];
  if (!script) return false;
  stopRole();
  openingPlayer?.pause();
  const playback = { stop: () => {} };
  activePlayback = playback;

  if (typeof Audio === "function") {
    const player = new Audio(new URL(script.audio, import.meta.url));
    let shownCue = "";
    const showCue = () => {
      if (activePlayback !== playback) return;
      const cue = player.currentTime >= script.cue ? "note" : "line";
      if (cue === shownCue) return;
      shownCue = cue;
      callbacks.onCue?.(script[cue], cue);
    };
    playback.stop = () => {
      player.pause();
      player.onended = null;
      player.ontimeupdate = null;
      player.onerror = null;
    };
    player.ontimeupdate = showCue;
    player.onended = () => {
      if (activePlayback !== playback) return;
      activePlayback = null;
      callbacks.onEnd?.();
    };
    try {
      await player.play();
      if (activePlayback !== playback) return false;
      player.onerror = () => {
        if (activePlayback !== playback) return;
        activePlayback = null;
        callbacks.onError?.(player.error);
      };
      callbacks.onStart?.();
      showCue();
      return true;
    } catch {
      if (activePlayback !== playback) return false;
      playback.stop();
    }
  }

  activePlayback = null;
  callbacks.onError?.(new Error("当前浏览器无法播放普通话导赏。"));
  return false;
}
