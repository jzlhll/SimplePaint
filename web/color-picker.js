const formats = ['hex', 'rgb', 'hsl'];

function rgbToHsv(rgb) {
  const [r, g, b] = rgb.map(value => value / 255), high = Math.max(r, g, b), low = Math.min(r, g, b), delta = high - low;
  let hue = 0;
  if (delta) hue = high === r ? ((g - b) / delta + 6) % 6 : high === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  return { h: hue * 60, s: high ? delta / high : 0, v: high };
}

function hsvToRgb({ h, s, v }) {
  const channel = offset => {
    const k = (offset + h / 60) % 6;
    return Math.round(255 * v * (1 - s * Math.max(0, Math.min(k, 4 - k, 1))));
  };
  return [channel(5), channel(3), channel(1)];
}

// 页面内的颜色面板统一处理格式切换，避免依赖浏览器颜色弹窗的内部设置。
export function createColorPicker(color, savedFormat, saveFormat) {
  let hsv = rgbToHsv(color.slice(1).match(/../g).map(value => parseInt(value, 16)));
  let format = formats.includes(savedFormat) ? savedFormat : 'hex';
  const element = document.createElement('div'); element.className = 'color-panel';
  element.innerHTML = `
    <div class="color-spectrum" tabindex="0" role="slider" aria-label="饱和度与亮度，左右调整饱和度，上下调整亮度" aria-valuemin="0" aria-valuemax="100"><span class="color-marker"></span></div>
    <div class="color-hue-row"><span class="color-preview" aria-hidden="true"></span><label><span class="sr-only">色相</span><input class="color-hue" type="range" min="0" max="360" step="1"></label></div>
    <div class="color-format-row"><div class="color-fields"></div><div class="color-format-switch"><button type="button" class="color-format-arrow" aria-label="上一个颜色格式" title="上一个颜色格式"><span class="chevron-up" aria-hidden="true"></span></button><button type="button" class="color-format-arrow" aria-label="下一个颜色格式" title="下一个颜色格式"><span class="chevron-down" aria-hidden="true"></span></button></div></div>
    <output class="color-format-name sr-only" aria-live="polite"></output>`;
  const spectrum = element.querySelector('.color-spectrum'), marker = element.querySelector('.color-marker');
  const hue = element.querySelector('.color-hue'), fields = element.querySelector('.color-fields');
  const hex = () => '#' + hsvToRgb(hsv).map(value => value.toString(16).padStart(2, '0')).join('').toUpperCase();
  function values() {
    if (format === 'hex') return [hex()];
    if (format === 'rgb') return hsvToRgb(hsv);
    const lightness = hsv.v * (1 - hsv.s / 2);
    const saturation = lightness > 0 && lightness < 1 ? (hsv.v - lightness) / Math.min(lightness, 1 - lightness) : 0;
    return [Math.round(hsv.h), Math.round(saturation * 100), Math.round(lightness * 100)];
  }
  function render() {
    spectrum.style.backgroundColor = `hsl(${hsv.h} 100% 50%)`;
    spectrum.setAttribute('aria-valuenow', String(Math.round(hsv.s * 100)));
    spectrum.setAttribute('aria-valuetext', `饱和度 ${Math.round(hsv.s * 100)}%，亮度 ${Math.round(hsv.v * 100)}%`);
    marker.style.left = `${hsv.s * 100}%`; marker.style.top = `${(1 - hsv.v) * 100}%`;
    hue.value = hsv.h; element.querySelector('.color-preview').style.background = hex();
    const current = values();
    fields.querySelectorAll('input').forEach((input, index) => { if (input !== document.activeElement) input.value = current[index]; });
  }
  function renderFields() {
    fields.replaceChildren();
    const names = format === 'hex' ? ['HEX'] : format === 'rgb' ? ['R', 'G', 'B'] : ['H', 'S', 'L'];
    names.forEach((name, index) => {
      const label = document.createElement('label'), input = document.createElement('input');
      input.required = true; input.setAttribute('aria-label', name); input.type = format === 'hex' ? 'text' : 'number';
      if (format === 'hex') { input.pattern = '#?[0-9a-fA-F]{6}'; input.maxLength = 7; input.spellcheck = false; }
      else { input.min = '0'; input.max = format === 'rgb' ? '255' : index === 0 ? '360' : '100'; input.step = '1'; }
      const text = document.createElement('span'); text.textContent = name;
      label.append(input, text); fields.append(label);
      input.addEventListener('input', () => {
        const inputs = [...fields.querySelectorAll('input')];
        if (!inputs.every(field => field.validity.valid)) return;
        if (format === 'hex') hsv = rgbToHsv(input.value.replace(/^#/, '').match(/../g).map(value => parseInt(value, 16)));
        else if (format === 'rgb') hsv = rgbToHsv(inputs.map(field => Number(field.value)));
        else {
          const [h, s, l] = inputs.map(field => Number(field.value)), lightness = l / 100;
          const value = lightness + s / 100 * Math.min(lightness, 1 - lightness);
          hsv = { h, s: value ? 2 * (1 - lightness / value) : 0, v: value };
        }
        render();
      });
      input.addEventListener('blur', render);
    });
    element.querySelector('.color-format-name').textContent = format.toUpperCase(); render();
  }
  element.querySelectorAll('.color-format-arrow').forEach((button, index) => button.addEventListener('click', () => {
    format = formats[(formats.indexOf(format) + (index === 0 ? 2 : 1)) % formats.length];
    saveFormat(format); renderFields();
  }));
  hue.addEventListener('input', () => { hsv.h = Number(hue.value); render(); });
  function pick(event) {
    const rect = spectrum.getBoundingClientRect();
    hsv.s = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    hsv.v = 1 - Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)); render();
  }
  spectrum.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    spectrum.setPointerCapture(event.pointerId); pick(event);
  });
  spectrum.addEventListener('pointermove', event => { if (spectrum.hasPointerCapture(event.pointerId)) pick(event); });
  spectrum.addEventListener('pointerup', event => { if (spectrum.hasPointerCapture(event.pointerId)) spectrum.releasePointerCapture(event.pointerId); });
  spectrum.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') hsv.s = Math.max(0, Math.min(1, hsv.s + (event.key === 'ArrowLeft' ? -.01 : .01)));
    else hsv.v = Math.max(0, Math.min(1, hsv.v + (event.key === 'ArrowDown' ? -.01 : .01)));
    render();
  });
  renderFields();
  return { element, get color() { return hex(); } };
}
