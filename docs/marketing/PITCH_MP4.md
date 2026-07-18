# InfraGraph Professional Pitch (MP4) — v2

White executive slideshow with **light product chrome** and the **new Pattern Architecture layout**.

## Video

[`flyer/InfraGraph-Professional-Pitch.mp4`](flyer/InfraGraph-Professional-Pitch.mp4)

~75 seconds · 1920×1080 · white master

## What changed (v2)

- Stopped dumping dark portal screenshots
- Added `?pitch=1` light chrome for marketing captures
- Architecture canvas chrome is white (stamp-ready)
- Hero is **PAT-EC2-ORACLE-DR-PAIR** new layout — parts then full
- Shorter story: architecture → 4 values → pattern workbench → blast / compare / FinOps / subscribe

## Preview light UI live

```
http://127.0.0.1:3010/graph/infra?tab=patterns&patternId=PAT-EC2-ORACLE-DR-PAIR&fullView=1&pitch=1
```

(Vite on 3010 during capture; Docker on 3000 may be an older build.)

## Regenerate

```powershell
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
cd apps/web
npm run dev -- --port 3010 --strictPort
# other terminal:
cd docs/marketing
$env:FLYER_BASE_URL="http://127.0.0.1:3010"
node capture-pitch-light.mjs
node render-pitch-mp4.mjs
```
