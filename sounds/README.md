# Sound assets

- `scary.mp3` — Halloween scary sound, played when the top three change.
- `applause-cheer.mp3` — crowd applause and cheer, played on the podium page. If the file is missing, the podium falls back to a synthesised applause.

Source: [Applause and cheer crowd celebration sound effect](https://pixabay.com/sound-effects/people-applause-cheer-236786/) by Driken5482 — Pixabay Content License (free to use, no attribution required).

Source: [Wolf Howl 01](https://sfxmint.com/sounds/wolf-howl-01) — measured, CC0 1.0
public-domain sample (4.9 s, 44.1 kHz stereo MP3). No attribution required.

## Playback notes

Browsers block audio until the page has had a user gesture. Because a results
screen is often opened and left alone, `results.html` shows a small floating
**Enable sound** button while the audio context is still suspended; one click
on it (or anywhere on the page) unlocks playback, plays the howl once as
confirmation, and the button then disappears. Without that gesture the page
stays silent by browser policy.

A change that arrives before the recording has finished decoding is queued and
plays as soon as it is ready. Playback is capped at 4 seconds with a fade-out,
so a long howl does not run under the next refresh.
