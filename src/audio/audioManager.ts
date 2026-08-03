import { store } from "../state/store.ts";
import musicUrl from "../assets/audio/river-pipa.mp3";

export type SfxCue =
    | "tap"
    | "start"
    | "place"
    | "match"
    | "perfect"
    | "blocked"
    | "shuffle"
    | "tool"
    | "reward"
    | "victory"
    | "defeat"
    | "error";

export interface AudioDebugSnapshot {
    contextState: AudioContextState | "locked";
    musicRunning: boolean;
    /** Seconds into the streamed track. Advances only while it is playing. */
    musicTimeSeconds: number;
    /** True once the track element has buffered enough to start. */
    musicTrackReady: boolean;
    activeSfxVoices: number;
    suppressedSfx: number;
}

/**
 * The music is a streamed MP3 ("River Pipa"), looped, played through a
 * MediaElementAudioSourceNode so it shares the music bus, the limiter and the
 * pause lifecycle with the synth SFX. Streaming matters: the track is several
 * minutes long, and decoding it into an AudioBuffer would hold the whole
 * uncompressed waveform (~100 MB) in memory on a phone.
 */
class AudioManager {
    private context: AudioContext | null = null;
    private master: GainNode | null = null;
    private musicBus: GainNode | null = null;
    private sfxBus: GainNode | null = null;
    private musicElement: HTMLAudioElement | null = null;
    private sfxVoices = new Set<OscillatorNode>();
    private lastCueAt = new Map<SfxCue, number>();
    private suppressedSfx = 0;
    private paused = false;
    private hostPaused = false;
    private hostOverlayVisible = false;
    private pageHidden = document.visibilityState !== "visible";
    private bound = false;

    bind(): void {
        if (this.bound) return;
        this.bound = true;
        store.subscribe(() => this.sync());
        document.addEventListener("visibilitychange", () => {
            this.pageHidden = document.visibilityState !== "visible";
            this.applyPauseState();
        });
    }

    async unlock(): Promise<boolean> {
        try {
            this.ensureGraph();
            if (!this.context) return false;
            if (this.paused) return false;
            if (this.context.state === "suspended") {
                // WebKit leaves resume() pending FOREVER when the call is not
                // backed by recognized user activation. Never let that hang a
                // caller — UI actions may await unlock before proceeding.
                await Promise.race([
                    this.context.resume(),
                    new Promise<void>((resolve) => window.setTimeout(resolve, 300)),
                ]);
            }
            this.sync();
            return this.context.state === "running";
        } catch (error) {
            console.warn("[audio] WebAudio unavailable", error);
            return false;
        }
    }

    setPaused(paused: boolean): void {
        this.hostPaused = paused;
        this.applyPauseState();
    }

    /** Host-owned ads and checkout sheets are independent of lifecycle pause. */
    setHostOverlayVisible(visible: boolean): void {
        this.hostOverlayVisible = visible;
        this.applyPauseState();
    }

    private applyPauseState(): void {
        this.paused = this.hostPaused || this.pageHidden || this.hostOverlayVisible;
        if (!this.context) return;
        if (this.paused) {
            this.stopMusic();
            void this.context.suspend().catch(() => undefined);
        } else {
            void this.context
                .resume()
                .then(() => this.sync())
                .catch(() => undefined);
        }
    }

