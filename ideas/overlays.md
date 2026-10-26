# Overlays

What the AI adds on top of the map, beyond what is extracted from the code: positions and groupings, markers and highlights, extra arrows, text, images, any media that helps. **One format for all of it**, and [tours](tours.md) are just overlays with steps.

- **Steps, like a state machine.** An overlay can be a sequence you walk forwards and backwards. Each step moves the camera, rearranges boxes, and adds or removes annotations. A one-off explanation is an overlay with one step.
- **Not from the code.** The map stays derived from the code. An overlay is a separate layer over it that can be switched off.
- **Claude canvases:** don't rebuild them. Overlays should complement them, and maybe share a format. This deserves a long look before building.
- **Images:** e.g. a UI component's box shows what it looks like. See [live components](live-components.md).
