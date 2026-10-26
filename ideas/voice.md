---
kind: idea
description: Talk at the boxes: a click-and-talk mode, transcribed by the browser or local whisper.cpp.
---
# Voice

Talk at the boxes instead of typing.

Transcription (the Claude app's dictation can't be triggered from the page):

- **Browser speech recognition:** free, in Chrome and Android, not Firefox.
- **Local `whisper.cpp`:** free, fast on a Mac, any browser; the page sends audio to the visvet server. The likely pick.
- **A transcription API:** a cheap fallback.

How it feels: clicking and typing stays the core; voice is a mode.

- **Click and talk:** what you say goes to the box selected at that moment. Click another box and keep talking. No send button.
- Words appear live in the comment field and send after a short pause unless you edit or cancel.
- **Push to talk** instead, if always-listening feels wrong: hold a key, or long-press on a phone.
