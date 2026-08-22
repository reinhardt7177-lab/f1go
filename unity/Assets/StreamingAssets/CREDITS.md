# Music

`ThirdGearSunrise.mp3` — *Third Gear Sunrise*, written for this game.

Thirty-one seconds at 192 kbps, meant to loop. Loaded by path through
`Resources.Load` rather than by a serialised reference, like everything
else here, so there is no GUID for a moved file to break.

It is the only sampled audio in the build. The engine, the wind, the
tyre scrub and the kerb rumble are all synthesised from the
simulation's own output — see `MumuF1.EngineAudio` — because a note
that has to follow the revs continuously cannot be a recording, and
because an audio file is an asset to import and reference and this
project is authored as text. Music is the exception that proves it:
it does not have to react to anything, so a file is exactly right.
