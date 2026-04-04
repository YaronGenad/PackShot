# Benchmark Results & Visual Comparison

## Performance Comparison (real data, 3 runs average)

### Per-Dataset Results

| Dataset | Images | Quick Stack | Aligned Stack | Speedup | Max Frame Shift |
|---------|--------|-------------|---------------|---------|-----------------|
| third   | 3      | 522ms       | 3,169ms       | 6.1x    | 0.7px           |
| second  | 3      | 585ms       | 3,061ms       | 5.2x    | 3.0px           |
| first   | 4      | 830ms       | 5,865ms       | 7.1x    | **127.5px**     |
| forth   | 4      | 829ms       | 5,369ms       | 6.5x    | **93.5px**      |
| fifth   | 6      | 1,142ms     | 8,242ms       | 7.2x    | 7.9px           |

### Method Comparison

| Metric                | Quick Stack       | Aligned Stack      | AI Synthesis        |
|-----------------------|-------------------|--------------------|---------------------|
| **Avg Time (4 imgs)** | ~830ms            | ~5,600ms           | ~5,000-15,000ms     |
| **Cost per run**      | $0                | $0                 | ~$0.05-0.10         |
| **SSIM Consistency**  | 1.000000          | 1.000000           | ~0.65-0.85          |
| **Deterministic**     | Yes               | Yes                | No                  |
| **Alignment**         | None              | AKAZE + Homography | N/A (regenerates)   |
| **Avg Reproj Error**  | N/A               | 0.18-0.31px        | N/A                 |
| **Ghosting Risk**     | High              | None               | None                |
| **Hallucination Risk**| None              | None               | Possible            |
| **Requires API Key**  | No                | No                 | Yes (Gemini)        |
| **Runs On**           | Client (browser)  | Server (Node/WASM) | External API        |

### Key Observations

1. **Both deterministic methods produce identical results across runs** (SSIM = 1.000000). AI Synthesis varies 15-35% between runs due to LLM non-determinism.

2. **Aligned Stack corrects significant camera movement.** The `first` dataset had 127.5px of frame shift — without alignment this creates severe ghosting. Aligned Stack handled it with 0.31px reprojection error.

3. **Quick Stack is 5-7x faster** but produces ghosting artifacts when camera moves between shots. Acceptable only on a rigid tripod with zero movement.

4. **AI Synthesis has a monetary cost** (~$0.05-0.10 per run) and can hallucinate details (add/alter text, change textures). Not suitable when pixel-perfect fidelity is required.

5. **Feature detection is the bottleneck** in Aligned Stack, taking ~60% of total time. AKAZE is robust but computationally expensive in WASM.

### Stage Breakdown (Aligned Stack, "first" dataset, 4 images)

| Stage              | Time (ms) | % of Total |
|--------------------|-----------|------------|
| Feature Detection  | 2,891     | 49.3%      |
| Focus Map Compute  | 709       | 12.1%      |
| Feature Matching   | 634       | 10.8%      |
| Compositing        | 622       | 10.6%      |
| JPEG Encoding      | 308       | 5.3%       |
| Warping/Alignment  | 177       | 3.0%       |
| Reference Select   | 49        | 0.8%       |
| OpenCV Init        | 0         | 0% (cached)|

---

## When to Use Each Method

| Scenario | Recommended Method | Why |
|----------|-------------------|-----|
| Rigid tripod, no movement | Quick Stack | Fast, no ghosting expected |
| Handheld or slight vibration | **Aligned Stack** | Corrects sub-pixel to 100+ pixel shifts |
| Need white background removal | AI Synthesis | Only method that changes background |
| Batch processing, cost matters | **Aligned Stack** | $0, deterministic, automated |
| Creative product shots | AI Synthesis | Can apply artistic direction |
| Legal/compliance (exact fidelity) | **Aligned Stack** | Zero hallucination, pixel-accurate |

---

## Running Benchmarks

```bash
# Start server first
npm run dev

# Run all datasets, 3 runs each
node benchmark.mjs --dataset=all --runs=3

# Run specific dataset, 10 runs
node benchmark.mjs --dataset=exemplsForTests/first --runs=10

# Skip AI (no API key needed)
node benchmark.mjs --dataset=all --runs=5 --skip-ai
```

Results are saved to `benchmark-results.json` for further analysis.