    play(cue: SfxCue): void {
        const state = store.get();
        if (!this.context || !this.sfxBus || this.paused || !state.sfxEnabled || state.sfxVolume <= 0) return;

        const cooldowns: Record<SfxCue, number> = {
            tap: 55,
            start: 180,
            place: 40,
            match: 70,
            perfect: 140,
            blocked: 140,
            shuffle: 260,
            tool: 160,
            reward: 260,
            victory: 400,
            defeat: 400,
            error: 220,
        };
        const realNow = performance.now();
        if (realNow - (this.lastCueAt.get(cue) ?? -Infinity) < cooldowns[cue]) {
            this.suppressedSfx += 1;
            return;
        }
        this.lastCueAt.set(cue, realNow);

        /**
         * Cues are glass and water, not beeps: short sines that RISE for the
         * good outcomes and fall for the bad ones, so the meaning of a sound is
         * legible before the player has learned the specific cue. Match/perfect
         * are multi-voice chimes so a successful shatter reads as reward, not a
         * single blip.
         */
        const now = this.context.currentTime;
        if (cue === "match") {
            this.playMatchChime(now, false);
            return;
        }
        if (cue === "perfect") {
            this.playMatchChime(now, true);
            return;
        }

        const cues: Record<
            Exclude<SfxCue, "match" | "perfect">,
            {
                frequency: number;
                endFrequency: number;
                duration: number;
                peak: number;
                type: OscillatorType;
            }
        > = {
            tap: { frequency: 440, endFrequency: 493.88, duration: 0.045, peak: 0.04, type: "sine" },
            start: { frequency: 293.66, endFrequency: 440, duration: 0.2, peak: 0.06, type: "triangle" },
            place: { frequency: 587.33, endFrequency: 523.25, duration: 0.07, peak: 0.035, type: "sine" },
            blocked: { frequency: 174.61, endFrequency: 155.56, duration: 0.09, peak: 0.032, type: "sine" },
            shuffle: { frequency: 220, endFrequency: 659.26, duration: 0.34, peak: 0.045, type: "triangle" },
            tool: { frequency: 493.88, endFrequency: 739.99, duration: 0.14, peak: 0.045, type: "sine" },
            reward: { frequency: 523.25, endFrequency: 1046.5, duration: 0.28, peak: 0.06, type: "triangle" },
            victory: { frequency: 391.995, endFrequency: 1174.66, duration: 0.62, peak: 0.07, type: "triangle" },
            defeat: { frequency: 261.626, endFrequency: 116.541, duration: 0.52, peak: 0.055, type: "triangle" },
            error: { frequency: 146.83, endFrequency: 110, duration: 0.16, peak: 0.045, type: "triangle" },
        };
        this.playTone(now, cues[cue]);
    }

    /**
     * Sea-glass success: a quick major arpeggio (E–G♯–B) with a soft high
     * shimmer. Perfect adds a fourth overtone and a little more sustain.
     */
    private playMatchChime(now: number, perfect: boolean): void {
        // E major triad, rising — reads as "clear / open" without a buzzy chord.
        const notes: Array<{
            frequency: number;
            endFrequency: number;
            delay: number;
            duration: number;
            peak: number;
            type: OscillatorType;
            attack: number;
        }> = [
            {
                frequency: 659.26, // E5
                endFrequency: 698.46,
                delay: 0,
                duration: 0.14,
                peak: 0.052,
                type: "sine",
                attack: 0.006,
            },
            {
                frequency: 830.61, // G#5
                endFrequency: 880.0,
                delay: 0.042,
                duration: 0.16,
                peak: 0.048,
                type: "sine",
                attack: 0.007,
            },
            {
                frequency: 987.77, // B5
                endFrequency: 1046.5,
                delay: 0.088,
                duration: 0.2,
                peak: 0.044,
                type: "triangle",
                attack: 0.008,
            },
            {
                // Soft upper sparkle — glass ring, not a loud lead.
                frequency: 1318.51, // E6
                endFrequency: 1480.0,
                delay: 0.06,
                duration: perfect ? 0.32 : 0.24,
                peak: perfect ? 0.028 : 0.02,
                type: "sine",
                attack: 0.012,
            },
        ];
        if (perfect) {
            notes.push({
                frequency: 1567.98, // G6
                endFrequency: 1760.0,
                delay: 0.14,
                duration: 0.34,
                peak: 0.022,
                type: "triangle",
                attack: 0.014,
            });
        }
        for (const note of notes) {
            this.playTone(now + note.delay, {
                frequency: note.frequency,
                endFrequency: note.endFrequency,
                duration: note.duration,
                peak: note.peak,
                type: note.type,
                attack: note.attack,
            });
        }
    }

