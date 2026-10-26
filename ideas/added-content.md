# Added content

Everything on the map that wasn't extracted from the code: the AI's notes, extra arrows, highlights, [widgets](widgets.md), pictures. (Earlier notes called this an "overlay": a separate layer drawn over the map. Dropped: it hid things behind a layer.)

- **First-class:** added things are ordinary boxes and arrows on the map, shown like any other. Each one records where it came from: extracted from code, or added (by which agent or person). That origin can be shown, and filtered, but nothing is hidden by default.
- **One format** for all of it, the same format extractors produce ([extending visvet](extending-visvet.md)). An added box and an extracted box differ only in their origin.
- **[Tours](tours.md) are steps over the map:** each step moves the camera, picks boxes, and may add notes or widgets for that step. A one-off explanation is a one-step tour.
- **Claude canvases:** don't rebuild them. See [Claude integration](claude-integration.md).
- **Images:** e.g. a UI component's box shows what it looks like. See [live components](live-components.md).
