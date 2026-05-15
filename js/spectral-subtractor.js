// Spectral subtraction noise reduction using FFT
class SpectralSubtractor {
  constructor(opts = {}) {
    this.fftSize = opts.fftSize || 2048;
    this.noiseProfile = null;
    this.noiseFrames = 0;
    this.noiseProfileFrames = opts.noiseProfileFrames || 10;
    this.overSubtraction = opts.overSubtraction || 2.0;
    this.noiseFloor = opts.noiseFloor || 0.001;
  }

  processFrame(samples) {
    const N = this.fftSize;
    const halfN = N / 2;

    // Window and copy
    const frame = new Float64Array(N);
    for (let i = 0; i < Math.min(samples.length, N); i++) frame[i] = samples[i];
    for (let i = 0; i < N; i++) frame[i] *= 0.5 * (1 - Math.cos(2 * Math.PI * i / (N - 1)));

    // FFT using simple DFT (slow but correct)
    // For N=2048, this is 2048*1024 ≈ 2M operations per frame, ~2-5ms on modern JS engines
    const real = new Float64Array(N);
    const imag = new Float64Array(N);
    for (let k = 0; k < halfN; k++) {
      let r = 0, im = 0;
      for (let n = 0; n < N; n++) {
        const angle = -2 * Math.PI * k * n / N;
        r += frame[n] * Math.cos(angle);
        im += frame[n] * Math.sin(angle);
      }
      real[k] = r;
      imag[k] = im;
      // Conjugate symmetric for negative frequencies
      if (k > 0) {
        real[N - k] = r;
        imag[N - k] = -im;
      }
    }

    // Magnitude spectrum
    const mag = new Float64Array(halfN);
    for (let k = 0; k < halfN; k++) {
      mag[k] = Math.sqrt(real[k] * real[k] + imag[k] * imag[k]);
    }

    // Noise profile
    if (this.noiseProfile === null) {
      this.noiseProfile = new Float64Array(halfN).fill(0);
    }
    if (this.noiseFrames < this.noiseProfileFrames) {
      for (let i = 0; i < halfN; i++) this.noiseProfile[i] += mag[i];
      this.noiseFrames++;
      if (this.noiseFrames >= this.noiseProfileFrames) {
        for (let i = 0; i < halfN; i++) this.noiseProfile[i] /= this.noiseProfileFrames;
      }
      return { audio: new Float32Array(samples.slice(0, Math.min(samples.length, N))), snr: 0 };
    }

    // Apply spectral subtraction gain to complex spectrum
    const gain = new Float64Array(halfN);
    for (let k = 0; k < halfN; k++) {
      const sub = mag[k] - this.overSubtraction * this.noiseProfile[k];
      gain[k] = Math.max(sub, this.noiseFloor * mag[k]) / Math.max(mag[k], 1e-10);
      real[k] *= gain[k];
      imag[k] *= gain[k];
      if (k > 0) {
        real[N - k] = real[k];
        imag[N - k] = -imag[k];
      }
    }

    // IFFT via DFT (optimized using conjugate symmetry)
    const out = new Float64Array(N);
    for (let n = 0; n < N; n++) {
      let sum = real[0]; // DC
      for (let k = 1; k < halfN; k++) {
        const angle = 2 * Math.PI * k * n / N;
        sum += 2 * (real[k] * Math.cos(angle) - imag[k] * Math.sin(angle));
      }
      out[n] = sum / N;
    }

    return { audio: new Float32Array(out), snr: 1.0 };
  }

  reset() {
    this.noiseProfile = null;
    this.noiseFrames = 0;
  }
}
