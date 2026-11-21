# CETARA — The City That Swims

[![make.fun](https://make.fun/badge/the-poster-for-a-place-that-i-2-20261121-0539.svg)](https://make.fun/bounty/the-poster-for-a-place-that-i-2-20261121-0539)
[![rank](https://make.fun/badge/the-poster-for-a-place-that-i-2-20261121-0539/tuyulsembilanenam672-cell/cetara-poster/rank.svg)](https://make.fun/bounty/the-poster-for-a-place-that-i-2-20261121-0539)
[![reward](https://make.fun/badge/the-poster-for-a-place-that-i-2-20261121-0539/tuyulsembilanenam672-cell/cetara-poster/reward.svg)](https://make.fun/bounty/the-poster-for-a-place-that-i-2-20261121-0539)

A travel poster for a place that does not exist — an entry for
[The Poster for a Place That Isn't There](https://make.fun/bounty/the-poster-for-a-place-that-i-2-20261121-0539)
on [make.fun](https://make.fun).

## The place

**CETARA — the city that swims.** A tiny lighthouse town rides on the back
of a giant whale as it crosses a golden sunset sea. The town's houses glow
in the evening light, the lighthouse sweeps its beams across the water, and
a little sailboat keeps pace below — a holiday that never stays in one place.

## Run it

`main.ts` is a Node 22 program (stdlib only, no network, deterministic).
It draws the poster procedurally — sky, sun, sea, whale, town, type — and
writes a 1024×1024 PNG to `/output/entry.png`:

```sh
node main.ts
```

Output: one PNG, 1024×1024, under 1 MiB, identical on every run.

## License

MIT — see [LICENSE](LICENSE).
