"""Convert traced Kong model to ONNX. Requires PyTorch 2.0-2.1."""
import torch, os, sys
sys.path.insert(0, os.path.dirname(__file__))

out_dir = os.path.join(os.path.dirname(__file__), "..", "models")
pt_path = os.path.join(out_dir, "kong_traced.pt")
onnx_path = os.path.join(out_dir, "kong.onnx")

if not os.path.exists(pt_path):
    print(f"Run export_kong_via_trace.py first to create {pt_path}")
    sys.exit(1)

print(f"Loading traced model from {pt_path}...")
model = torch.jit.load(pt_path)
model.eval()
dummy = torch.randn(1, 160000)  # 10s at 16kHz
print("Exporting to ONNX...")

torch.onnx.export(
    model, dummy, onnx_path,
    input_names=["audio"], output_names=["frame"],
    dynamic_axes={"audio": {1: "n_samples"}, "frame": {1: "time"}},
    opset_version=17, do_constant_folding=True,
)

size = os.path.getsize(onnx_path) / 1e6
print(f"ONNX model saved: {onnx_path} ({size:.1f}MB)")