    private playTone(
        startTime: number,
        definition: {
            frequency: number;
            endFrequency: number;
            duration: number;
            peak: number;
            type: OscillatorType;
            attack?: number;
        },
    ): void {
        if (!this.context || !this.sfxBus) return;
        const attack = definition.attack ?? 0.008;
        const oscillator = this.context.createOscillator();
        const envelope = this.context.createGain();
        oscillator.type = definition.type;
        oscillator.frequency.setValueAtTime(definition.frequency, startTime);
        oscillator.frequency.exponentialRampToValueAtTime(
            Math.max(definition.endFrequency, 20),
            startTime + definition.duration,
        );
        envelope.gain.setValueAtTime(0.0001, startTime);
        envelope.gain.exponentialRampToValueAtTime(definition.peak, startTime + attack);
        envelope.gain.exponentialRampToValueAtTime(0.0001, startTime + definition.duration);
        oscillator.connect(envelope).connect(this.sfxBus);
        this.trackVoice(oscillator, envelope, this.sfxVoices);
        oscillator.start(startTime);
        oscillator.stop(startTime + definition.duration + 0.03);
    }

    debugSnapshot(): AudioDebugSnapshot {
        return {
            contextState: this.context?.state ?? "locked",
            musicRunning: this.musicElement !== null && !this.musicElement.paused,
            musicTimeSeconds: this.musicElement?.currentTime ?? 0,
            musicTrackReady: (this.musicElement?.readyState ?? 0) >= HTMLMediaElement.HAVE_FUTURE_DATA,
            activeSfxVoices: this.sfxVoices.size,
            suppressedSfx: this.suppressedSfx,
        };
    }

    private ensureGraph(): void {
        if (this.context) return;
        const AudioContextCtor = window.AudioContext;
        if (!AudioContextCtor) return;
        this.context = new AudioContextCtor();
        this.master = this.context.createGain();
        this.musicBus = this.context.createGain();
        this.sfxBus = this.context.createGain();
        const limiter = this.context.createDynamicsCompressor();
        limiter.threshold.value = -20;
        limiter.knee.value = 18;
        limiter.ratio.value = 4;
        limiter.attack.value = 0.004;
        limiter.release.value = 0.24;
        this.musicBus.connect(this.master);
        this.sfxBus.connect(this.master);
        this.master.connect(limiter).connect(this.context.destination);

        // The graph is only ever built from a user interaction (unlock), so
        // creating the element here also starts its download at the first
        // moment it could legally play — never during boot.
        this.musicElement = new Audio(musicUrl);
        this.musicElement.loop = true;
        this.musicElement.preload = "auto";
        this.context.createMediaElementSource(this.musicElement).connect(this.musicBus);
    }

    private sync(): void {
        if (!this.context || !this.master || !this.musicBus || !this.sfxBus) return;
        const state = store.get();
        const now = this.context.currentTime;
        this.musicBus.gain.setTargetAtTime(state.musicEnabled ? state.musicVolume : 0, now, 0.12);
        this.sfxBus.gain.setTargetAtTime(state.sfxEnabled ? state.sfxVolume : 0, now, 0.03);
        this.master.gain.setTargetAtTime(this.paused ? 0 : 0.58, now, 0.08);
        if (state.musicEnabled && state.musicVolume > 0 && !this.paused && this.context.state === "running") {
            this.startMusic();
        } else {
            this.stopMusic();
        }
    }

    private startMusic(): void {
        const element = this.musicElement;
        if (!element || !element.paused) return;
        // play() can reject (autoplay policy, transient decode state). Never
        // let that propagate — the next unlock or settings change retries.
        void element.play().catch(() => undefined);
    }

    private trackVoice(oscillator: OscillatorNode, envelope: GainNode, collection: Set<OscillatorNode>): void {
        collection.add(oscillator);
        oscillator.addEventListener(
            "ended",
            () => {
                collection.delete(oscillator);
                oscillator.disconnect();
                envelope.disconnect();
            },
            { once: true },
        );
    }

    private stopMusic(): void {
        // Pausing the ELEMENT matters, not just the context: a media element
        // keeps advancing through a suspended context, so without this the
        // track would silently burn through minutes while the game was hidden.
        this.musicElement?.pause();
    }
}

export const audioManager = new AudioManager();
