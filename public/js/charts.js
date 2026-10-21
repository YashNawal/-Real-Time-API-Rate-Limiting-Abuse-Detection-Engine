class RpsSparkline {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    if (!this.canvas) return;
    this.ctx = this.canvas.getContext('2d');
    this.data = new Array(30).fill(0);
    this.maxRps = 10;

    // Handle high DPI displays
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    if (!this.canvas) return;
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.ctx.scale(dpr, dpr);
    this.width = rect.width;
    this.height = rect.height;
    this.draw();
  }

  update(rpsHistory) {
    if (!rpsHistory || !this.canvas) return;
    this.data = rpsHistory.map((p) => p.rps);
    while (this.data.length < 30) {
      this.data.unshift(0);
    }
    const peak = Math.max(...this.data, 5);
    this.maxRps = peak * 1.25; // add headroom
    this.draw();
  }

  draw() {
    if (!this.ctx || !this.width || !this.height) return;
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;
    const points = this.data;

    ctx.clearRect(0, 0, w, h);

    if (points.length < 2) return;

    const step = w / (points.length - 1);

    // Draw area fill
    ctx.beginPath();
    points.forEach((val, i) => {
      const x = i * step;
      const y = h - (val / this.maxRps) * (h - 8) - 4;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.lineTo(w, h);
    ctx.lineTo(0, h);
    ctx.closePath();

    const gradient = ctx.createLinearGradient(0, 0, 0, h);
    gradient.addColorStop(0, 'rgba(99, 102, 241, 0.35)');
    gradient.addColorStop(1, 'rgba(6, 182, 212, 0.0)');
    ctx.fillStyle = gradient;
    ctx.fill();

    // Draw stroke line
    ctx.beginPath();
    points.forEach((val, i) => {
      const x = i * step;
      const y = h - (val / this.maxRps) * (h - 8) - 4;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = '#06b6d4';
    ctx.lineWidth = 2;
    ctx.shadowColor = '#06b6d4';
    ctx.shadowBlur = 8;
    ctx.stroke();
    ctx.shadowBlur = 0; // reset
  }
}

window.RpsSparkline = RpsSparkline;
