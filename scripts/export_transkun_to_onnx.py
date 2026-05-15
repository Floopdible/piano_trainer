"""Export Transkun V2 to ONNX for browser use."""
import torch, numpy as np, os, sys, json, warnings
warnings.filterwarnings('ignore')
try:
    import transkun, pkg_resources, moduleconf
    from transkun.Util import makeFrame
except ImportError:
    print("Install transkun: pip install transkun"); sys.exit(1)

def export():
    weight = pkg_resources.resource_filename("transkun", "pretrained/2.0.pt")
    conf_path = pkg_resources.resource_filename("transkun", "pretrained/2.0.conf")
    cfg = moduleconf.parseFromFile(conf_path)
    TransKun = cfg["Model"].module.TransKun
    conf = cfg["Model"].config

    model = TransKun(conf=conf)
    cp = torch.load(weight, map_location="cpu")
    sd = cp.get("best_state_dict", cp.get("state_dict", cp))
    model.load_state_dict(sd, strict=False)
    model.eval()
    print(f"Model: {sum(p.numel() for p in model.parameters())/1e6:.1f}M params")

    # Wrapper: takes raw audio, outputs CRF score + noise matrices
    class Wrapper(torch.nn.Module):
        def __init__(self, m):
            super().__init__()
            self.m = m
        def forward(self, audio):
            # audio: [batch, 1, samples]
            # Step 1: make frames (same as transcribe method)
            frames = makeFrame(audio, self.m.hopSize, self.m.windowSize)
            # frames: [batch, n_frames, window_size]
            frames = frames.unsqueeze(1)  # [batch, 1, n_frames, window_size]
            # Step 2: processFramesBatch
            crf_batch, ctx = self.m.processFramesBatch(frames)
            return crf_batch.score, crf_batch.noiseScore

    wrapper = Wrapper(model)
    seg_samples = conf.segmentSizeInSecond * conf.fs
    dummy = torch.randn(1, 1, seg_samples)

    with torch.no_grad():
        S, NS = wrapper(dummy)
    print(f"Score: {S.shape} ({S.numel()*4/1e6:.0f}MB)  Noise: {NS.shape}")

    out_dir = os.path.join(os.path.dirname(__file__), "..", "models")
    os.makedirs(out_dir, exist_ok=True)
    onnx_path = os.path.join(out_dir, "transkun.onnx")

    torch.onnx.export(
        wrapper, dummy, onnx_path,
        input_names=["audio"],
        output_names=["score", "noise_scores"],
        dynamic_axes={
            "audio": {2: "n_samples"},
            "score": {0: "T", 1: "T"},
            "noise_scores": {0: "T_minus_1"},
        },
        opset_version=17, do_constant_folding=True,
    )
    print(f"ONNX: {onnx_path} ({os.path.getsize(onnx_path)/1e6:.1f}MB)")

    json.dump({
        "fs": conf.fs, "hopSize": conf.hopSize, "windowSize": conf.windowSize,
        "segmentSizeInSecond": conf.segmentSizeInSecond,
        "segmentHopSizeInSecond": conf.segmentHopSizeInSecond,
        "targetMIDIPitch": model.targetMIDIPitch,
        "input_samples": seg_samples, "T": S.shape[0], "nBatch": S.shape[2],
    }, open(os.path.join(out_dir, "transkun_config.json"), "w"), indent=2)

if __name__ == "__main__":
    export()
