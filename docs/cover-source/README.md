# Cover image source

`cover.html` renders the 1920×1080 Devfolio cover PNG that lives at
`../screenshots/cover.png`. If you want to re-render (tweak the
tagline, swap a product shot, adjust layout), serve this folder and
screenshot at 1920×1080.

```bash
# from the repo root
cd docs
python -m http.server 5555

# then in another terminal, use any browser automation to capture:
#   http://localhost:5555/cover-source/cover.html
# at viewport 1920×1080 and save as ../screenshots/cover.png
```

The two product screenshots are pulled via `../screenshots/*.png` —
if you replace them in that folder the cover will pick them up on next
render.
