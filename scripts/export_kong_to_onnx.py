"""Export Bytedance/Kong model to ONNX for browser use."""
import torch, os, sys, json, warnings
warnings.filterwarnings('ignore')

try:
    from piano_transcription_inference import PianoTranscription, sample_rate
    import pkg_resources
except ImportError:
    print("Install: pip install piano_transcription_inference torch"); sys.exit(1)

def export():
    # Load model (downloads pretrained checkpoint from Zenodo)
    print("Loading Kong model (first run downloads ~165MB checkpoint)...")
    transcriptor = PianoTranscription(device='cpu')
    model = transcriptor.model
    model.eval()

    params = sum(p.numel() for p in model.parameters())
    print(f"Model: {params/1e6:.1f}M params")
    print(f"Sample rate: {sample_rate}Hz")

    # Dummy input: 10 seconds of audio at 16kHz
    duration = 10  # seconds
    dummy = torch.randn(1, sample_rate * duration)
    
    with torch.no_grad():
        out = model(dummy)
        print(f"Output keys: {list(out.keys())}")
        for k, v in out.items():
            print(f"  {k}: {v.shape}")

    # Wrap to export the full model (spectrogram + CRNN)
    class Wrapper(torch.nn.Module):
        def __init__(self, m):
            super().__init__()
            self.m = m
        def forward(self, audio):
            result = self.m(audio)
            return result['reg_onset_output'], result['reg_offset_output'], \
                   result['frame_output'], result['velocity_output']

    wrapper = Wrapper(model)

    out_dir = os.path.join(os.path.dirname(__file__), "..", "models")
    os.makedirs(out_dir, exist_ok=True)
    onnx_path = os.path.join(out_dir, "kong.onnx")

    # Export with fixed input length for now
    torch.onnx.export(
        wrapper, dummy, onnx_path,
        input_names=["audio"],
        output_names=["onset", "offset", "frame", "velocity"],
        dynamic_axes={
            "audio": {1: "n_samples"},
            "onset": {1: "time"},
            "offset": {1: "time"},
            "frame": {1: "time"},
            "velocity": {1: "time"},
        },
        opset_version=17,
        do_constant_folding=True,
    )

    size = os.path.getsize(onnx_path) / 1e6
    print(f"\nONNX exported: {onnx_path} ({size:.1f}MB)")

    # Config for browser
    config = {
        "sample_rate": sample_rate,
        "frames_per_second": 100,  # From the model config
        "classes_num": 88,
        "segment_duration": duration,
        "onset_threshold": 0.5,
        "frame_threshold": 0.3,
        "notes": list(range(21, 109)),  # MIDI notes 21-108
    }
    cfg_path = os.path.join(out_dir, "kong_config.json")
    with open(cfg_path, "w") as f:
        json.dump(config, f, indent=2)
    print(f"Config saved: {cfg_path}")

    # Also save: note the external data
    if os.path.exists(onnx_path + ".data"):
        data_size = os.path.getsize(onnx_path + ".data") / 1e6
        print(f"External data: {onnx_path}.data ({data_size:.1f}MB)")

if __name__ == "__main__":
    export()
