# Sounds

## `ghost-scream.mp3`

The scream played by **results.html** when the top three places change.

- **Title:** Horror scream1
- **Author:** Vinrax
- **Source:** https://opengameart.org/content/horror-scream1
- **License:** CC0 (public domain) — free for any use, no attribution required

The file is fetched and decoded once by `js/results.js`, then replayed from the
decoded buffer. Browsers block audio until the page has had a user gesture, so
the first change after opening the page stays silent unless the page has been
clicked or a key pressed.
