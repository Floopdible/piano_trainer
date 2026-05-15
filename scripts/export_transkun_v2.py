"""Export Transkun V2 to ONNX — patching attention to use matmul/softmax."""
import torch, numpy as np, os, sys, json, warnings, math
warnings.filterwarnings('ignore')
try:
    import transkun, pkg_resources, moduleconf
    from transkun.Util import makeFrame
    from transkun.LayersTransformer import MultiHeadAttentionKernel
except ImportError:
    print("Install: pip install transkun torch"); sys.exit(1)

# Patch: replace SDPA with manual attention in the model's attention class
original_forward = MultiHeadAttentionKernel.forward
def patched_forward(self, query, key=None, value=None):
    if key is None: key = query
    if value is None: value = key
    q = query @ self.q_proj_weight
    k = key @ self.k_proj_weight
    v = value @ self.v_proj_weight
    # Split heads
    q = q.unflatten(-1, (self.num_heads, self.head_dim)).transpose(-2, -3)
    k = k.unflatten(-1, (self.num_heads, self.head_dim)).transpose(-2, -3)
    v = v.unflatten(-1, (self.num_heads, self.head_dim)).transpose(-2, -3)
    # Manual attention (ONNX-safe)
    scale = 1.0 / math.sqrt(self.head_dim)
    attn = torch.matmul(q, k.transpose(-2, -1)) * scale
    attn = torch.softmax(attn, dim=-1)
    fetched = torch.matmul(attn, v)
    fetched = fetched.transpose(-2, -3).flatten(-2, -1)
    return self.out_proj(fetched)

MultiHeadAttentionKernel.forward = patched_forward

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

    class Wrapper(torch.nn.Module):
        def __init__(self, m):
            super().__init__()
            self.m = m
        def forward(self, audio):
            frames = makeFrame(audio, self.m.hopSize, self.m.windowSize)
            frames = frames.unsqueeze(1)
            crf, _ = self.m.processFramesBatch(frames)
            return crf.score, crf.noiseScore

    wrapper = Wrapper(model).eval()
    seg_samples = conf.segmentSizeInSecond * conf.fs
    dummy = torch.randn(1, 1, seg_samples)

    with torch.no_grad():
        S, NS = wrapper(dummy)
    print(f"Score: {S.shape} ({S.numel()*4/1e6:.0f}MB)  Noise: {NS.shape}")

    out_dir = os.path.join(os.path.dirname(__file__), "..", "models")
    os.makedirs(out_dir, exist_ok=True)
    onnx_path = os.path.join(out_dir, "transkun.onnx")

    try:
        torch.onnx.export(
            wrapper, dummy, onnx_path,
            input_names=["audio"], output_names=["score", "noise"],
            dynamic_axes={
                "audio": {2: "n_samples"},
                "score": {0: "T", 1: "T"},
                "noise": {0: "T_minus_1"},
            },
            opset_version=17, do_constant_folding=True,
        )
        size = os.path.getsize(onnx_path) / 1e6
        print(f"✅ ONNX exported: {onnx_path} ({size:.1f}MB)")
        
        json.dump({
            "fs": conf.fs, "hopSize": conf.hopSize, "windowSize": conf.windowSize,
            "segmentSizeInSecond": conf.segmentSizeInSecond,
            "segmentHopSizeInSecond": conf.segmentHopSizeInSecond,
            "targetMIDIPitch": model.targetMIDIPitch,
            "input_samples": seg_samples, "T": S.shape[0], "nBatch": S.shape[2],
        }, open(os.path.join(out_dir, "transkun_config.json"), "w"), indent=2)
        return True
    except Exception as e:
        print(f"❌ Export failed: {e}")
        import traceback; traceback.print_exc()
        return False

if __name__ == "__main__":
    export()
