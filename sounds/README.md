# Sounds

## `ghost-scream.mp3`

The scream played by **results.html** when the top three places change.

- **Title:** Horror scream1
- **Author:** Vinrax
- **Source:** https://opengameart.org/content/horror-scream1
- **License:** CC0 (public domain) — free for any use, no attribution required

The file is fetched and decoded once by `js/results.js`, then replayed from the
decoded buffer.

Browsers block audio until the page has had a user gesture. Because a results
screen is often opened and left alone, `results.html` shows a small floating
**Enable sound** button while the audio context is still suspended; one click
on it (or anywhere on the page) unlocks playback, plays the scream once as
confirmation, and the button then disappears. Without that gesture the page
stays silent by browser policy.

A change that arrives before the recording has finished decoding is queued and
plays as soon as it is ready. Playback is capped at 4 seconds with a fade-out,
so a long scream does not run under the next refresh.
